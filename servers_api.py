"""Servers (process manager) backend — a self-contained FastAPI router.

Spawns/stops/monitors sibling Python apps under the configured base dir, builds
venvs, and runs the HTTPS deploy kit. Owns its `services` table; uses the shared
tv_core helpers (db, auth, settings, public IP, pid/port probes, log dir).
"""
from __future__ import annotations  # lazy annotations (`-> list[dict]` vs the `list` method)

import os
import sys
import re
import json
import time
import shutil
import signal
import subprocess
import asyncio
import threading
import string
import uuid
from datetime import datetime

from fastapi import APIRouter, Request, HTTPException, Query

import tv_core
from tv_core import get_db

router = APIRouter()

# Managed servers config
DEFAULT_SERVERS_DIR = os.path.realpath(
    os.path.expanduser(os.getenv("THINKVIEWER_SERVERS_DIR", "~/Desktop/public_server")))
ENTRY_CANDIDATES = ("run.py", "main.py", "app.py", "server.py", "wsgi.py", "asgi.py")
os.makedirs(tv_core.SERVER_LOG_DIR, exist_ok=True)

# Deploy validation
_DOMAIN_RE = re.compile(
    r"^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_DEPLOY_EXIT_MARK = "__TVDEPLOY_EXIT__"


def ensure_schema():
    conn = get_db()
    c = conn.cursor()
    c.execute("""CREATE TABLE IF NOT EXISTS services (
        id TEXT PRIMARY KEY,
        name TEXT,
        cwd TEXT,
        entry TEXT,
        python TEXT,
        args TEXT,
        env TEXT,
        port INTEGER,
        pid INTEGER,
        started_at TEXT,
        created_at TEXT
    )""")
    # Migrations: add domain/HTTPS columns to older services tables.
    _scols = {r[1] for r in c.execute("PRAGMA table_info(services)").fetchall()}
    for _col, _decl in (("domain", "TEXT"), ("email", "TEXT"), ("https", "INTEGER")):
        if _col not in _scols:
            c.execute(f"ALTER TABLE services ADD COLUMN {_col} {_decl}")
    conn.commit()
    conn.close()


ensure_schema()


class ServerManager:
    """Start/stop/monitor sibling Python apps under the configured servers dir.

    Children run in their own session (start_new_session) so they survive a
    ThinkViewer restart; the PID is persisted so status is recovered after a
    manager restart. stdout+stderr append to a per-service log file.
    """

    def __init__(self):
        self._procs: dict[str, tuple] = {}  # id -> (Popen, logfile)
        self._deploys: dict[str, dict] = {}  # id -> deploy state
        self._setups: dict[str, dict] = {}  # id -> env-setup state

    # ---- base dir (persisted, configurable) ----
    def base_dir(self) -> str:
        return tv_core.get_setting("server_base_dir") or DEFAULT_SERVERS_DIR

    def set_base_dir(self, path: str) -> str:
        path = os.path.realpath(os.path.expanduser(path or DEFAULT_SERVERS_DIR))
        tv_core.set_setting("server_base_dir", path)
        return path

    def _project_root(self, cwd) -> str:
        """The project's top-level folder. The run dir is often a subfolder
        (<project>/server, <project>/webapp), so the root is the first path
        segment under the servers base dir; falls back to cwd for services that
        live outside the base dir."""
        cwd = os.path.realpath(os.path.expanduser(cwd or ""))
        base = os.path.realpath(self.base_dir())
        try:
            rel = os.path.relpath(cwd, base)
        except ValueError:  # different drives — can't relativize
            return cwd
        if rel == "." or rel.startswith(".."):
            return cwd
        return os.path.join(base, rel.split(os.sep)[0])

    # ---- persistence ----
    @staticmethod
    def _row(r) -> dict:
        keys = r.keys()
        return {
            "id": r["id"], "name": r["name"], "cwd": r["cwd"], "entry": r["entry"],
            "python": r["python"], "port": r["port"], "pid": r["pid"],
            "started_at": r["started_at"],
            "args": json.loads(r["args"] or "[]"),
            "env": json.loads(r["env"] or "{}"),
            "domain": r["domain"] if "domain" in keys else None,
            "email": r["email"] if "email" in keys else None,
            "https": bool(r["https"]) if "https" in keys else False,
        }

    def _get_row(self, sid):
        conn = get_db()
        row = conn.execute("SELECT * FROM services WHERE id=?", (sid,)).fetchone()
        conn.close()
        return row

    def _log_path(self, sid) -> str:
        return os.path.join(tv_core.SERVER_LOG_DIR, f"{sid}.log")

    def _set_pid(self, sid, pid):
        conn = get_db()
        conn.execute(
            "UPDATE services SET pid=?, started_at=? WHERE id=?",
            (pid, datetime.now().isoformat() if pid else None, sid))
        conn.commit()
        conn.close()

    # ---- status ----
    def _running(self, sid, pid) -> bool:
        ent = self._procs.get(sid)
        if ent and ent[0].poll() is None:
            return True
        return tv_core.pid_alive(pid)

    def status(self, row) -> dict:
        d = self._row(row)
        running = self._running(d["id"], d["pid"])
        ent = self._procs.get(d["id"])
        exit_code = ent[0].returncode if (ent and ent[0].poll() is not None) else None
        uptime = None
        if running and d["started_at"]:
            try:
                uptime = max(0, int(
                    (datetime.now() - datetime.fromisoformat(d["started_at"])).total_seconds()))
            except Exception:
                uptime = None
        return {
            **d,
            "running": running,
            "port_open": tv_core.port_open(d["port"]) if running else (False if d["port"] else None),
            "uptime": uptime,
            "exit_code": exit_code,
            "log_exists": os.path.isfile(self._log_path(d["id"])),
            "root": self._project_root(d["cwd"]),
        }

    def list(self) -> list[dict]:
        conn = get_db()
        rows = conn.execute("SELECT * FROM services ORDER BY name COLLATE NOCASE").fetchall()
        conn.close()
        return [self.status(r) for r in rows]

    def get(self, sid):
        row = self._get_row(sid)
        return self.status(row) if row else None

    # ---- validation ----
    def _validate(self, cwd, entry, python):
        cwd = os.path.realpath(os.path.expanduser(cwd or ""))
        if not os.path.isdir(cwd):
            raise ValueError("Working directory not found")
        entry_path = os.path.realpath(os.path.join(cwd, entry or ""))
        if os.path.commonpath([cwd, entry_path]) != cwd:
            raise ValueError("Entry file must be inside the working directory")
        if not os.path.isfile(entry_path):
            raise ValueError("Entry file not found")
        py = python or sys.executable
        if not (os.path.isabs(py) and os.path.isfile(py)) and not shutil.which(py):
            raise ValueError("Python interpreter not found")
        return cwd, entry, py

    # ---- CRUD ----
    def create(self, data) -> dict:
        cwd, entry, _ = self._validate(data.get("cwd"), data.get("entry"), data.get("python"))
        sid = uuid.uuid4().hex[:8]
        domain = (data.get("domain") or "").strip() or None
        conn = get_db()
        conn.execute(
            "INSERT INTO services (id,name,cwd,entry,python,args,env,port,domain,email,https,pid,started_at,created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,0,NULL,NULL,?)",
            (sid, (data.get("name") or os.path.basename(cwd))[:80], cwd, entry,
             data.get("python") or "", json.dumps(data.get("args") or []),
             json.dumps(data.get("env") or {}), data.get("port") or None,
             domain, (data.get("email") or "").strip() or None,
             datetime.now().isoformat()))
        conn.commit()
        conn.close()
        return self.get(sid)

    def update(self, sid, data) -> dict:
        row = self._get_row(sid)
        if not row:
            raise KeyError(sid)
        cur = self._row(row)
        cwd = data.get("cwd", cur["cwd"])
        entry = data.get("entry", cur["entry"])
        python = data.get("python", cur["python"])
        cwd, entry, _ = self._validate(cwd, entry, python)
        conn = get_db()
        conn.execute(
            "UPDATE services SET name=?,cwd=?,entry=?,python=?,args=?,env=?,port=?,domain=?,email=? WHERE id=?",
            (str(data.get("name", cur["name"]))[:80], cwd, entry,
             data.get("python", cur["python"]) or "",
             json.dumps(data.get("args", cur["args"])),
             json.dumps(data.get("env", cur["env"])),
             data.get("port", cur["port"]) or None,
             (data.get("domain", cur["domain"]) or "").strip() or None,
             (data.get("email", cur["email"]) or "").strip() or None, sid))
        conn.commit()
        conn.close()
        return self.get(sid)

    def delete(self, sid):
        self.stop(sid)
        conn = get_db()
        conn.execute("DELETE FROM services WHERE id=?", (sid,))
        conn.commit()
        conn.close()
        try:
            os.remove(self._log_path(sid))
        except OSError:
            pass

    # ---- lifecycle ----
    def start(self, sid) -> dict:
        row = self._get_row(sid)
        if not row:
            raise KeyError(sid)
        d = self._row(row)
        if self._running(sid, d["pid"]):
            return self.get(sid)
        cwd, entry, py = self._validate(d["cwd"], d["entry"], d["python"])
        env = os.environ.copy()
        env.update({str(k): str(v) for k, v in (d["env"] or {}).items()})
        os.makedirs(tv_core.SERVER_LOG_DIR, exist_ok=True)
        logf = open(self._log_path(sid), "ab", buffering=0)
        logf.write(
            f"\n===== [thinkviewer] start {datetime.now().isoformat()} :: "
            f"{py} {entry} {' '.join(d['args'] or [])} =====\n".encode())
        proc = subprocess.Popen(
            [py, entry, *(d["args"] or [])],
            cwd=cwd, env=env, stdout=logf, stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL, start_new_session=True)
        self._procs[sid] = (proc, logf)
        self._set_pid(sid, proc.pid)
        return self.get(sid)

    def stop(self, sid):
        row = self._get_row(sid)
        if not row:
            return None
        d = self._row(row)
        ent = self._procs.pop(sid, None)
        pid = (ent[0].pid if ent else None) or d["pid"]
        if pid and tv_core.pid_alive(pid):
            try:
                os.killpg(os.getpgid(int(pid)), signal.SIGTERM)
            except (OSError, ProcessLookupError):
                try:
                    os.kill(int(pid), signal.SIGTERM)
                except OSError:
                    pass
            for _ in range(30):  # up to ~3s for graceful shutdown
                if not tv_core.pid_alive(pid):
                    break
                time.sleep(0.1)
            if tv_core.pid_alive(pid):
                try:
                    os.killpg(os.getpgid(int(pid)), signal.SIGKILL)
                except (OSError, ProcessLookupError):
                    try:
                        os.kill(int(pid), signal.SIGKILL)
                    except OSError:
                        pass
        if ent:
            try:
                ent[1].close()
            except Exception:
                pass
        self._set_pid(sid, None)
        return self.get(sid)

    def restart(self, sid) -> dict:
        self.stop(sid)
        return self.start(sid)

    def logs(self, sid, lines=300) -> str:
        path = self._log_path(sid)
        if not os.path.isfile(path):
            return ""
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - 131072))  # last 128KB is plenty for a tail
            data = f.read()
        return "\n".join(data.decode("utf-8", "replace").splitlines()[-lines:])

    # ---- git ----
    def git_pull(self, sid) -> dict:
        """`git pull --ff-only` in the service's cwd; auto-restart if it was running."""
        row = self._get_row(sid)
        if not row:
            raise KeyError(sid)
        d = self._row(row)
        cwd = os.path.realpath(os.path.expanduser(d["cwd"]))
        if not os.path.isdir(cwd):
            raise ValueError("Working directory not found")
        # GIT_TERMINAL_PROMPT=0 so a private repo without cached creds fails fast
        # instead of hanging on an invisible credential prompt.
        env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": ""}
        # The service cwd is often a SUBDIRECTORY of the repo (e.g. <repo>/server),
        # so ask git — which walks up to the repo root — instead of looking for a
        # literal .git inside cwd.
        try:
            probe = subprocess.run(["git", "-C", cwd, "rev-parse", "--is-inside-work-tree"],
                                   capture_output=True, text=True, timeout=10, env=env,
                                   stdin=subprocess.DEVNULL)
        except FileNotFoundError:
            raise ValueError("git is not installed or not on PATH")
        except subprocess.TimeoutExpired:
            raise ValueError("git repository check timed out")
        if probe.returncode != 0 or probe.stdout.strip() != "true":
            raise ValueError("Not a git repository (no .git in the working directory or its parents)")
        was_running = self._running(sid, d["pid"])
        try:
            r = subprocess.run(["git", "-C", cwd, "pull", "--ff-only"], env=env,
                               capture_output=True, text=True, timeout=120,
                               stdin=subprocess.DEVNULL)
            output = ((r.stdout or "") + (r.stderr or "")).strip()
            code = r.returncode
        except subprocess.TimeoutExpired:
            output, code = "git pull timed out after 120s", -1
        ok = code == 0
        # Append the full git output to the service log so "View logs" can recover
        # it — the UI toast only shows a one-line summary.
        try:
            os.makedirs(tv_core.SERVER_LOG_DIR, exist_ok=True)
            with open(self._log_path(sid), "ab", buffering=0) as lf:
                lf.write((f"\n===== [thinkviewer] git pull {datetime.now().isoformat()} "
                          f"(exit {code}) =====\n{output}\n").encode())
        except Exception:
            pass
        restarted, restart_error = False, None
        if ok and was_running:
            try:
                self.restart(sid)
                restarted = True
            except Exception as e:
                restart_error = str(e)
                output += f"\n[thinkviewer] pulled OK but restart failed: {e}"
        return {"ok": ok, "code": code, "output": output, "restarted": restarted,
                "restart_error": restart_error, "service": self.get(sid)}

    def reconcile(self):
        """On boot: clear persisted PIDs whose process is no longer alive."""
        conn = get_db()
        for r in conn.execute("SELECT id,pid FROM services").fetchall():
            if r["pid"] and not tv_core.pid_alive(r["pid"]):
                conn.execute(
                    "UPDATE services SET pid=NULL, started_at=NULL WHERE id=?", (r["id"],))
        conn.commit()
        conn.close()

    # ---- discovery ----
    def discover(self) -> dict:
        base = self.base_dir()
        folders = []
        skip = {".git", "__pycache__", "node_modules", ".venv", "venv", "env",
                "dist", "build", "site-packages", ".next", ".cache", ".idea",
                "vendor", ".playwright-mcp", "coverage", ".pytest_cache"}
        entry_names = set(ENTRY_CANDIDATES) | {"manage.py"}
        if os.path.isdir(base):
            for name in sorted(os.listdir(base)):
                p = os.path.join(base, name)
                if name.startswith(".") or not os.path.isdir(p):
                    continue
                # Walk a few levels deep: top-level lists every .py; deeper levels
                # only surface entry-like files (run.py/main.py/app.py/…) so apps
                # whose runner lives in a subdir (e.g. server/run.py) are found.
                entries: list[str] = []
                base_depth = p.rstrip(os.sep).count(os.sep)
                for dp, dirs, files in os.walk(p):
                    depth = dp.count(os.sep) - base_depth
                    if depth >= 4:
                        dirs[:] = []
                        continue
                    dirs[:] = [d for d in dirs if d not in skip and not d.startswith(".")]
                    for f in files:
                        if f.endswith(".py") and (depth == 0 or f in entry_names):
                            entries.append(os.path.relpath(os.path.join(dp, f), p))
                entries = sorted(set(entries), key=lambda r: (r.count(os.sep), r.lower()))
                suggested = None
                for cand in ENTRY_CANDIDATES:
                    matches = sorted((e for e in entries if os.path.basename(e) == cand),
                                     key=lambda r: r.count(os.sep))
                    if matches:
                        suggested = matches[0]
                        break
                if not suggested and entries:
                    suggested = entries[0]
                has_venv = any(os.path.isdir(os.path.join(p, v)) for v in (".venv", "venv", "env"))
                folders.append({
                    "name": name, "path": p, "entries": entries,
                    "suggested_entry": suggested, "has_venv": has_venv,
                })
        return {"base_dir": base, "folders": folders}

    _PORT_PATTERNS = [
        re.compile(r'(?:os\.environ\.get|os\.getenv)\(\s*["\']PORT["\']\s*,\s*["\']?(\d{2,5})'),
        re.compile(r'add_argument\(\s*["\']--port["\'][^)]*?default\s*=\s*["\']?(\d{2,5})', re.S),
        re.compile(r'\.run\([^)]*?\bport\s*=\s*(\d{2,5})', re.S),
        re.compile(r'--port[ =]+(\d{2,5})'),
        re.compile(r'\bPORT\s*[=:]\s*["\']?(\d{2,5})'),
        re.compile(r'\bport\b[^\d\n]{0,15}(\d{4,5})', re.I),  # last resort (e.g. a comment)
    ]

    def suggest_port(self, cwd, entry="") -> int:
        """Guess a port: read it from the entry/.env, else pick the next free one."""
        cwd = os.path.realpath(os.path.expanduser(cwd or ""))
        for fp in [os.path.join(cwd, entry) if entry else "", os.path.join(cwd, ".env")]:
            if fp and os.path.isfile(fp):
                try:
                    text = open(fp, "r", errors="ignore").read()[:40000]
                except OSError:
                    continue
                for pat in self._PORT_PATTERNS:
                    m = pat.search(text)
                    if m:
                        port = int(m.group(1))
                        if 1 <= port <= 65535:
                            return port
        used = {s["port"] for s in self.list() if s.get("port")}
        port = 8000
        while (port in used or tv_core.port_open(port)) and port < 65000:
            port += 1
        return port

    # ---- environment setup (create a .venv + install requirements) ----
    def _setup_log_path(self, sid) -> str:
        return os.path.join(tv_core.SERVER_LOG_DIR, f"setup-{sid}.log")

    def setup_env(self, sid, base_python="") -> dict:
        row = self._get_row(sid)
        if not row:
            raise KeyError(sid)
        d = self._row(row)
        cwd = os.path.realpath(os.path.expanduser(d["cwd"]))
        if not os.path.isdir(cwd):
            raise ValueError("Working directory not found")
        base = base_python or sys.executable
        base = base if (os.path.isabs(base) and os.path.isfile(base)) else (shutil.which(base) or "")
        if not base:
            raise ValueError("Base Python interpreter not found")
        st = self._setups.get(sid)
        if st and st.get("running"):
            raise ValueError("Environment setup is already running")
        os.makedirs(tv_core.SERVER_LOG_DIR, exist_ok=True)
        with open(self._setup_log_path(sid), "w") as f:
            f.write(f"== create .venv in {cwd}\n== base python: {base}\n\n")
        self._setups[sid] = {
            "running": True, "success": None,
            "started_at": datetime.now().isoformat(), "venv_python": None,
        }
        threading.Thread(target=self._run_setup, args=(sid, cwd, base), daemon=True).start()
        return {"started": True}

    def _run_setup(self, sid, cwd, base):
        log = self._setup_log_path(sid)
        venv_dir = os.path.join(cwd, ".venv")
        venv_py = os.path.join(venv_dir, "bin", "python")
        ok = False
        try:
            with open(log, "a", buffering=1) as f:
                def run(cmd, label):
                    f.write(f"\n$ {label}\n")
                    proc = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE,
                                            stderr=subprocess.STDOUT, text=True, bufsize=1)
                    for line in proc.stdout:  # stream live to the log
                        f.write(line)
                    proc.wait()
                    return proc.returncode

                if os.path.isdir(venv_dir):  # recreate cleanly (handles broken venv)
                    shutil.rmtree(venv_dir, ignore_errors=True)
                if run([base, "-m", "venv", venv_dir],
                       f"{os.path.basename(base)} -m venv .venv") != 0 or not os.path.isfile(venv_py):
                    f.write("\n[error] could not create the virtual environment\n")
                    raise RuntimeError("venv")
                run([venv_py, "-m", "pip", "install", "--upgrade", "pip", "wheel"],
                    "pip install --upgrade pip wheel")
                req = os.path.join(cwd, "requirements.txt")
                if os.path.isfile(req):
                    if run([venv_py, "-m", "pip", "install", "-r", "requirements.txt"],
                           "pip install -r requirements.txt") != 0:
                        f.write("\n[error] pip install failed\n")
                        raise RuntimeError("pip")
                elif os.path.isfile(os.path.join(cwd, "pyproject.toml")):
                    if run([venv_py, "-m", "pip", "install", "."], "pip install .") != 0:
                        f.write("\n[error] pip install . failed\n")
                        raise RuntimeError("pip")
                else:
                    f.write("\n[warn] no requirements.txt / pyproject.toml — empty venv created\n")
                ok = True
                f.write("\n== DONE — environment ready ==\n")
        except Exception as e:
            try:
                with open(log, "a") as f:
                    f.write(f"\n[error] {e}\n== FAILED ==\n")
            except Exception:
                pass
        if ok:  # point the service at the freshly built interpreter
            conn = get_db()
            conn.execute("UPDATE services SET python=? WHERE id=?", (venv_py, sid))
            conn.commit()
            conn.close()
        st = self._setups.get(sid, {})
        st.update({"running": False, "success": ok, "venv_python": venv_py if ok else None})
        self._setups[sid] = st

    def setup_log(self, sid) -> dict:
        log = self._setup_log_path(sid)
        text = ""
        if os.path.isfile(log):
            with open(log, "rb") as f:
                f.seek(0, 2)
                size = f.tell()
                f.seek(max(0, size - 131072))
                text = f.read().decode("utf-8", "replace")
        st = self._setups.get(sid, {})
        return {
            "running": bool(st.get("running")),
            "success": st.get("success"),
            "venv_python": st.get("venv_python"),
            "log": text,
        }

    def interpreters(self, cwd="") -> list[dict]:
        out, seen = [], set()

        def add(label, path, kind):
            rp = path if (path and os.path.isabs(path)) else (shutil.which(path) if path else None)
            if rp and rp not in seen and os.path.isfile(rp):
                seen.add(rp)
                out.append({"label": label, "path": rp, "kind": kind})

        cwd = os.path.realpath(os.path.expanduser(cwd)) if cwd else ""
        if cwd and os.path.isdir(cwd):
            for v in (".venv", "venv", "env"):
                for b in ("bin/python", "bin/python3"):
                    cand = os.path.join(cwd, v, b)
                    if os.path.isfile(cand):
                        add(f"venv · {v}", cand, "venv")
                        break
        if shutil.which("pyenv"):
            try:
                root = subprocess.run(["pyenv", "root"], capture_output=True, text=True,
                                      timeout=5).stdout.strip()
                venvs = set(subprocess.run(
                    ["pyenv", "virtualenvs", "--bare", "--skip-aliases"],
                    capture_output=True, text=True, timeout=5).stdout.split())
                vers = subprocess.run(["pyenv", "versions", "--bare", "--skip-aliases"],
                                      capture_output=True, text=True, timeout=5).stdout.split()
                for v in vers:
                    label = f"pyenv venv · {v}" if v in venvs else f"pyenv · {v}"
                    add(label, os.path.join(root, "versions", v, "bin", "python"), "pyenv")
            except Exception:
                pass
        for c in sorted(glob.glob("/opt/homebrew/bin/python3.*")) + [
                "/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"]:
            if os.path.isfile(c) and not c.endswith("-config"):
                add(f"system · {os.path.basename(c)}", c, "system")
        add(f"current · {os.path.basename(sys.executable)}", sys.executable, "system")
        return out

    # ---- pyenv virtualenvs (create a named env to run a service with) ----
    def _pyenv_lists(self):
        """(base versions, virtualenv names) from pyenv, or ([], set())."""
        try:
            venvs = set(subprocess.run(
                ["pyenv", "virtualenvs", "--bare", "--skip-aliases"],
                capture_output=True, text=True, timeout=5).stdout.split())
            vers = subprocess.run(
                ["pyenv", "versions", "--bare", "--skip-aliases"],
                capture_output=True, text=True, timeout=5).stdout.split()
            return [v for v in vers if v not in venvs], venvs
        except Exception:
            return [], set()

    def pyenv_info(self) -> dict:
        if not shutil.which("pyenv"):
            return {"installed": False, "has_virtualenv": False, "versions": []}
        try:
            cmds = subprocess.run(["pyenv", "commands"], capture_output=True,
                                  text=True, timeout=5).stdout.split()
        except Exception:
            cmds = []
        base, _ = self._pyenv_lists()
        return {"installed": True, "has_virtualenv": "virtualenv" in cmds, "versions": base}

    def create_pyenv_virtualenv(self, base, name) -> dict:
        if not shutil.which("pyenv"):
            raise ValueError("pyenv is not installed")
        info = self.pyenv_info()
        if not info["has_virtualenv"]:
            raise ValueError("The pyenv-virtualenv plugin isn't installed "
                             "(brew install pyenv-virtualenv)")
        name = (name or "").strip()
        # Strict whitelist — also the value only ever reaches pyenv as an argv
        # element (never a shell), so this can't inject commands.
        if not re.match(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$", name):
            raise ValueError("Invalid name — use letters, numbers, dot, dash or underscore")
        base = (base or "").strip()
        if base not in info["versions"]:
            raise ValueError("Choose an installed pyenv base version")
        _, venvs = self._pyenv_lists()
        if name in venvs or name in info["versions"]:
            raise ValueError(f"A pyenv environment named '{name}' already exists")
        try:
            r = subprocess.run(["pyenv", "virtualenv", base, name],
                               capture_output=True, text=True, timeout=600)
        except subprocess.TimeoutExpired:
            raise ValueError("Creating the virtualenv timed out")
        if r.returncode != 0:
            raise ValueError((r.stderr or r.stdout or "pyenv virtualenv failed").strip()[:600])
        # Return the SAME path interpreters() discovers (pyenv stores the env under
        # versions/<base>/envs/<name> with a versions/<name> alias symlink) so the
        # UI can auto-select the new interpreter in the list.
        path = self._pyenv_venv_path(name)
        if not path:
            raise ValueError("Virtualenv created but its python interpreter was not found")
        return {"ok": True, "name": name, "path": path, "label": f"pyenv venv · {name}"}

    def _pyenv_venv_path(self, name):
        try:
            root = subprocess.run(["pyenv", "root"], capture_output=True,
                                  text=True, timeout=5).stdout.strip()
        except Exception:
            return None
        _, venvs = self._pyenv_lists()
        # prefer the bare entry interpreters() would list (e.g. 3.12.8/envs/<name>),
        # then the top-level alias.
        for v in [x for x in venvs if x == name or x.endswith(f"/envs/{name}")] + [name]:
            p = os.path.join(root, "versions", v, "bin", "python")
            if os.path.isfile(p):
                return p
        return None

    # ---- deploy (domain + HTTPS via deploy-kit; needs root → osascript) ----
    def _kit_dir(self) -> str:
        return os.path.join(self.base_dir(), "deploy-kit")

    def _public_ip(self):
        try:
            r = subprocess.run(["curl", "-sS", "--max-time", "5", "https://api.ipify.org"],
                               capture_output=True, text=True, timeout=8)
            return r.stdout.strip() or None
        except Exception:
            return None

    def deploy_info(self) -> dict:
        kit = self._kit_dir()
        def _bin(name):
            p = shutil.which(name) or f"/opt/homebrew/bin/{name}"
            return p if os.path.isfile(p) else None
        return {
            "kit_dir": kit,
            "kit_found": os.path.isfile(os.path.join(kit, "deploy.sh")),
            "nginx": _bin("nginx"),
            "certbot": _bin("certbot"),
            "public_ip": self._public_ip(),
        }

    def reachability(self, domain, port=80) -> dict:
        if not _DOMAIN_RE.match(domain or ""):
            raise ValueError("Invalid domain")
        script = os.path.join(self._kit_dir(), "check-reachability.sh")
        if not os.path.isfile(script):
            raise ValueError("deploy-kit/check-reachability.sh not found")
        try:
            r = subprocess.run(["bash", script, domain, str(int(port))],
                               capture_output=True, text=True, timeout=70)
            return {"output": (r.stdout + r.stderr)[-6000:], "code": r.returncode}
        except subprocess.TimeoutExpired:
            return {"output": "Reachability check timed out (the global probe was slow).", "code": -1}

    def _deploy_log_path(self, sid) -> str:
        # Archival copy, written by *this* (normal-user) process into server_logs.
        return os.path.join(tv_core.SERVER_LOG_DIR, f"deploy-{sid}.log")

    def _deploy_live_log(self, sid) -> str:
        # Live log the privileged (root) runner appends to. It MUST live outside
        # ~/Desktop: that tree is TCC-protected, so the root process spawned by
        # the osascript auth trampoline can't write there ("Operation not
        # permitted") — which previously surfaced as a bogus "authorization
        # cancelled or failed" even though the password was entered correctly.
        return f"/tmp/tv-deploy-{sid}.log"

    def deploy(self, sid, domain, email="", staging=False) -> dict:
        row = self._get_row(sid)
        if not row:
            raise KeyError(sid)
        d = self._row(row)
        if not d["port"]:
            raise ValueError("Give this service a port first — HTTPS proxies a domain to its port")
        if not _DOMAIN_RE.match(domain or ""):
            raise ValueError("Invalid domain")
        email = (email or "").strip()
        if email and not _EMAIL_RE.match(email):
            raise ValueError("Invalid email")
        kit = self._kit_dir()
        if not os.path.isfile(os.path.join(kit, "deploy.sh")):
            raise ValueError("deploy-kit/deploy.sh not found in the servers base dir")
        st = self._deploys.get(sid)
        if st and st.get("running"):
            raise ValueError("A deploy is already running for this service")

        # Persist the domain/email on the service.
        conn = get_db()
        conn.execute("UPDATE services SET domain=?, email=? WHERE id=?",
                     (domain, email or None, sid))
        conn.commit()
        conn.close()

        # Copy the kit out of TCC-protected ~/Desktop so root can read it.
        tmp_kit = "/tmp/tv-deploy-kit"
        shutil.rmtree(tmp_kit, ignore_errors=True)
        shutil.copytree(kit, tmp_kit)

        log = self._deploy_live_log(sid)  # /tmp — root-writable; archived at the end
        with open(log, "w") as f:
            f.write(f"== deploy https://{domain} -> 127.0.0.1:{d['port']}"
                    f"{'  (STAGING)' if staging else ''} ==\n"
                    "Waiting for the macOS administrator prompt on the host…\n\n")

        # A tiny runner script holds the (validated) tokens; osascript only ever
        # sees a fixed path, so no untrusted text reaches the AppleScript string.
        runner = f"/tmp/tv-deploy-run-{sid}.sh"
        staging_env = "STAGING=1 " if staging else ""
        with open(runner, "w") as f:
            f.write("#!/bin/bash\ncd /\n")
            f.write(f'{staging_env}/bin/bash {tmp_kit}/deploy.sh {domain} {int(d["port"])} '
                    f'{email} >> {log} 2>&1\n')
            f.write(f'echo "{_DEPLOY_EXIT_MARK}:$?" >> {log}\n')
        os.chmod(runner, 0o755)

        self._deploys[sid] = {
            "running": True, "domain": domain, "staging": staging,
            "started_at": datetime.now().isoformat(), "exit": None, "success": None,
        }
        threading.Thread(target=self._run_deploy, args=(sid, runner, log, domain),
                         daemon=True).start()
        return {"started": True, "domain": domain, "port": d["port"]}

    def _run_deploy(self, sid, runner, log, domain):
        osa_failed = False
        try:
            r = subprocess.run(
                ["osascript", "-e",
                 f'do shell script "/bin/bash {runner}" with administrator privileges'],
                capture_output=True, text=True, timeout=900)
            osa_failed = r.returncode != 0
            osa_err = (r.stderr or "").strip()
        except Exception as e:
            osa_failed, osa_err = True, str(e)
        success, exit_code = False, None
        try:
            text = open(log, "r", errors="replace").read()
            if "DONE — https://" in text or f"https://{domain} is live" in text:
                success = True
            m = re.findall(rf"{_DEPLOY_EXIT_MARK}:(\d+)", text)
            if m:
                exit_code = int(m[-1])
            if osa_failed and _DEPLOY_EXIT_MARK not in text:
                cancelled = any(s in osa_err for s in
                                ("-128", "User canceled", "User cancelled"))
                reason = ("Administrator authorization was cancelled on the host "
                          "— no password was entered."
                          if cancelled else
                          "The administrator command could not be run, so the deploy "
                          "never started (see the error above).")
                with open(log, "a") as f:
                    f.write(f"\n[thinkviewer] {reason}\n{osa_err}\n{_DEPLOY_EXIT_MARK}:1\n")
                exit_code = 1
        except Exception:
            pass
        # Mirror the live /tmp log into server_logs so it survives /tmp cleanup
        # and stays readable after a ThinkViewer restart.
        try:
            os.makedirs(tv_core.SERVER_LOG_DIR, exist_ok=True)
            shutil.copyfile(log, self._deploy_log_path(sid))
        except Exception:
            pass
        if success:
            conn = get_db()
            conn.execute("UPDATE services SET https=1 WHERE id=?", (sid,))
            conn.commit()
            conn.close()
        st = self._deploys.get(sid, {})
        st.update({"running": False, "exit": exit_code, "success": success})
        self._deploys[sid] = st
        try:
            os.remove(runner)
        except OSError:
            pass

    def deploy_log(self, sid) -> dict:
        # Prefer the live /tmp log while the deploy is in flight (and just after);
        # fall back to the archived server_logs copy once /tmp has been cleared.
        live = self._deploy_live_log(sid)
        log = live if os.path.isfile(live) else self._deploy_log_path(sid)
        text = ""
        if os.path.isfile(log):
            with open(log, "rb") as f:
                f.seek(0, 2)
                size = f.tell()
                f.seek(max(0, size - 131072))
                text = f.read().decode("utf-8", "replace")
        st = self._deploys.get(sid, {})
        return {
            "running": bool(st.get("running")),
            "success": st.get("success"),
            "exit": st.get("exit"),
            "domain": st.get("domain"),
            "log": text,
        }


server_manager = ServerManager()


@router.get("/api/servers")
async def servers_list(request: Request):
    tv_core.require(request)
    return await asyncio.to_thread(
        lambda: {"base_dir": server_manager.base_dir(), "services": server_manager.list()})


@router.get("/api/servers/discover")
async def servers_discover(request: Request):
    tv_core.require(request)
    return await asyncio.to_thread(server_manager.discover)


@router.get("/api/servers/interpreters")
async def servers_interpreters(request: Request, cwd: str = Query("")):
    tv_core.require(request)
    return await asyncio.to_thread(lambda: {"interpreters": server_manager.interpreters(cwd)})


@router.get("/api/servers/pyenv")
async def servers_pyenv_info(request: Request):
    tv_core.require(request)
    return await asyncio.to_thread(server_manager.pyenv_info)


@router.post("/api/servers/pyenv")
async def servers_pyenv_create(request: Request):
    tv_core.require(request)
    body = await request.json()
    try:
        return await asyncio.to_thread(
            server_manager.create_pyenv_virtualenv, body.get("base", ""), body.get("name", ""))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/servers/suggest-port")
async def servers_suggest_port(request: Request, cwd: str = Query(""), entry: str = Query("")):
    tv_core.require(request)
    return await asyncio.to_thread(lambda: {"port": server_manager.suggest_port(cwd, entry)})


@router.post("/api/servers/{sid}/setup-env")
async def servers_setup_env(sid: str, request: Request):
    tv_core.require(request)
    body = await request.json()
    try:
        return await asyncio.to_thread(server_manager.setup_env, sid, body.get("base_python", ""))
    except KeyError:
        raise HTTPException(status_code=404, detail="Service not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/servers/{sid}/setup-env/log")
async def servers_setup_log(sid: str, request: Request):
    tv_core.require(request)
    if not server_manager.get(sid):
        raise HTTPException(status_code=404, detail="Service not found")
    return await asyncio.to_thread(server_manager.setup_log, sid)


@router.post("/api/servers/base-dir")
async def servers_set_base_dir(request: Request):
    tv_core.require(request)
    body = await request.json()
    return {"base_dir": server_manager.set_base_dir(body.get("path", ""))}


@router.post("/api/servers")
async def servers_create(request: Request):
    tv_core.require(request)
    body = await request.json()
    try:
        return await asyncio.to_thread(server_manager.create, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/api/servers/{sid}")
async def servers_update(sid: str, request: Request):
    tv_core.require(request)
    body = await request.json()
    try:
        return await asyncio.to_thread(server_manager.update, sid, body)
    except KeyError:
        raise HTTPException(status_code=404, detail="Service not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/api/servers/{sid}")
async def servers_delete(sid: str, request: Request):
    tv_core.require(request)
    await asyncio.to_thread(server_manager.delete, sid)
    return {"success": True}


@router.post("/api/servers/{sid}/start")
async def servers_start(sid: str, request: Request):
    tv_core.require(request)
    try:
        return await asyncio.to_thread(server_manager.start, sid)
    except KeyError:
        raise HTTPException(status_code=404, detail="Service not found")
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/servers/{sid}/stop")
async def servers_stop(sid: str, request: Request):
    tv_core.require(request)
    res = await asyncio.to_thread(server_manager.stop, sid)
    if res is None:
        raise HTTPException(status_code=404, detail="Service not found")
    return res


@router.post("/api/servers/{sid}/restart")
async def servers_restart(sid: str, request: Request):
    tv_core.require(request)
    try:
        return await asyncio.to_thread(server_manager.restart, sid)
    except KeyError:
        raise HTTPException(status_code=404, detail="Service not found")
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/servers/{sid}/git-pull")
async def servers_git_pull(sid: str, request: Request):
    tv_core.require(request)
    try:
        return await asyncio.to_thread(server_manager.git_pull, sid)
    except KeyError:
        raise HTTPException(status_code=404, detail="Service not found")
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/servers/{sid}/logs")
async def servers_logs(sid: str, request: Request, lines: int = Query(300)):
    tv_core.require(request)
    if not server_manager.get(sid):
        raise HTTPException(status_code=404, detail="Service not found")
    text = await asyncio.to_thread(server_manager.logs, sid, min(max(lines, 10), 2000))
    return {"logs": text}


# ---- Deploy / HTTPS (domain → service port via deploy-kit + certbot) --------
@router.get("/api/deploy/info")
async def deploy_info(request: Request):
    tv_core.require(request)
    return await asyncio.to_thread(server_manager.deploy_info)


@router.post("/api/servers/{sid}/reachability")
async def servers_reachability(sid: str, request: Request):
    tv_core.require(request)
    body = await request.json()
    try:
        return await asyncio.to_thread(
            server_manager.reachability, body.get("domain", ""),
            int(body.get("port", 80) or 80))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/servers/{sid}/deploy")
async def servers_deploy(sid: str, request: Request):
    tv_core.require(request)
    body = await request.json()
    try:
        return await asyncio.to_thread(
            server_manager.deploy, sid, body.get("domain", ""),
            body.get("email", ""), bool(body.get("staging")))
    except KeyError:
        raise HTTPException(status_code=404, detail="Service not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/servers/{sid}/deploy/log")
async def servers_deploy_log(sid: str, request: Request):
    tv_core.require(request)
    if not server_manager.get(sid):
        raise HTTPException(status_code=404, detail="Service not found")
    return await asyncio.to_thread(server_manager.deploy_log, sid)
