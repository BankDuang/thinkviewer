"""
ThinkViewer - Remote Desktop Control Application
Similar to TeamViewer, accessible via browser on port 19080
"""
from __future__ import annotations

import os
import sys
import json
import uuid
import hashlib
import secrets
import string
import sqlite3
import asyncio
import base64
import io
import time
import platform
import shutil
import subprocess
import pty
import select
import socket
import glob
import zipfile
import struct
import fcntl
import termios
import threading
import signal
import atexit
import re
from pathlib import Path
from datetime import datetime, timedelta
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

from fastapi import (
    FastAPI, WebSocket, WebSocketDisconnect,
    HTTPException, Request, UploadFile, File, Form, Query
)
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

import mss
from PIL import Image, ImageDraw
import pyautogui

# macOS: import Quartz for proper double-click with clickState
_USE_QUARTZ = False
try:
    if platform.system() == "Darwin":
        import Quartz
        _USE_QUARTZ = True
except ImportError:
    pass


def _perform_double_click(x, y):
    """Perform a real double-click with proper OS click counts."""
    if _USE_QUARTZ:
        point = Quartz.CGPointMake(float(x), float(y))
        # Click 1: clickState=1
        e = Quartz.CGEventCreateMouseEvent(
            None, Quartz.kCGEventLeftMouseDown, point, Quartz.kCGMouseButtonLeft)
        Quartz.CGEventSetIntegerValueField(e, Quartz.kCGMouseEventClickState, 1)
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, e)
        e = Quartz.CGEventCreateMouseEvent(
            None, Quartz.kCGEventLeftMouseUp, point, Quartz.kCGMouseButtonLeft)
        Quartz.CGEventSetIntegerValueField(e, Quartz.kCGMouseEventClickState, 1)
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, e)
        # Click 2: clickState=2 (tells macOS it's a double-click)
        e = Quartz.CGEventCreateMouseEvent(
            None, Quartz.kCGEventLeftMouseDown, point, Quartz.kCGMouseButtonLeft)
        Quartz.CGEventSetIntegerValueField(e, Quartz.kCGMouseEventClickState, 2)
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, e)
        e = Quartz.CGEventCreateMouseEvent(
            None, Quartz.kCGEventLeftMouseUp, point, Quartz.kCGMouseButtonLeft)
        Quartz.CGEventSetIntegerValueField(e, Quartz.kCGMouseEventClickState, 2)
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, e)
    else:
        pyautogui.doubleClick(x, y, _pause=False)

# ============================================================
# Configuration
# ============================================================
PORT = int(os.getenv("THINKVIEWER_PORT", "19080"))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "thinkviewer.db")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
WALLPAPER_DIR = os.path.join(BASE_DIR, "static", "wallpapers")
FRONTEND_DIST = os.path.realpath(os.path.join(BASE_DIR, "frontend", "dist"))
ENV_PASSWORD = os.getenv("THINKVIEWER_PASSWORD")
# Upload limits / allowed wallpaper extensions
MAX_UPLOAD_BYTES = int(os.getenv("THINKVIEWER_MAX_UPLOAD_MB", "2048")) * 1024 * 1024
ALLOWED_WP_EXT = {".png", ".jpg", ".jpeg", ".webp"}
# Managed servers (the "Servers" process-manager app)
DEFAULT_SERVERS_DIR = os.path.realpath(
    os.path.expanduser(os.getenv("THINKVIEWER_SERVERS_DIR", "~/Desktop/public_server")))
SERVER_LOG_DIR = os.path.join(BASE_DIR, "server_logs")
ENTRY_CANDIDATES = ("run.py", "main.py", "app.py", "server.py", "wsgi.py", "asgi.py")
# Apps a user can be granted visibility of (mirrors the frontend AppKind union).
APP_KINDS = ["remote", "terminal", "files", "settings", "servers", "clientproject", "notes"]

# ---- Client Project (CRM + project tracking) "app" --------------------------
CP_FILES_DIR = os.path.join(BASE_DIR, "client_project_files")
NOTES_FILES_DIR = os.path.join(BASE_DIR, "notes_files")  # Notes app image attachments
# entity -> extra columns (besides id/created_at/updated_at). All stored as TEXT
# (SQLite is dynamically typed); generic CRUD drives every table from this map.
CP_ENTITIES = {
    "clients": ["name", "company", "contact_name", "contact_email", "contact_phone",
                "channels", "status", "value", "notes"],
    "projects": ["client_id", "name", "server_service", "owner", "start_date",
                 "deliver_date", "budget", "scope", "tech_stack", "domain", "server",
                 "repository", "status", "notes"],
    "phases": ["project_id", "name", "status", "owner", "pending", "waiting_client",
               "order_idx", "notes"],
    "tasks": ["project_id", "phase_id", "title", "description", "assignee", "status",
              "priority", "due_date", "attachments"],
    "issues": ["project_id", "title", "description", "severity", "status", "assignee",
               "resolution", "issue_date", "page", "fixed_date", "client_confirmed",
               "attachments", "fixes"],
    "change_requests": ["project_id", "title", "description", "impact_scope",
                        "impact_timeline", "impact_budget", "man_days", "status",
                        "approved_by", "approved_date"],
    "meeting_notes": ["project_id", "client_id", "title", "date", "attendees",
                      "summary", "decisions", "action_items", "waiting_client"],
    "requirements": ["project_id", "feature", "description", "priority", "status",
                     "in_scope", "wireframe", "conditions", "checklist", "order_idx"],
    "payments": ["client_id", "project_id", "title", "invoice_no", "amount",
                 "due_date", "paid", "paid_date", "installment", "notes"],
    "notes": ["project_id", "client_id", "title", "body", "attachments", "pinned"],
    "activity": ["project_id", "client_id", "kind", "message"],
    "files": ["project_id", "client_id", "issue_id", "name", "path", "category", "notes"],
}
# columns whose values are JSON (encoded on write, decoded on read).
CP_JSON = {
    "clients": {"channels"},
    "tasks": {"attachments"},
    "issues": {"attachments", "fixes"},
    "meeting_notes": {"action_items"},
    "requirements": {"checklist"},
    "notes": {"attachments"},
}

pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0


# ============================================================
# Wake / Keep-Awake (macOS: caffeinate, Linux: xdotool/dbus)
# ============================================================
_caffeinate_proc = None

def wake_screen():
    """Wake the display from sleep."""
    system = platform.system()
    try:
        if system == "Darwin":
            subprocess.Popen(["caffeinate", "-u", "-t", "5"],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        elif system == "Linux":
            subprocess.Popen(["xdotool", "key", "--clearmodifiers", "shift"],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        elif system == "Windows":
            import ctypes
            ES_DISPLAY_REQUIRED = 0x00000002
            ES_SYSTEM_REQUIRED = 0x00000001
            ctypes.windll.kernel32.SetThreadExecutionState(
                ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED)
    except Exception:
        pass

def keep_awake_start():
    """Prevent system/display sleep while clients are connected."""
    global _caffeinate_proc
    if _caffeinate_proc and _caffeinate_proc.poll() is None:
        return  # already running
    system = platform.system()
    try:
        if system == "Darwin":
            _caffeinate_proc = subprocess.Popen(
                ["caffeinate", "-dis"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        elif system == "Linux":
            _caffeinate_proc = subprocess.Popen(
                ["systemd-inhibit", "--what=idle:sleep", "--who=ThinkViewer",
                 "--why=Client connected", "sleep", "infinity"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass

def keep_awake_stop():
    """Allow system to sleep again when no clients remain."""
    global _caffeinate_proc
    if _caffeinate_proc:
        try:
            _caffeinate_proc.terminate()
        except Exception:
            pass
        _caffeinate_proc = None


# ============================================================
# PTY Terminal Sessions
# ============================================================
class TerminalSession:
    def __init__(self, session_id: str, loop: asyncio.AbstractEventLoop,
                 cwd: str | None = None, name: str = ""):
        self.session_id = session_id
        self.name: str = name
        self.loop = loop
        self.subscribers: set = set()  # WebSocket clients
        self.alive = True
        self._queue: asyncio.Queue = asyncio.Queue()
        self._scrollback: bytearray = bytearray()
        self._scrollback_limit = 64 * 1024  # 64KB ring buffer

        # Fork PTY
        shell = os.environ.get("SHELL", "/bin/bash")
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        # Ensure a UTF-8 locale so readline treats Thai/CJK as one glyph per
        # backspace/cursor move instead of slicing through multi-byte chars.
        if not env.get("LC_ALL") and not env.get("LC_CTYPE") and \
                "UTF-8" not in env.get("LANG", "") and "utf8" not in env.get("LANG", ""):
            env["LANG"] = "en_US.UTF-8"
            env["LC_CTYPE"] = "en_US.UTF-8"
        master_fd, slave_fd = pty.openpty()
        child_pid = os.fork()
        if child_pid == 0:
            # Child process
            os.close(master_fd)
            os.setsid()
            fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
            os.dup2(slave_fd, 0)
            os.dup2(slave_fd, 1)
            os.dup2(slave_fd, 2)
            if slave_fd > 2:
                os.close(slave_fd)
            if cwd:  # open directly in the project dir (Servers "Open in Terminal")
                try:
                    os.chdir(cwd)
                except OSError:
                    pass
            os.execvpe(shell, [shell, "-l"], env)
        else:
            # Parent process
            os.close(slave_fd)
            self.fd = master_fd
            self.pid = child_pid
            # Set initial size
            self.resize(24, 80)
            # Start reader thread
            self._reader_thread = threading.Thread(
                target=self._read_loop, daemon=True)
            self._reader_thread.start()

    def _read_loop(self):
        """Read PTY output in a thread and queue it for async broadcast."""
        while self.alive:
            try:
                ready, _, _ = select.select([self.fd], [], [], 0.1)
                if ready:
                    data = os.read(self.fd, 65536)
                    if not data:
                        break
                    # Store in scrollback
                    self._scrollback.extend(data)
                    if len(self._scrollback) > self._scrollback_limit:
                        excess = len(self._scrollback) - self._scrollback_limit
                        del self._scrollback[:excess]
                    # Queue for broadcast
                    self.loop.call_soon_threadsafe(self._queue.put_nowait, data)
            except OSError:
                break
        self.alive = False
        self.loop.call_soon_threadsafe(self._queue.put_nowait, None)

    def write(self, data: bytes):
        if self.alive:
            try:
                os.write(self.fd, data)
            except OSError:
                self.alive = False

    def resize(self, rows: int, cols: int):
        if self.alive:
            try:
                winsize = struct.pack("HHHH", rows, cols, 0, 0)
                fcntl.ioctl(self.fd, termios.TIOCSWINSZ, winsize)
            except OSError:
                pass

    def get_replay_buffer(self) -> bytes:
        """Return terminal reset + scrollback for reconnecting clients."""
        if not self._scrollback:
            return b""
        # \033c = RIS (Reset to Initial State) clears the terminal fully
        # before replaying recent output, preventing garbled rendering
        return b"\033c" + bytes(self._scrollback)

    def close(self):
        self.alive = False
        # Kill the entire process group so child processes also die
        try:
            os.killpg(os.getpgid(self.pid), signal.SIGTERM)
        except (OSError, ProcessLookupError):
            pass
        # SIGKILL fallback after a brief wait
        try:
            pid_result, _ = os.waitpid(self.pid, os.WNOHANG)
            if pid_result == 0:
                os.killpg(os.getpgid(self.pid), signal.SIGKILL)
                os.waitpid(self.pid, os.WNOHANG)
        except (ChildProcessError, OSError):
            pass
        try:
            os.close(self.fd)
        except OSError:
            pass


class TerminalManager:
    def __init__(self):
        self.sessions: dict[str, TerminalSession] = {}
        self._broadcast_tasks: dict[str, asyncio.Task] = {}
        self.loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop

    def create(self, session_id: str | None = None, cwd: str | None = None,
               name: str = "") -> TerminalSession:
        if session_id is None:
            session_id = str(uuid.uuid4())[:8]
        session = TerminalSession(session_id, self.loop, cwd=cwd, name=name)
        self.sessions[session_id] = session
        # Start broadcast task
        task = asyncio.create_task(self._broadcast_loop(session))
        self._broadcast_tasks[session_id] = task
        return session

    async def _broadcast_loop(self, session: TerminalSession):
        """Read from session queue and broadcast to subscribers."""
        while True:
            data = await session._queue.get()
            if data is None:
                # Session ended
                break
            encoded = base64.b64encode(data).decode()
            msg = json.dumps({
                "type": "term_output",
                "session_id": session.session_id,
                "data": encoded,
            })
            dead = set()
            for ws in list(session.subscribers):
                try:
                    await ws.send_text(msg)
                except Exception:
                    dead.add(ws)
            session.subscribers -= dead

    def get(self, session_id: str) -> TerminalSession | None:
        return self.sessions.get(session_id)

    def close(self, session_id: str):
        session = self.sessions.pop(session_id, None)
        if session:
            session.close()
        task = self._broadcast_tasks.pop(session_id, None)
        if task:
            task.cancel()

    def list_sessions(self) -> list[dict]:
        return [
            {"session_id": sid, "alive": s.alive, "name": s.name}
            for sid, s in self.sessions.items()
        ]

    def close_all(self):
        for sid in list(self.sessions.keys()):
            self.close(sid)

    def unsubscribe_all(self, ws):
        """Remove a WebSocket from all session subscribers."""
        for session in self.sessions.values():
            session.subscribers.discard(ws)


term_manager = TerminalManager()

# All currently-authenticated WebSocket connections (used to broadcast
# terminal create/close events to every connected client).
_all_ws: set = set()

# Ensure all PTY sessions are killed when server exits (any exit path)
atexit.register(lambda: term_manager.close_all())


# ============================================================
# Database
# ============================================================
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    c = conn.cursor()

    c.execute("""CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        created_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT,
        ip_address TEXT
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS connection_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip_address TEXT,
        action TEXT,
        timestamp TEXT DEFAULT (datetime('now'))
    )""")
    # Speeds the per-IP failed-login count run on every login attempt.
    c.execute("CREATE INDEX IF NOT EXISTS idx_conn_log_ip_action_ts "
              "ON connection_log (ip_address, action, timestamp)")

    # Managed services for the "Servers" process-manager app
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

    # Client Project (CRM) tables — generic, driven by CP_ENTITIES.
    for _ent, _cols in CP_ENTITIES.items():
        _defs = ", ".join(f"{_c} TEXT" for _c in _cols)
        c.execute(f"CREATE TABLE IF NOT EXISTS cp_{_ent} "
                  f"(id TEXT PRIMARY KEY, {_defs}, created_at TEXT, updated_at TEXT)")
        _have = {r[1] for r in c.execute(f"PRAGMA table_info(cp_{_ent})").fetchall()}
        for _c in _cols:  # forward-compatible column adds
            if _c not in _have:
                c.execute(f"ALTER TABLE cp_{_ent} ADD COLUMN {_c} TEXT")

    # Notes app (standalone — not the CRM's cp_notes): note + checklist + images.
    c.execute("""CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY, title TEXT, body TEXT, checklist TEXT, images TEXT,
        pinned TEXT, color TEXT, created_at TEXT, updated_at TEXT)""")

    # Users + per-user app visibility (admin = the connection password)
    c.execute("""CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        password_hash TEXT,
        role TEXT,
        apps TEXT,
        created_at TEXT
    )""")
    # sessions gain user_id so a token resolves to a user.
    _sess_cols = {r[1] for r in c.execute("PRAGMA table_info(sessions)").fetchall()}
    if "user_id" not in _sess_cols:
        c.execute("ALTER TABLE sessions ADD COLUMN user_id TEXT")

    conn.commit()

    # Generate device ID if not exists
    c.execute("SELECT value FROM settings WHERE key='device_id'")
    if not c.fetchone():
        did = ''.join(secrets.choice(string.digits) for _ in range(9))
        device_id = f"{did[:3]}-{did[3:6]}-{did[6:9]}"
        c.execute("INSERT INTO settings (key, value) VALUES ('device_id', ?)", (device_id,))
    else:
        device_id = c.execute("SELECT value FROM settings WHERE key='device_id'").fetchone()[0]

    # Set password from .env (always sync), or generate if no .env and no DB entry
    if ENV_PASSWORD:
        password = ENV_PASSWORD
        pw_hash = hashlib.sha256(password.encode()).hexdigest()
        c.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('password', ?)", (password,))
        c.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('password_hash', ?)", (pw_hash,))
    else:
        c.execute("SELECT value FROM settings WHERE key='password'")
        row = c.fetchone()
        if not row:
            password = ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(6))
            pw_hash = hashlib.sha256(password.encode()).hexdigest()
            c.execute("INSERT INTO settings (key, value) VALUES ('password', ?)", (password,))
            c.execute("INSERT INTO settings (key, value) VALUES ('password_hash', ?)", (pw_hash,))
        else:
            password = row[0]

    # Bootstrap an 'admin' user from the connection password if none exist yet,
    # so the current password logs in as admin (username "admin").
    if not c.execute("SELECT 1 FROM users LIMIT 1").fetchone():
        admin_hash = (c.execute("SELECT value FROM settings WHERE key='password_hash'")
                      .fetchone() or [None])[0]
        c.execute(
            "INSERT INTO users (id, username, password_hash, role, apps, created_at) "
            "VALUES (?,?,?,?,?,?)",
            (uuid.uuid4().hex[:8], "admin", admin_hash, "admin",
             json.dumps(APP_KINDS), datetime.now().isoformat()))

    # THINKVIEWER_PASSWORD, when set, is authoritative for the admin login: keep
    # the admin's hash in sync with it on every boot so the shown connection
    # password matches and changing the env var still recovers admin access.
    if ENV_PASSWORD:
        c.execute("UPDATE users SET password_hash=? WHERE username='admin'",
                  (hashlib.sha256(ENV_PASSWORD.encode()).hexdigest(),))

    conn.commit()
    conn.close()

    print(f"\n{'=' * 50}")
    print(f"  ThinkViewer - Remote Desktop Control")
    print(f"  Device ID : {device_id}")
    print(f"  Password  : {password}")
    print(f"  URL       : http://localhost:{PORT}")
    print(f"{'=' * 50}\n")


def get_setting(key):
    conn = get_db()
    row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    conn.close()
    return row[0] if row else None


def set_setting(key, value):
    conn = get_db()
    conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value))
    conn.commit()
    conn.close()


# ============================================================
# Authentication
# ============================================================
def verify_password(password):
    pw_hash = hashlib.sha256(password.encode()).hexdigest()
    stored_hash = get_setting("password_hash")
    return stored_hash is not None and pw_hash == stored_hash


def create_session(ip_address="", user_id=None):
    token = str(uuid.uuid4())
    conn = get_db()
    # expires_at uses SQLite UTC so it compares correctly against datetime('now')
    # (a naive local-time string drifted the real TTL on non-UTC hosts).
    conn.execute(
        "INSERT INTO sessions (token, expires_at, ip_address, user_id) "
        "VALUES (?, datetime('now', '+24 hours'), ?, ?)",
        (token, ip_address, user_id),
    )
    conn.commit()
    conn.close()
    return token


def _user_for_token(token):
    """The user a (valid, unexpired) token belongs to, or None."""
    if not token:
        return None
    conn = get_db()
    row = conn.execute(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token=? AND s.expires_at > datetime('now')", (token,)).fetchone()
    conn.close()
    if not row:
        return None
    return {"id": row["id"], "username": row["username"], "role": row["role"],
            "apps": json.loads(row["apps"] or "[]")}


def verify_user(username, password):
    """Resolve a username/password to a user dict, or None."""
    if not username or not password:
        return None
    pw_hash = hashlib.sha256(password.encode()).hexdigest()
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    conn.close()
    if row and row["password_hash"] and secrets.compare_digest(pw_hash, row["password_hash"]):
        return {"id": row["id"], "username": row["username"], "role": row["role"],
                "apps": json.loads(row["apps"] or "[]")}
    return None


def _current_user(request: "Request"):
    """The authenticated user for this request, or 401."""
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    user = _user_for_token(token)
    if not user:
        raise HTTPException(status_code=401)
    return user


def _require_admin(request: "Request"):
    user = _current_user(request)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user


# --- Login brute-force protection (per-IP, derived from connection_log) ------
LOGIN_MAX_FAILS = 5        # wrong-password attempts allowed per IP ...
LOGIN_BAN_WINDOW_MIN = 60  # ... within this window; also ~how long the block lasts
_TRUSTED_PROXIES = {"127.0.0.1", "::1"}  # our deploy-kit nginx runs on this host
_login_lock = asyncio.Lock()             # serialize attempts so the cap is race-free
_users_lock = asyncio.Lock()             # serialize user mutations (atomic last-admin guard)


def _client_ip(request: "Request") -> str:
    """Real client IP. Proxy headers (X-Real-IP / X-Forwarded-For) are honored
    ONLY when the request arrived from our local nginx (a loopback peer) — a direct
    connection (e.g. THINKVIEWER_BIND=0.0.0.0) must not be able to forge them to
    evade the ban or to frame/lock-out a victim IP."""
    peer = request.client.host if request.client else ""
    if peer in _TRUSTED_PROXIES:
        xri = (request.headers.get("x-real-ip") or "").strip()
        if xri:
            return xri
        xff = (request.headers.get("x-forwarded-for") or "").strip()
        if xff:
            return xff.split(",")[-1].strip()  # last hop = added by our nginx
    return peer or "unknown"


def _recent_login_fails(ip: str) -> int:
    """Failed login attempts from this IP within the ban window."""
    conn = get_db()
    row = conn.execute(
        "SELECT COUNT(*) FROM connection_log WHERE ip_address=? AND action='login_fail' "
        "AND timestamp >= datetime('now', ?)",
        (ip, f"-{LOGIN_BAN_WINDOW_MIN} minutes")).fetchone()
    conn.close()
    return int(row[0]) if row else 0


def verify_token(token):
    return _user_for_token(token) is not None


def delete_session(token):
    conn = get_db()
    conn.execute("DELETE FROM sessions WHERE token=?", (token,))
    conn.commit()
    conn.close()


# ============================================================
# Screen Capture & Streaming
# ============================================================
class ScreenStreamer:
    def __init__(self):
        self.clients: set = set()
        self.quality = 75
        self.fps = 12
        self.scale = 1.0
        self.running = False
        self.screen_width = 0
        self.screen_height = 0
        self._prev_frame_hash: bytes | None = None  # dirty-frame detection
        self._last_sent_time = 0.0
        self.modifier_down_times: dict[str, float] = {}  # key -> timestamp
        # Physical pixels per logical pixel (>1 on HiDPI/Retina displays).
        # mss captures physical pixels; pyautogui uses logical pixels.
        self._hiDPI_ratio = 1.0

    def _draw_cursor(self, pil_img):
        """Draw mouse cursor overlay on the captured image."""
        try:
            cx, cy = pyautogui.position()
            # cursor is in logical pixels; image width = logical_w * scale
            effective_scale = self.scale / self._hiDPI_ratio
            img_scale = self._hiDPI_ratio * effective_scale  # == self.scale
            cx = int(cx * img_scale)
            cy = int(cy * img_scale)
            s = max(14, int(22 * img_scale))
            draw = ImageDraw.Draw(pil_img)

            # Arrow cursor polygon (white fill, black outline)
            arrow = [
                (cx, cy),
                (cx, cy + s),
                (cx + int(s * 0.3), cy + int(s * 0.73)),
                (cx + int(s * 0.48), cy + int(s * 1.02)),
                (cx + int(s * 0.63), cy + int(s * 0.93)),
                (cx + int(s * 0.42), cy + int(s * 0.63)),
                (cx + int(s * 0.72), cy + int(s * 0.56)),
            ]
            draw.polygon(arrow, fill="white", outline="black", width=1)
        except Exception:
            pass

    async def start(self):
        self.running = True
        try:
            with mss.mss() as sct:
                monitor = sct.monitors[1]
                phys_w, phys_h = monitor["width"], monitor["height"]

                # On HiDPI/Retina displays mss returns physical pixels while
                # pyautogui (mouse control) uses logical (OS-scaled) pixels.
                # We store logical dimensions for coordinate mapping so clicks
                # land at the correct position regardless of display scaling.
                try:
                    logical_w, logical_h = pyautogui.size()
                    self._hiDPI_ratio = phys_w / logical_w if logical_w > 0 else 1.0
                except Exception:
                    logical_w, logical_h = phys_w, phys_h
                    self._hiDPI_ratio = 1.0

                self.screen_width = logical_w
                self.screen_height = logical_h

                while self.running:
                    if self.clients:
                        try:
                            img = sct.grab(monitor)
                            pil_img = Image.frombytes("RGB", img.size, img.bgra, "raw", "BGRX")

                            # effective_scale maps physical capture → output image.
                            # scale=1.0 always produces logical-resolution output,
                            # regardless of HiDPI ratio. scale=0.5 gives half that.
                            effective_scale = self.scale / self._hiDPI_ratio
                            if abs(effective_scale - 1.0) > 0.005:
                                new_w = max(1, int(pil_img.width * effective_scale))
                                new_h = max(1, int(pil_img.height * effective_scale))
                                pil_img = pil_img.resize((new_w, new_h), Image.BILINEAR)

                            self._draw_cursor(pil_img)

                            buf = io.BytesIO()
                            pil_img.save(buf, format="JPEG", quality=self.quality)
                            frame_bytes = buf.getvalue()

                            # Skip unchanged frames (keepalive every 2s)
                            frame_hash = hashlib.md5(frame_bytes).digest()
                            now_t = time.time()
                            changed = (frame_hash != self._prev_frame_hash
                                       or now_t - self._last_sent_time >= 2.0)
                            if changed:
                                self._prev_frame_hash = frame_hash
                                self._last_sent_time = now_t

                                # Send raw JPEG binary (no base64/JSON overhead)
                                dead = set()
                                for ws in list(self.clients):
                                    try:
                                        await ws.send_bytes(frame_bytes)
                                    except Exception:
                                        dead.add(ws)
                                self.clients -= dead
                        except Exception as e:
                            print(f"Capture error: {e}")

                    # Auto-release any modifier held longer than 2s
                    now = time.time()
                    stale = [k for k, t in self.modifier_down_times.items()
                             if now - t > 2.0]
                    for key in stale:
                        try:
                            pyautogui.keyUp(key, _pause=False)
                        except Exception:
                            pass
                        # Also release "option" alias when releasing "alt"
                        if key == "alt":
                            try:
                                pyautogui.keyUp("option", _pause=False)
                            except Exception:
                                pass
                        self.modifier_down_times.pop(key, None)

                    # Always keep fn released
                    try:
                        pyautogui.keyUp("fn", _pause=False)
                    except Exception:
                        pass

                    await asyncio.sleep(1.0 / self.fps)
        except asyncio.CancelledError:
            pass

    def update_settings(self, quality=None, fps=None, scale=None):
        if quality is not None:
            self.quality = max(10, min(100, int(quality)))
        if fps is not None:
            self.fps = max(1, min(30, int(fps)))
        if scale is not None:
            self.scale = max(0.25, min(2.0, float(scale)))


streamer = ScreenStreamer()


# ============================================================
# Server Manager (process manager for sibling apps)
# ============================================================
def _pid_alive(pid) -> bool:
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, ProcessLookupError, ValueError):
        return False


def _port_open(port):
    """True/False if a TCP port is accepting connections, None if no port set."""
    if not port:
        return None
    try:
        with socket.create_connection(("127.0.0.1", int(port)), timeout=0.25):
            return True
    except OSError:
        return False


_DOMAIN_RE = re.compile(
    r"^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_DEPLOY_EXIT_MARK = "__TVDEPLOY_EXIT__"


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
        return get_setting("server_base_dir") or DEFAULT_SERVERS_DIR

    def set_base_dir(self, path: str) -> str:
        path = os.path.realpath(os.path.expanduser(path or DEFAULT_SERVERS_DIR))
        set_setting("server_base_dir", path)
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
        return os.path.join(SERVER_LOG_DIR, f"{sid}.log")

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
        return _pid_alive(pid)

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
            "port_open": _port_open(d["port"]) if running else (False if d["port"] else None),
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
        os.makedirs(SERVER_LOG_DIR, exist_ok=True)
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
        if pid and _pid_alive(pid):
            try:
                os.killpg(os.getpgid(int(pid)), signal.SIGTERM)
            except (OSError, ProcessLookupError):
                try:
                    os.kill(int(pid), signal.SIGTERM)
                except OSError:
                    pass
            for _ in range(30):  # up to ~3s for graceful shutdown
                if not _pid_alive(pid):
                    break
                time.sleep(0.1)
            if _pid_alive(pid):
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
            os.makedirs(SERVER_LOG_DIR, exist_ok=True)
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
            if r["pid"] and not _pid_alive(r["pid"]):
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
        while (port in used or _port_open(port)) and port < 65000:
            port += 1
        return port

    # ---- environment setup (create a .venv + install requirements) ----
    def _setup_log_path(self, sid) -> str:
        return os.path.join(SERVER_LOG_DIR, f"setup-{sid}.log")

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
        os.makedirs(SERVER_LOG_DIR, exist_ok=True)
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
        return os.path.join(SERVER_LOG_DIR, f"deploy-{sid}.log")

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
            os.makedirs(SERVER_LOG_DIR, exist_ok=True)
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


# ============================================================
# Auto-Updater (CI/CD)
# ============================================================
def _set_clipboard_image(path: str, mime: str = "image/png") -> bool:
    """Copy an image file into the server OS clipboard.

    Claude Code reads from the OS clipboard via osascript / xclip / wl-paste,
    so setting it here lets Ctrl-V work inside the remote terminal exactly as
    it does on a local machine.  Returns True if a clipboard tool was found.
    """
    try:
        system = platform.system()
        if system == "Darwin":
            # capture_output must NOT be used — osascript needs GUI session
            # access for clipboard operations; piped stdio breaks that on macOS.
            # The path is passed as an AppleScript argument (never interpolated
            # into the script text) so a hostile filename can't inject commands.
            subprocess.run(
                ["osascript",
                 "-e", "on run {p}",
                 "-e", "set the clipboard to (read (POSIX file p) as «class PNGf»)",
                 "-e", "end run",
                 path],
                timeout=5, check=True,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            return True
        # Linux – try xclip (X11) then wl-copy (Wayland)
        if shutil.which("xclip"):
            subprocess.run(
                ["xclip", "-selection", "clipboard", "-t", mime, "-i", path],
                timeout=5, check=True,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            return True
        if shutil.which("wl-copy"):
            with open(path, "rb") as fh:
                subprocess.run(
                    ["wl-copy", "--type", mime],
                    stdin=fh, timeout=5, check=True,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
            return True
    except Exception as exc:
        print(f"[ClipboardBridge] set image failed: {exc}", flush=True)
    return False


def _git_run(*args, timeout=20):
    """Run a git command in the project directory."""
    return subprocess.run(
        ["git"] + list(args),
        cwd=BASE_DIR,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def _auto_update_loop():
    """Background thread: check GitHub for updates every 30s, hard-pull & restart if found."""
    # Brief delay so the server finishes startup before first check
    time.sleep(10)
    while True:
        try:
            fetch = _git_run("fetch", "origin", timeout=20)
            if fetch.returncode != 0:
                time.sleep(30)
                continue

            local = _git_run("rev-parse", "HEAD").stdout.strip()
            remote = _git_run("rev-parse", "FETCH_HEAD").stdout.strip()

            if local and remote and local != remote:
                # Only update when remote is strictly ahead of local.
                # If local is ahead (unpushed commits), skip — don't wipe work.
                is_ancestor = _git_run("merge-base", "--is-ancestor", local, remote)
                if is_ancestor.returncode != 0:
                    # local is NOT an ancestor of remote = local is ahead or diverged
                    time.sleep(30)
                    continue
                print(
                    f"\n[AutoUpdate] New version detected "
                    f"({local[:7]} -> {remote[:7]}), applying update...",
                    flush=True,
                )
                reset = _git_run("reset", "--hard", "FETCH_HEAD")
                if reset.returncode == 0:
                    print("[AutoUpdate] Update applied. Restarting now...", flush=True)
                    # Release OS resources that would otherwise be orphaned by execv.
                    try:
                        term_manager.close_all()  # kill PTYs before re-exec
                        streamer.running = False
                        keep_awake_stop()  # stop caffeinate (else Mac stays awake forever)
                    except Exception:
                        pass
                    time.sleep(0.5)
                    os.execv(sys.executable, [sys.executable] + sys.argv)
                else:
                    print(
                        f"[AutoUpdate] Hard reset failed: {reset.stderr.strip()}",
                        flush=True,
                    )
        except subprocess.TimeoutExpired:
            print("[AutoUpdate] git fetch timed out, will retry in 30s.", flush=True)
        except Exception as e:
            print(f"[AutoUpdate] Error: {e}", flush=True)
        time.sleep(30)


def start_auto_updater():
    """Start the auto-update background thread (only when running inside a git repo).

    Enabled by default (production CI/CD); set THINKVIEWER_AUTOUPDATE=0 to disable
    during development so a `git reset --hard` never wipes the working tree.
    """
    if os.getenv("THINKVIEWER_AUTOUPDATE", "1").lower() in ("0", "false", "no", "off"):
        print("[AutoUpdate] Disabled via THINKVIEWER_AUTOUPDATE=0.")
        return
    try:
        check = _git_run("rev-parse", "--is-inside-work-tree", timeout=5)
        if check.returncode != 0 or check.stdout.strip() != "true":
            print("[AutoUpdate] Not a git repository — auto-updater disabled.")
            return
    except (FileNotFoundError, subprocess.TimeoutExpired):
        print("[AutoUpdate] git not available — auto-updater disabled.")
        return

    t = threading.Thread(target=_auto_update_loop, daemon=True, name="auto-updater")
    t.start()
    current = _git_run("rev-parse", "--short", "HEAD").stdout.strip()
    print(f"[AutoUpdate] Started — current commit {current}, checking every 30s.")


# ============================================================
# Input Handler
# ============================================================
def handle_input(data):
    try:
        event_type = data.get("type")
        sw = streamer.screen_width
        sh = streamer.screen_height

        if event_type == "mouse_move":
            x, y = int(data["x"] * sw), int(data["y"] * sh)
            pyautogui.moveTo(x, y, _pause=False)

        elif event_type == "mouse_click":
            x, y = int(data["x"] * sw), int(data["y"] * sh)
            pyautogui.click(x, y, button=data.get("button", "left"), _pause=False)

        elif event_type == "mouse_dblclick":
            x, y = int(data["x"] * sw), int(data["y"] * sh)
            _perform_double_click(x, y)

        elif event_type == "mouse_down":
            x, y = int(data["x"] * sw), int(data["y"] * sh)
            pyautogui.mouseDown(x=x, y=y, button=data.get("button", "left"), _pause=False)

        elif event_type == "mouse_up":
            x, y = int(data["x"] * sw), int(data["y"] * sh)
            pyautogui.mouseUp(x=x, y=y, button=data.get("button", "left"), _pause=False)

        elif event_type == "mouse_scroll":
            x, y = int(data["x"] * sw), int(data["y"] * sh)
            pyautogui.scroll(data.get("delta", 0), x=x, y=y, _pause=False)

        elif event_type == "key_down":
            key = data.get("key", "")
            if key:
                pyautogui.keyDown(key, _pause=False)
                if key in ("ctrl", "alt", "shift", "command"):
                    streamer.modifier_down_times[key] = time.time()

        elif event_type == "key_up":
            key = data.get("key", "")
            if key:
                pyautogui.keyUp(key, _pause=False)
                streamer.modifier_down_times.pop(key, None)
                # Also release "option" alias when releasing "alt"
                if key == "alt":
                    try:
                        pyautogui.keyUp("option", _pause=False)
                    except Exception:
                        pass

        elif event_type == "key_press":
            key = data.get("key", "")
            if key:
                pyautogui.press(key, _pause=False)

        elif event_type == "key_combo":
            keys = data.get("keys", [])
            if keys:
                modifiers = [k for k in keys if k in ("ctrl", "alt", "shift", "command", "win")]
                try:
                    pyautogui.hotkey(*keys, _pause=False)
                finally:
                    for m in modifiers:
                        try:
                            pyautogui.keyUp(m, _pause=False)
                        except Exception:
                            pass
                    streamer.modifier_down_times.clear()

        elif event_type == "release_modifiers":
            for key in ("ctrl", "alt", "shift", "command", "option"):
                try:
                    pyautogui.keyUp(key, _pause=False)
                except Exception:
                    pass
            streamer.modifier_down_times.clear()

        elif event_type == "type_text":
            text = data.get("text", "")
            if text:
                pyautogui.write(text, _pause=False)

    except Exception as e:
        print(f"Input error: {e}")


# ============================================================
# App Lifecycle
# ============================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    os.makedirs(WALLPAPER_DIR, exist_ok=True)
    os.makedirs(SERVER_LOG_DIR, exist_ok=True)
    init_db()
    server_manager.reconcile()  # recover managed-service status after a restart
    term_manager.set_loop(asyncio.get_event_loop())
    task = asyncio.create_task(streamer.start())
    yield
    streamer.running = False
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    term_manager.close_all()


app = FastAPI(title="ThinkViewer", lifespan=lifespan)
# /static serves built-in + uploaded wallpapers (and any legacy assets).
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")
# /assets serves the Vite-built JS/CSS bundle (only present after `npm run build`).
_dist_assets = os.path.join(FRONTEND_DIST, "assets")
if os.path.isdir(_dist_assets):
    app.mount("/assets", StaticFiles(directory=_dist_assets), name="assets")


# ============================================================
# Routes
# ============================================================
@app.post("/api/auth/login")
async def login(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid request")
    username = str(body.get("username", "")).strip()
    password = body.get("password", "")
    ip = _client_ip(request)

    # Serialize attempts so concurrent/pipelined requests can't slip past the cap.
    async with _login_lock:
        fails = _recent_login_fails(ip)
        # Brute-force guard: block the IP once it has too many recent failures.
        if fails >= LOGIN_MAX_FAILS:
            raise HTTPException(
                status_code=429,
                detail=f"Too many failed attempts — this IP is blocked. "
                       f"Try again in up to {LOGIN_BAN_WINDOW_MIN} minutes.")

        user = verify_user(username, password)
        if user:
            conn = get_db()
            # A correct login clears this IP's failure streak.
            conn.execute("DELETE FROM connection_log WHERE ip_address=? AND action='login_fail'", (ip,))
            conn.execute("INSERT INTO connection_log (ip_address, action) VALUES (?, 'login')", (ip,))
            conn.commit()
            conn.close()
            return {
                "success": True,
                "token": create_session(ip, user["id"]),
                "user": {"username": user["username"], "role": user["role"], "apps": user["apps"]},
            }

        # Wrong credentials — record the failure. Keep the message generic (don't
        # reveal whether the username exists, nor the remaining-attempt count).
        conn = get_db()
        conn.execute("INSERT INTO connection_log (ip_address, action) VALUES (?, 'login_fail')", (ip,))
        conn.commit()
        conn.close()
        if fails + 1 >= LOGIN_MAX_FAILS:
            raise HTTPException(
                status_code=429,
                detail=f"Too many failed attempts — this IP is now blocked for up to "
                       f"{LOGIN_BAN_WINDOW_MIN} minutes.")
        raise HTTPException(status_code=401, detail="Invalid username or password")


@app.post("/api/auth/logout")
async def logout(request: Request):
    body = await request.json()
    delete_session(body.get("token", ""))
    return {"success": True}


@app.get("/api/me")
async def get_me(request: Request):
    u = _current_user(request)
    return {"username": u["username"], "role": u["role"], "apps": u["apps"]}


# ---- Users (admin-only management) ----------------------------------------
_USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{2,32}$")


def _clean_apps(apps):
    return [a for a in apps if a in APP_KINDS] if isinstance(apps, list) else []


def _user_public(row) -> dict:
    return {"id": row["id"], "username": row["username"], "role": row["role"],
            "apps": json.loads(row["apps"] or "[]")}


@app.get("/api/users")
async def users_list(request: Request):
    _require_admin(request)

    def work():
        conn = get_db()
        rows = conn.execute("SELECT * FROM users ORDER BY username COLLATE NOCASE").fetchall()
        conn.close()
        return [_user_public(r) for r in rows]

    return {"users": await asyncio.to_thread(work), "app_kinds": APP_KINDS}


@app.post("/api/users")
async def users_create(request: Request):
    _require_admin(request)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid request")
    username = str(body.get("username", "")).strip()
    password = str(body.get("password", ""))
    role = body.get("role", "user")
    apps = _clean_apps(body.get("apps", []))
    if not _USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail="Username: 2–32 chars, letters/numbers/._-")
    if len(password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    if role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="Invalid role")
    if role == "admin":
        apps = list(APP_KINDS)

    def work():
        conn = get_db()
        if conn.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
            conn.close()
            return None
        rid = uuid.uuid4().hex[:8]
        conn.execute(
            "INSERT INTO users (id, username, password_hash, role, apps, created_at) VALUES (?,?,?,?,?,?)",
            (rid, username, hashlib.sha256(password.encode()).hexdigest(), role,
             json.dumps(apps), datetime.now().isoformat()))
        conn.commit()
        row = conn.execute("SELECT * FROM users WHERE id=?", (rid,)).fetchone()
        conn.close()
        return _user_public(row)

    async with _users_lock:
        res = await asyncio.to_thread(work)
    if res is None:
        raise HTTPException(status_code=409, detail="Username already exists")
    return res


@app.put("/api/users/{uid}")
async def users_update(uid: str, request: Request):
    admin = _require_admin(request)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid request")

    def work():
        conn = get_db()
        row = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        if not row:
            conn.close()
            return ("missing", None)
        cur = dict(row)
        sets, vals = [], []
        if "username" in body:
            un = str(body["username"]).strip()
            if not _USERNAME_RE.match(un):
                conn.close()
                return ("bad", "Username: 2–32 chars, letters/numbers/._-")
            other = conn.execute("SELECT 1 FROM users WHERE username=? AND id<>?", (un, uid)).fetchone()
            if other:
                conn.close()
                return ("bad", "Username already exists")
            sets.append("username=?"); vals.append(un)
        new_role = cur["role"]
        if "role" in body:
            if body["role"] not in ("admin", "user"):
                conn.close()
                return ("bad", "Invalid role")
            new_role = body["role"]
            sets.append("role=?"); vals.append(new_role)
        # Never let the last admin be demoted (would lock everyone out of mgmt).
        if cur["role"] == "admin" and new_role != "admin":
            admins = conn.execute("SELECT COUNT(*) FROM users WHERE role='admin'").fetchone()[0]
            if admins <= 1:
                conn.close()
                return ("bad", "Can't demote the last admin")
        if "apps" in body:
            apps = list(APP_KINDS) if new_role == "admin" else _clean_apps(body["apps"])
            sets.append("apps=?"); vals.append(json.dumps(apps))
        elif "role" in body:
            # normalize apps on a role flip: admin -> all, user -> none
            sets.append("apps=?")
            vals.append(json.dumps(list(APP_KINDS) if new_role == "admin" else []))
        if "password" in body and body["password"]:
            if len(str(body["password"])) < 4:
                conn.close()
                return ("bad", "Password must be at least 4 characters")
            sets.append("password_hash=?")
            vals.append(hashlib.sha256(str(body["password"]).encode()).hexdigest())
        if sets:
            vals.append(uid)
            conn.execute(f"UPDATE users SET {', '.join(sets)} WHERE id=?", vals)
            conn.commit()
        row2 = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        conn.close()
        return ("ok", _user_public(row2))

    async with _users_lock:
        kind, payload = await asyncio.to_thread(work)
    if kind == "missing":
        raise HTTPException(status_code=404, detail="User not found")
    if kind == "bad":
        raise HTTPException(status_code=400, detail=payload)
    return payload


@app.delete("/api/users/{uid}")
async def users_delete(uid: str, request: Request):
    admin = _require_admin(request)
    if uid == admin["id"]:
        raise HTTPException(status_code=400, detail="You can't delete your own account")

    def work():
        conn = get_db()
        row = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        if not row:
            conn.close()
            return "missing"
        if row["role"] == "admin":
            admins = conn.execute("SELECT COUNT(*) FROM users WHERE role='admin'").fetchone()[0]
            if admins <= 1:
                conn.close()
                return "last_admin"
        conn.execute("DELETE FROM users WHERE id=?", (uid,))
        conn.execute("DELETE FROM sessions WHERE user_id=?", (uid,))  # revoke their tokens
        conn.commit()
        conn.close()
        return "ok"

    async with _users_lock:
        res = await asyncio.to_thread(work)
    if res == "missing":
        raise HTTPException(status_code=404, detail="User not found")
    if res == "last_admin":
        raise HTTPException(status_code=400, detail="Can't delete the last admin")
    return {"success": True}


@app.get("/api/info")
async def get_info(request: Request):
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not verify_token(token):
        raise HTTPException(status_code=401)

    return {
        "device_id": get_setting("device_id"),
        "password": get_setting("password"),
        "hostname": platform.node(),
        "platform": platform.platform(),
        "screen_width": streamer.screen_width,
        "screen_height": streamer.screen_height,
        "connected_clients": len(streamer.clients),
        "fps": streamer.fps,
        "quality": streamer.quality,
        "scale": streamer.scale,
        "wallpaper": get_setting("wallpaper"),
    }


def _system_stats() -> dict:
    """Host CPU% + RAM (bytes). Uses psutil when available; native fallback else."""
    try:
        import psutil
        vm = psutil.virtual_memory()
        return {
            "cpu": round(psutil.cpu_percent(interval=None), 1),  # non-blocking, % since last call
            "mem_used": int(vm.used),
            "mem_total": int(vm.total),
            "mem_percent": round(vm.percent, 1),
        }
    except Exception:
        pass
    cpu = mem_used = mem_total = mem_percent = None
    try:  # rough CPU% from load average / core count
        cpu = round(min(100.0, os.getloadavg()[0] / (os.cpu_count() or 1) * 100), 1)
    except Exception:
        pass
    try:
        if platform.system() == "Darwin":
            mem_total = int(subprocess.run(["sysctl", "-n", "hw.memsize"],
                                           capture_output=True, text=True, timeout=3).stdout.strip())
            vs = subprocess.run(["vm_stat"], capture_output=True, text=True, timeout=3).stdout
            page = int((re.search(r"page size of (\d+)", vs) or [0, 4096])[1]) if "page size" in vs else 4096
            def _pg(key):
                m = re.search(rf"{key}:\s+(\d+)\.", vs)
                return int(m.group(1)) if m else 0
            mem_used = (_pg("Pages active") + _pg("Pages wired down")
                        + _pg("Pages occupied by compressor")) * page
            mem_percent = round(mem_used / mem_total * 100, 1) if mem_total else None
        else:  # Linux /proc/meminfo
            info = {}
            with open("/proc/meminfo") as f:
                for line in f:
                    k, _, v = line.partition(":")
                    info[k.strip()] = int(v.strip().split()[0]) * 1024
            mem_total = info.get("MemTotal")
            avail = info.get("MemAvailable", info.get("MemFree", 0))
            mem_used = (mem_total - avail) if mem_total else None
            mem_percent = round(mem_used / mem_total * 100, 1) if mem_total else None
    except Exception:
        pass
    return {"cpu": cpu, "mem_used": mem_used, "mem_total": mem_total, "mem_percent": mem_percent}


@app.get("/api/stats")
async def system_stats(request: Request):
    _require_token(request)
    return await asyncio.to_thread(_system_stats)


# This machine's public (WAN) IP — cached, since it rarely changes and the
# lookup is a slow outbound curl. The menu bar polls this.
_PUBLIC_IP = {"ip": None, "ts": 0.0}
_PUBLIC_IP_TTL = 600  # seconds


@app.get("/api/public-ip")
async def public_ip(request: Request):
    _require_token(request)
    now = time.monotonic()
    if _PUBLIC_IP["ip"] is None or (now - _PUBLIC_IP["ts"]) > _PUBLIC_IP_TTL:
        ip = await asyncio.to_thread(server_manager._public_ip)
        if ip:  # keep the last good value if a refresh momentarily fails
            _PUBLIC_IP["ip"] = ip
            _PUBLIC_IP["ts"] = now
    return {"ip": _PUBLIC_IP["ip"]}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    # Authenticate
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=10)
        data = json.loads(raw)
        if data.get("type") != "auth" or not verify_token(data.get("token", "")):
            await websocket.send_json({"type": "error", "message": "Unauthorized"})
            await websocket.close()
            return
    except Exception:
        await websocket.close()
        return

    # Wake screen and prevent sleep
    wake_screen()
    keep_awake_start()

    streamer.clients.add(websocket)
    _all_ws.add(websocket)
    await websocket.send_json({
        "type": "auth_ok",
        "screen_width": streamer.screen_width,
        "screen_height": streamer.screen_height,
    })

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            msg_type = data.get("type", "")

            if msg_type == "stream_settings":
                streamer.update_settings(
                    quality=data.get("quality"),
                    fps=data.get("fps"),
                    scale=data.get("scale"),
                )
            elif msg_type == "term_create":
                req_cwd = (data.get("cwd") or "").strip()
                start_cwd = os.path.realpath(os.path.expanduser(req_cwd)) if req_cwd else None
                if start_cwd and not os.path.isdir(start_cwd):
                    start_cwd = None
                start_name = str(data.get("name", ""))[:80]
                session = term_manager.create(cwd=start_cwd, name=start_name)
                session.subscribers.add(websocket)
                await websocket.send_json({
                    "type": "term_created",
                    "session_id": session.session_id,
                    "name": session.name,
                    "buffer": "",
                })
                # Notify every OTHER connected client so they can subscribe
                for other in list(_all_ws):
                    if other is not websocket:
                        try:
                            await other.send_json({
                                "type": "term_new",
                                "session_id": session.session_id,
                            })
                        except Exception:
                            pass
            elif msg_type == "term_input":
                sid = data.get("session_id", "")
                session = term_manager.get(sid)
                if session and session.alive:
                    raw_data = base64.b64decode(data.get("data", ""))
                    session.write(raw_data)
            elif msg_type == "term_resize":
                sid = data.get("session_id", "")
                session = term_manager.get(sid)
                if session:
                    session.resize(
                        data.get("rows", 24), data.get("cols", 80))
            elif msg_type == "term_close":
                sid = data.get("session_id", "")
                term_manager.close(sid)
                # Broadcast close to ALL clients so every tab bar updates
                for other in list(_all_ws):
                    try:
                        await other.send_json({
                            "type": "term_closed",
                            "session_id": sid,
                        })
                    except Exception:
                        pass
            elif msg_type == "term_rename":
                sid = data.get("session_id", "")
                new_name = str(data.get("name", ""))[:80]  # cap at 80 chars
                session = term_manager.get(sid)
                if session:
                    session.name = new_name
                    for other in list(_all_ws):
                        try:
                            await other.send_json({
                                "type": "term_renamed",
                                "session_id": sid,
                                "name": new_name,
                            })
                        except Exception:
                            pass
            elif msg_type == "term_list":
                await websocket.send_json({
                    "type": "term_list",
                    "sessions": term_manager.list_sessions(),
                })
            elif msg_type == "term_subscribe":
                sid = data.get("session_id", "")
                session = term_manager.get(sid)
                if session:
                    session.subscribers.add(websocket)
                    # Send reset + recent scrollback so client sees history
                    replay = session.get_replay_buffer()
                    await websocket.send_json({
                        "type": "term_subscribed",
                        "session_id": sid,
                        "name": session.name,
                        "buffer": base64.b64encode(replay).decode() if replay else "",
                    })
            elif msg_type == "term_paste_image":
                # Client pasted an image; save it, prime the server clipboard,
                # then inject Ctrl-V into the PTY so Claude Code picks it up.
                sid = data.get("session_id", "")
                img_b64 = data.get("data", "")
                mime = data.get("mime", "image/png")
                if not sid or not img_b64:
                    continue
                try:
                    img_bytes = base64.b64decode(img_b64)
                except Exception:
                    continue
                if len(img_bytes) > 50 * 1024 * 1024:
                    await websocket.send_json({
                        "type": "term_image_pasted",
                        "error": "Image too large (max 50 MB)",
                    })
                    continue
                # Map MIME to an extension via a strict allowlist. The client
                # controls `mime`, so never derive a filename fragment from it.
                _MIME_EXT = {
                    "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
                    "image/webp": "webp", "image/gif": "gif",
                }
                ext = _MIME_EXT.get(mime.lower().split(";")[0].strip(), "png")
                tmp_name = f"thinkviewer_img_{uuid.uuid4().hex[:8]}.{ext}"
                tmp_path = os.path.join("/tmp", tmp_name)
                with open(tmp_path, "wb") as fh:
                    fh.write(img_bytes)
                # Set the server OS clipboard so Claude Code can read the image
                clipboard_ok = _set_clipboard_image(tmp_path, mime)
                session = term_manager.get(sid)
                if session and session.alive:
                    if clipboard_ok:
                        # Inject Ctrl-V → Claude Code's paste handler fires
                        session.write(b"\x16")
                    else:
                        # Fallback: type the file path so user can reference it
                        session.write(tmp_path.encode())
                await websocket.send_json({
                    "type": "term_image_pasted",
                    "session_id": sid,
                    "path": tmp_path,
                    "clipboard_ok": clipboard_ok,
                    "size": len(img_bytes),
                })
            else:
                handle_input(data)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        streamer.clients.discard(websocket)
        _all_ws.discard(websocket)
        term_manager.unsubscribe_all(websocket)
        if not streamer.clients:
            keep_awake_stop()


@app.post("/api/command")
async def execute_command(request: Request):
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not verify_token(token):
        raise HTTPException(status_code=401)

    body = await request.json()
    cmd = body.get("command", "")
    cwd = body.get("cwd", os.path.expanduser("~"))

    if not cmd:
        raise HTTPException(status_code=400, detail="No command provided")

    try:
        proc = await asyncio.create_subprocess_shell(
            cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
        return {
            "stdout": stdout.decode(errors="replace"),
            "stderr": stderr.decode(errors="replace"),
            "returncode": proc.returncode,
        }
    except asyncio.TimeoutError:
        return {"stdout": "", "stderr": "Command timed out (30s)", "returncode": -1}
    except Exception as e:
        return {"stdout": "", "stderr": str(e), "returncode": -1}


@app.post("/api/terminal/paste-image")
async def terminal_paste_image(request: Request):
    """Receive a base64-encoded image from the client, save it to /tmp,
    and return the path so the terminal can type it (e.g. for Claude Code)."""
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not verify_token(token):
        raise HTTPException(status_code=401)

    body = await request.json()
    image_b64 = body.get("image", "")
    if not image_b64:
        raise HTTPException(status_code=400, detail="No image data")

    try:
        image_bytes = base64.b64decode(image_b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image data")

    if len(image_bytes) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image too large (max 50 MB)")

    tmp_name = f"thinkviewer_img_{uuid.uuid4().hex[:8]}.png"
    tmp_path = os.path.join("/tmp", tmp_name)
    with open(tmp_path, "wb") as f:
        f.write(image_bytes)

    return {"path": tmp_path, "size": len(image_bytes)}


@app.get("/api/files/list")
async def list_files(path: str = Query("~"), token: str = Query("")):
    if not verify_token(token):
        raise HTTPException(status_code=401)

    dir_path = Path(os.path.expanduser(path)).resolve()
    if not dir_path.exists():
        raise HTTPException(status_code=404, detail="Path not found")

    items = []
    try:
        for entry in sorted(dir_path.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())):
            try:
                stat = entry.stat()
                items.append({
                    "name": entry.name,
                    "path": str(entry),
                    "is_dir": entry.is_dir(),
                    "size": stat.st_size if not entry.is_dir() else 0,
                    "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                })
            except PermissionError:
                items.append({
                    "name": entry.name,
                    "path": str(entry),
                    "is_dir": entry.is_dir(),
                    "size": 0,
                    "modified": "",
                    "error": "Permission denied",
                })
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")

    return {"path": str(dir_path), "parent": str(dir_path.parent), "items": items}


@app.post("/api/files/upload")
async def upload_file(
    file: UploadFile = File(...),
    path: str = Form("~"),
    token: str = Form(""),
):
    if not verify_token(token):
        raise HTTPException(status_code=401)

    dest_dir = Path(os.path.expanduser(path)).resolve()
    if not dest_dir.exists() or not dest_dir.is_dir():
        raise HTTPException(status_code=404, detail="Destination not found")

    # Sanitize: keep only the basename and forbid traversal / separators.
    raw_name = os.path.basename(file.filename or "")
    if not raw_name or raw_name in (".", "..") or "/" in raw_name or "\\" in raw_name:
        raise HTTPException(status_code=400, detail="Invalid filename")
    dest_file = dest_dir / raw_name
    if dest_file.resolve().parent != dest_dir:
        raise HTTPException(status_code=400, detail="Invalid destination")

    # Stream to a temp file with a size cap, then atomically rename into place.
    tmp_path = dest_dir / f".{raw_name}.{uuid.uuid4().hex[:8]}.part"
    size = 0
    try:
        with open(tmp_path, "wb") as f:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="File too large")
                f.write(chunk)
        os.replace(tmp_path, dest_file)
    except HTTPException:
        tmp_path.unlink(missing_ok=True)
        raise
    except Exception as e:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")

    return {"success": True, "path": str(dest_file), "size": size}


@app.get("/api/files/download")
async def download_file(path: str, token: str = Query("")):
    if not verify_token(token):
        raise HTTPException(status_code=401)

    file_path = Path(os.path.expanduser(path)).resolve()
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        path=str(file_path),
        filename=file_path.name,
        media_type="application/octet-stream",
    )


@app.delete("/api/files/delete")
async def delete_file(request: Request):
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not verify_token(token):
        raise HTTPException(status_code=401)

    body = await request.json()
    file_path = Path(os.path.expanduser(body.get("path", ""))).resolve()

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Not found")

    if file_path.is_dir():
        shutil.rmtree(file_path)
    else:
        file_path.unlink()

    return {"success": True}


@app.post("/api/files/mkdir")
async def make_directory(request: Request):
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not verify_token(token):
        raise HTTPException(status_code=401)

    body = await request.json()
    dir_path = Path(os.path.expanduser(body.get("path", ""))).resolve()
    dir_path.mkdir(parents=True, exist_ok=True)

    return {"success": True, "path": str(dir_path)}


@app.post("/api/files/rename")
async def rename_file(request: Request):
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not verify_token(token):
        raise HTTPException(status_code=401)

    body = await request.json()
    raw_path = body.get("path", "")
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise HTTPException(status_code=400, detail="Path required")
    src = Path(os.path.expanduser(raw_path)).resolve()
    name_in = body.get("name", "")
    raw = name_in.strip() if isinstance(name_in, str) else ""
    if not src.exists():
        raise HTTPException(status_code=404, detail="Not found")
    # New name must be a bare filename — no traversal / separators.
    if not raw or raw in (".", "..") or "/" in raw or "\\" in raw or "\x00" in raw:
        raise HTTPException(status_code=400, detail="Invalid name")
    dest = src.parent / raw
    if dest == src:
        return {"success": True, "path": str(src), "name": src.name}
    # Block real clobbers, but allow a case-only rename on case-insensitive
    # filesystems (there dest.exists() is True for src's own inode).
    if dest.exists() and not os.path.samefile(src, dest):
        raise HTTPException(status_code=409, detail="An item with that name already exists")
    try:
        src.rename(dest)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not rename: {e}")
    return {"success": True, "path": str(dest), "name": dest.name}


def _unique_zip_path(src: Path) -> Path:
    out = src.parent / f"{src.name}.zip"
    i = 1
    while out.exists():
        out = src.parent / f"{src.name} ({i}).zip"
        i += 1
    return out


def _make_zip(src: Path) -> Path:
    """Zip a file or (recursively) a folder into a sibling <name>.zip."""
    out = _unique_zip_path(src)
    try:
        if src.is_dir():
            # make_archive appends '.zip' to base_name; root_dir/base_dir make the
            # archive contain the folder itself (<name>/...). The output lives in the
            # parent dir, a sibling of src, so it never archives itself.
            shutil.make_archive(str(out)[:-4], "zip", root_dir=str(src.parent), base_dir=src.name)
        else:
            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
                zf.write(src, arcname=src.name)
    except Exception:
        out.unlink(missing_ok=True)  # don't leave a partial/corrupt zip behind
        raise
    return out


@app.post("/api/files/zip")
async def zip_file(request: Request):
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not verify_token(token):
        raise HTTPException(status_code=401)

    body = await request.json()
    raw_path = body.get("path", "")
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise HTTPException(status_code=400, detail="Path required")
    src = Path(os.path.expanduser(raw_path)).resolve()
    if not src.exists():
        raise HTTPException(status_code=404, detail="Not found")
    try:
        out = await asyncio.to_thread(_make_zip, src)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not create zip: {e}")
    return {"success": True, "path": str(out), "name": out.name}


@app.post("/api/settings/password")
async def change_password(request: Request):
    user = _current_user(request)  # changes the CURRENT user's password

    body = await request.json()
    new_password = body.get("password", "")
    if len(new_password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")

    pw_hash = hashlib.sha256(new_password.encode()).hexdigest()
    conn = get_db()
    conn.execute("UPDATE users SET password_hash=? WHERE id=?", (pw_hash, user["id"]))
    conn.commit()
    conn.close()
    # Keep the admin's password as the shown "connection password" (/api/info).
    if user["role"] == "admin":
        set_setting("password", new_password)
        set_setting("password_hash", pw_hash)

    return {"success": True}


@app.post("/api/settings/stream")
async def update_stream_settings(request: Request):
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not verify_token(token):
        raise HTTPException(status_code=401)

    body = await request.json()
    streamer.update_settings(
        quality=body.get("quality"),
        fps=body.get("fps"),
        scale=body.get("scale"),
    )

    return {
        "success": True,
        "quality": streamer.quality,
        "fps": streamer.fps,
        "scale": streamer.scale,
    }


# ============================================================
# Wallpapers
# ============================================================
def _list_wallpapers() -> list[dict]:
    items = []
    if os.path.isdir(WALLPAPER_DIR):
        for fname in sorted(os.listdir(WALLPAPER_DIR)):
            if fname.startswith("."):
                continue
            if os.path.splitext(fname)[1].lower() not in ALLOWED_WP_EXT:
                continue
            stem = os.path.splitext(fname)[0]
            name = (stem.replace("wp-", "").replace("user_", "Custom ")
                    .replace("-", " ").replace("_", " ").strip().title())
            items.append({
                "id": fname,
                "name": name or fname,
                "url": f"/static/wallpapers/{fname}",
                "builtin": not fname.startswith("user_"),
            })
    return items


@app.get("/api/wallpapers")
async def get_wallpapers(token: str = Query("")):
    if not verify_token(token):
        raise HTTPException(status_code=401)
    return {"selected": get_setting("wallpaper"), "wallpapers": _list_wallpapers()}


@app.post("/api/wallpapers/select")
async def select_wallpaper(request: Request):
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not verify_token(token):
        raise HTTPException(status_code=401)
    body = await request.json()
    wp_id = os.path.basename(str(body.get("id", "")))  # basename blocks traversal
    target = os.path.join(WALLPAPER_DIR, wp_id)
    if not wp_id or not os.path.isfile(target):
        raise HTTPException(status_code=404, detail="Wallpaper not found")
    set_setting("wallpaper", wp_id)
    return {"success": True, "selected": wp_id, "url": f"/static/wallpapers/{wp_id}"}


@app.post("/api/wallpapers/upload")
async def upload_wallpaper(file: UploadFile = File(...), token: str = Form("")):
    if not verify_token(token):
        raise HTTPException(status_code=401)
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_WP_EXT:
        raise HTTPException(status_code=400, detail="Unsupported image type")
    os.makedirs(WALLPAPER_DIR, exist_ok=True)
    wp_id = f"user_{uuid.uuid4().hex[:8]}{ext}"
    dest = os.path.join(WALLPAPER_DIR, wp_id)
    tmp = dest + ".part"
    size = 0
    try:
        with open(tmp, "wb") as f:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > 50 * 1024 * 1024:
                    raise HTTPException(status_code=413, detail="Image too large (max 50 MB)")
                f.write(chunk)
        os.replace(tmp, dest)
    except HTTPException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return {"success": True, "id": wp_id, "url": f"/static/wallpapers/{wp_id}"}


@app.delete("/api/wallpapers")
async def delete_wallpaper(request: Request):
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not verify_token(token):
        raise HTTPException(status_code=401)
    body = await request.json()
    wp_id = os.path.basename(str(body.get("id", "")))
    if not wp_id.startswith("user_"):  # only uploaded wallpapers are deletable
        raise HTTPException(status_code=400, detail="Only uploaded wallpapers can be deleted")
    target = os.path.join(WALLPAPER_DIR, wp_id)
    if os.path.isfile(target):
        os.remove(target)
        if get_setting("wallpaper") == wp_id:
            set_setting("wallpaper", "")
    return {"success": True}


# ============================================================
# Servers (process manager) — all Bearer-auth; blocking ops off the event loop
# ============================================================
def _require_token(request: Request):
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not verify_token(token):
        raise HTTPException(status_code=401)


@app.get("/api/servers")
async def servers_list(request: Request):
    _require_token(request)
    return await asyncio.to_thread(
        lambda: {"base_dir": server_manager.base_dir(), "services": server_manager.list()})


@app.get("/api/servers/discover")
async def servers_discover(request: Request):
    _require_token(request)
    return await asyncio.to_thread(server_manager.discover)


@app.get("/api/servers/interpreters")
async def servers_interpreters(request: Request, cwd: str = Query("")):
    _require_token(request)
    return await asyncio.to_thread(lambda: {"interpreters": server_manager.interpreters(cwd)})


@app.get("/api/servers/pyenv")
async def servers_pyenv_info(request: Request):
    _require_token(request)
    return await asyncio.to_thread(server_manager.pyenv_info)


@app.post("/api/servers/pyenv")
async def servers_pyenv_create(request: Request):
    _require_token(request)
    body = await request.json()
    try:
        return await asyncio.to_thread(
            server_manager.create_pyenv_virtualenv, body.get("base", ""), body.get("name", ""))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/servers/suggest-port")
async def servers_suggest_port(request: Request, cwd: str = Query(""), entry: str = Query("")):
    _require_token(request)
    return await asyncio.to_thread(lambda: {"port": server_manager.suggest_port(cwd, entry)})


@app.post("/api/servers/{sid}/setup-env")
async def servers_setup_env(sid: str, request: Request):
    _require_token(request)
    body = await request.json()
    try:
        return await asyncio.to_thread(server_manager.setup_env, sid, body.get("base_python", ""))
    except KeyError:
        raise HTTPException(status_code=404, detail="Service not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/servers/{sid}/setup-env/log")
async def servers_setup_log(sid: str, request: Request):
    _require_token(request)
    if not server_manager.get(sid):
        raise HTTPException(status_code=404, detail="Service not found")
    return await asyncio.to_thread(server_manager.setup_log, sid)


@app.post("/api/servers/base-dir")
async def servers_set_base_dir(request: Request):
    _require_token(request)
    body = await request.json()
    return {"base_dir": server_manager.set_base_dir(body.get("path", ""))}


@app.post("/api/servers")
async def servers_create(request: Request):
    _require_token(request)
    body = await request.json()
    try:
        return await asyncio.to_thread(server_manager.create, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/servers/{sid}")
async def servers_update(sid: str, request: Request):
    _require_token(request)
    body = await request.json()
    try:
        return await asyncio.to_thread(server_manager.update, sid, body)
    except KeyError:
        raise HTTPException(status_code=404, detail="Service not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/api/servers/{sid}")
async def servers_delete(sid: str, request: Request):
    _require_token(request)
    await asyncio.to_thread(server_manager.delete, sid)
    return {"success": True}


@app.post("/api/servers/{sid}/start")
async def servers_start(sid: str, request: Request):
    _require_token(request)
    try:
        return await asyncio.to_thread(server_manager.start, sid)
    except KeyError:
        raise HTTPException(status_code=404, detail="Service not found")
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/servers/{sid}/stop")
async def servers_stop(sid: str, request: Request):
    _require_token(request)
    res = await asyncio.to_thread(server_manager.stop, sid)
    if res is None:
        raise HTTPException(status_code=404, detail="Service not found")
    return res


@app.post("/api/servers/{sid}/restart")
async def servers_restart(sid: str, request: Request):
    _require_token(request)
    try:
        return await asyncio.to_thread(server_manager.restart, sid)
    except KeyError:
        raise HTTPException(status_code=404, detail="Service not found")
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/servers/{sid}/git-pull")
async def servers_git_pull(sid: str, request: Request):
    _require_token(request)
    try:
        return await asyncio.to_thread(server_manager.git_pull, sid)
    except KeyError:
        raise HTTPException(status_code=404, detail="Service not found")
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/servers/{sid}/logs")
async def servers_logs(sid: str, request: Request, lines: int = Query(300)):
    _require_token(request)
    if not server_manager.get(sid):
        raise HTTPException(status_code=404, detail="Service not found")
    text = await asyncio.to_thread(server_manager.logs, sid, min(max(lines, 10), 2000))
    return {"logs": text}


# ---- Deploy / HTTPS (domain → service port via deploy-kit + certbot) --------
@app.get("/api/deploy/info")
async def deploy_info(request: Request):
    _require_token(request)
    return await asyncio.to_thread(server_manager.deploy_info)


@app.post("/api/servers/{sid}/reachability")
async def servers_reachability(sid: str, request: Request):
    _require_token(request)
    body = await request.json()
    try:
        return await asyncio.to_thread(
            server_manager.reachability, body.get("domain", ""),
            int(body.get("port", 80) or 80))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/servers/{sid}/deploy")
async def servers_deploy(sid: str, request: Request):
    _require_token(request)
    body = await request.json()
    try:
        return await asyncio.to_thread(
            server_manager.deploy, sid, body.get("domain", ""),
            body.get("email", ""), bool(body.get("staging")))
    except KeyError:
        raise HTTPException(status_code=404, detail="Service not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/servers/{sid}/deploy/log")
async def servers_deploy_log(sid: str, request: Request):
    _require_token(request)
    if not server_manager.get(sid):
        raise HTTPException(status_code=404, detail="Service not found")
    return await asyncio.to_thread(server_manager.deploy_log, sid)


# ============================================================
# Client Project (CRM) — generic CRUD + dashboard + uploads
# ============================================================
def _cp_to_dict(entity, row):
    d = dict(row)
    for jc in CP_JSON.get(entity, ()):  # decode JSON columns on the way out
        v = d.get(jc)
        if isinstance(v, str) and v:
            try:
                d[jc] = json.loads(v)
            except Exception:
                pass
    return d


def _cp_clean(entity, key, value):
    if key in CP_JSON.get(entity, ()) or isinstance(value, (dict, list)):
        return json.dumps(value)
    if isinstance(value, bool):
        return "1" if value else "0"
    return value


def _cp_file_in_use(conn, path):
    """True if `path` is still referenced by an issue/task/note image attachment
    (or an issue fix-version image). Such files are uploaded via /api/cp/upload —
    which creates BOTH a cp_files row and stores the path in the parent record's
    JSON `attachments`/`fixes` column — so deleting the cp_files row must NOT
    physically remove bytes the parent still points at."""
    p = str(path)
    for tbl, col in (("cp_issues", "attachments"), ("cp_tasks", "attachments"),
                     ("cp_notes", "attachments")):
        try:
            for (val,) in conn.execute(f"SELECT {col} FROM {tbl}"):
                if not val:
                    continue
                try:
                    arr = json.loads(val)
                except Exception:
                    continue
                if isinstance(arr, list) and p in arr:
                    return True
        except sqlite3.OperationalError:
            pass
    try:  # fix versions: [{note, images:[...], ...}]
        for (val,) in conn.execute("SELECT fixes FROM cp_issues"):
            if not val:
                continue
            try:
                arr = json.loads(val)
            except Exception:
                continue
            for v in (arr if isinstance(arr, list) else []):
                if isinstance(v, dict) and p in (v.get("images") or []):
                    return True
    except sqlite3.OperationalError:
        pass
    return False


def _cp_log(entity, action, data):
    """Auto-append a timeline entry for create/update/delete of CRM records."""
    if entity == "activity":
        return
    label = data.get("name") or data.get("title") or data.get("feature") or ""
    msg = f"{action} {entity}" + (f": {label}" if label else "")
    try:
        conn = get_db()
        now = datetime.now().isoformat()
        conn.execute(
            "INSERT INTO cp_activity (id, project_id, client_id, kind, message, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (uuid.uuid4().hex[:8], str(data.get("project_id") or ""),
             str(data.get("client_id") or ""), entity, msg, now, now))
        conn.commit()
        conn.close()
    except Exception:
        pass


@app.get("/api/cp/dashboard")
async def cp_dashboard(request: Request):
    _require_token(request)

    def work():
        conn = get_db()
        def s(q, *a):
            return conn.execute(q, a).fetchone()[0]
        today = datetime.now().date().isoformat()
        soon = (datetime.now() + timedelta(days=14)).date().isoformat()
        out = {
            "clients_total": s("SELECT COUNT(*) FROM cp_clients"),
            "clients_active": s("SELECT COUNT(*) FROM cp_clients WHERE status='active'"),
            "projects_total": s("SELECT COUNT(*) FROM cp_projects"),
            "projects_active": s("SELECT COUNT(*) FROM cp_projects WHERE status='active'"),
            "projects_delivered": s("SELECT COUNT(*) FROM cp_projects WHERE status='delivered'"),
            "issues_open": s("SELECT COUNT(*) FROM cp_issues WHERE status NOT IN ('verified','closed')"),
            "issues_critical": s("SELECT COUNT(*) FROM cp_issues WHERE severity='critical' AND status NOT IN ('verified','closed')"),
            "tasks_open": s("SELECT COUNT(*) FROM cp_tasks WHERE status NOT IN ('done')"),
            "tasks_overdue": s("SELECT COUNT(*) FROM cp_tasks WHERE status NOT IN ('done') AND due_date<>'' AND due_date < ?", today),
            "cr_open": s("SELECT COUNT(*) FROM cp_change_requests WHERE status='requested'"),
            "total_budget": s("SELECT COALESCE(SUM(CAST(NULLIF(budget,'') AS REAL)),0) FROM cp_projects"),
            "outstanding": s("SELECT COALESCE(SUM(CAST(NULLIF(amount,'') AS REAL)),0) FROM cp_payments WHERE COALESCE(paid,'0') NOT IN ('1','true','True')"),
        }
        out["deadlines"] = [dict(r) for r in conn.execute(
            "SELECT id,name,deliver_date,status FROM cp_projects WHERE status='active' "
            "AND deliver_date<>'' AND deliver_date <= ? ORDER BY deliver_date LIMIT 10", (soon,)).fetchall()]
        out["critical_issues"] = [dict(r) for r in conn.execute(
            "SELECT id,project_id,title,severity,status FROM cp_issues "
            "WHERE severity='critical' AND status NOT IN ('verified','closed') "
            "ORDER BY created_at DESC LIMIT 10").fetchall()]
        out["recent_activity"] = [dict(r) for r in conn.execute(
            "SELECT * FROM cp_activity ORDER BY created_at DESC LIMIT 15").fetchall()]
        conn.close()
        return out

    return await asyncio.to_thread(work)


@app.post("/api/cp/upload")
async def cp_upload(file: UploadFile = File(...), token: str = Form(""),
                    project_id: str = Form(""), client_id: str = Form(""),
                    issue_id: str = Form(""), category: str = Form("")):
    if not verify_token(token):
        raise HTTPException(status_code=401)
    os.makedirs(CP_FILES_DIR, exist_ok=True)
    raw = os.path.basename(file.filename or "file")
    if not raw or "/" in raw or "\\" in raw:
        raise HTTPException(status_code=400, detail="Invalid filename")
    rid = uuid.uuid4().hex[:8]
    stored = os.path.join(CP_FILES_DIR, f"{rid}__{raw}")
    size = 0
    try:
        with open(stored, "wb") as f:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="File too large")
                f.write(chunk)
    except HTTPException:
        try:
            os.remove(stored)
        except OSError:
            pass
        raise
    except Exception as e:  # don't leave an orphaned partial file
        try:
            os.remove(stored)
        except OSError:
            pass
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
    now = datetime.now().isoformat()
    conn = get_db()
    conn.execute(
        "INSERT INTO cp_files (id,project_id,client_id,issue_id,name,path,category,notes,created_at,updated_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)",
        (rid, project_id, client_id, issue_id, raw, stored, category, "", now, now))
    conn.commit()
    row = conn.execute("SELECT * FROM cp_files WHERE id=?", (rid,)).fetchone()
    conn.close()
    return dict(row)


@app.get("/api/cp/{entity}")
async def cp_list(entity: str, request: Request):
    _require_token(request)
    cols = CP_ENTITIES.get(entity)
    if cols is None:
        raise HTTPException(status_code=404, detail="Unknown entity")
    filters = {k: v for k, v in request.query_params.items() if k in cols or k == "id"}

    def work():
        conn = get_db()
        sql = f"SELECT * FROM cp_{entity}"
        if filters:
            sql += " WHERE " + " AND ".join(f"{k}=?" for k in filters)
        order = "CAST(order_idx AS INTEGER), created_at" if "order_idx" in cols else "created_at DESC"
        if "pinned" in cols:  # pinned rows (e.g. notes) float to the top
            order = "CASE WHEN pinned IN ('1','true','True') THEN 0 ELSE 1 END, " + order
        sql += " ORDER BY " + order
        rows = conn.execute(sql, tuple(filters.values())).fetchall()
        conn.close()
        return [_cp_to_dict(entity, r) for r in rows]

    return {"items": await asyncio.to_thread(work)}


@app.post("/api/cp/{entity}")
async def cp_create(entity: str, request: Request):
    _require_token(request)
    cols = CP_ENTITIES.get(entity)
    if cols is None:
        raise HTTPException(status_code=404, detail="Unknown entity")
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid request")

    def work():
        rid = uuid.uuid4().hex[:8]
        data = {k: _cp_clean(entity, k, body[k]) for k in body if k in cols}
        now = datetime.now().isoformat()
        keys = ["id"] + list(data.keys()) + ["created_at", "updated_at"]
        vals = [rid] + list(data.values()) + [now, now]
        conn = get_db()
        conn.execute(f"INSERT INTO cp_{entity} ({','.join(keys)}) VALUES ({','.join(['?'] * len(keys))})", vals)
        conn.commit()
        row = conn.execute(f"SELECT * FROM cp_{entity} WHERE id=?", (rid,)).fetchone()
        conn.close()
        _cp_log(entity, "created", {**body, "id": rid})
        return _cp_to_dict(entity, row)

    return await asyncio.to_thread(work)


@app.put("/api/cp/{entity}/{rid}")
async def cp_update(entity: str, rid: str, request: Request):
    _require_token(request)
    cols = CP_ENTITIES.get(entity)
    if cols is None:
        raise HTTPException(status_code=404, detail="Unknown entity")
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid request")

    def work():
        data = {k: _cp_clean(entity, k, body[k]) for k in body if k in cols}
        conn = get_db()
        if not conn.execute(f"SELECT 1 FROM cp_{entity} WHERE id=?", (rid,)).fetchone():
            conn.close()
            return None
        if data:
            sets = ", ".join(f"{k}=?" for k in data) + ", updated_at=?"
            conn.execute(f"UPDATE cp_{entity} SET {sets} WHERE id=?",
                         (*data.values(), datetime.now().isoformat(), rid))
            conn.commit()
        row = conn.execute(f"SELECT * FROM cp_{entity} WHERE id=?", (rid,)).fetchone()
        conn.close()
        _cp_log(entity, "updated", {**body, "id": rid})
        return _cp_to_dict(entity, row)

    res = await asyncio.to_thread(work)
    if res is None:
        raise HTTPException(status_code=404, detail="Not found")
    return res


@app.delete("/api/cp/{entity}/{rid}")
async def cp_delete(entity: str, rid: str, request: Request):
    _require_token(request)
    cols = CP_ENTITIES.get(entity)
    if cols is None:
        raise HTTPException(status_code=404, detail="Unknown entity")

    def work():
        conn = get_db()
        row = conn.execute(f"SELECT * FROM cp_{entity} WHERE id=?", (rid,)).fetchone()
        if not row:
            conn.close()
            return False
        d = dict(row)
        conn.execute(f"DELETE FROM cp_{entity} WHERE id=?", (rid,))
        conn.commit()
        # deleting a file record reclaims its bytes on disk too — but only inside
        # CP_FILES_DIR (never a path that escaped the store) AND only when no
        # issue/task/note attachment still references it (shared file lifecycle).
        if entity == "files" and d.get("path"):
            try:
                real = os.path.realpath(str(d["path"]))
                base = os.path.realpath(CP_FILES_DIR)
                if (os.path.commonpath([real, base]) == base
                        and os.path.isfile(real)
                        and not _cp_file_in_use(conn, d["path"])):
                    os.remove(real)
            except (OSError, ValueError):
                pass
        conn.close()
        _cp_log(entity, "deleted", d)
        return True

    if not await asyncio.to_thread(work):
        raise HTTPException(status_code=404, detail="Not found")
    return {"success": True}


# ============================================================
# Notes app — standalone notes + checklists + image attachments
# ============================================================
NOTES_JSON = ("checklist", "images")        # JSON-encoded columns
NOTE_COLS = ("title", "body", "checklist", "images", "pinned", "color")


def _note_to_dict(row) -> dict:
    d = dict(row)
    for k in NOTES_JSON:  # decode JSON arrays on the way out (default to [])
        v = d.get(k)
        if isinstance(v, str) and v:
            try:
                d[k] = json.loads(v)
            except Exception:
                d[k] = []
        else:
            d[k] = []
    # never leak SQL NULL for scalar columns — keep the frontend's string contract
    for k in ("title", "body", "pinned", "color", "created_at", "updated_at"):
        if d.get(k) is None:
            d[k] = ""
    return d


def _note_clean(key, value):
    if key in NOTES_JSON or isinstance(value, (dict, list)):
        return json.dumps(value)
    if isinstance(value, bool):
        return "1" if value else "0"
    return value


@app.get("/api/notes")
async def notes_list(request: Request):
    _require_token(request)

    def work():
        conn = get_db()
        rows = conn.execute(
            "SELECT * FROM notes ORDER BY "
            "CASE WHEN pinned IN ('1','true','True') THEN 0 ELSE 1 END, "
            "updated_at DESC").fetchall()
        conn.close()
        return [_note_to_dict(r) for r in rows]

    return {"items": await asyncio.to_thread(work)}


@app.post("/api/notes")
async def notes_create(request: Request):
    _require_token(request)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid request")

    def work():
        rid = uuid.uuid4().hex[:8]
        now = datetime.now().isoformat()
        data = {k: _note_clean(k, body[k]) for k in body if k in NOTE_COLS}
        keys = ["id"] + list(data.keys()) + ["created_at", "updated_at"]
        vals = [rid] + list(data.values()) + [now, now]
        conn = get_db()
        conn.execute(f"INSERT INTO notes ({','.join(keys)}) VALUES ({','.join(['?'] * len(keys))})", vals)
        conn.commit()
        row = conn.execute("SELECT * FROM notes WHERE id=?", (rid,)).fetchone()
        conn.close()
        return _note_to_dict(row)

    return await asyncio.to_thread(work)


@app.put("/api/notes/{nid}")
async def notes_update(nid: str, request: Request):
    _require_token(request)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid request")

    def work():
        conn = get_db()
        if not conn.execute("SELECT 1 FROM notes WHERE id=?", (nid,)).fetchone():
            conn.close()
            return None
        data = {k: _note_clean(k, body[k]) for k in body if k in NOTE_COLS}
        if data:
            data["updated_at"] = datetime.now().isoformat()
            sets = ",".join(f"{k}=?" for k in data)
            conn.execute(f"UPDATE notes SET {sets} WHERE id=?", list(data.values()) + [nid])
            conn.commit()
        row = conn.execute("SELECT * FROM notes WHERE id=?", (nid,)).fetchone()
        conn.close()
        return _note_to_dict(row)

    res = await asyncio.to_thread(work)
    if res is None:
        raise HTTPException(status_code=404, detail="Not found")
    return res


@app.delete("/api/notes/{nid}")
async def notes_delete(nid: str, request: Request):
    _require_token(request)

    def work():
        conn = get_db()
        row = conn.execute("SELECT * FROM notes WHERE id=?", (nid,)).fetchone()
        if not row:
            conn.close()
            return False
        d = _note_to_dict(row)
        conn.execute("DELETE FROM notes WHERE id=?", (nid,))
        conn.commit()
        conn.close()
        # reclaim image bytes — but only inside NOTES_FILES_DIR
        for p in (d.get("images") or []):
            try:
                real = os.path.realpath(str(p))
                base = os.path.realpath(NOTES_FILES_DIR)
                if os.path.commonpath([real, base]) == base and os.path.isfile(real):
                    os.remove(real)
            except (OSError, ValueError):
                pass
        return True

    if not await asyncio.to_thread(work):
        raise HTTPException(status_code=404, detail="Not found")
    return {"success": True}


@app.post("/api/notes/upload")
async def notes_upload(file: UploadFile = File(...), token: str = Form("")):
    if not verify_token(token):
        raise HTTPException(status_code=401)
    os.makedirs(NOTES_FILES_DIR, exist_ok=True)
    raw = os.path.basename(file.filename or "image")
    if not raw or "/" in raw or "\\" in raw:
        raise HTTPException(status_code=400, detail="Invalid filename")
    rid = uuid.uuid4().hex[:8]
    stored = os.path.join(NOTES_FILES_DIR, f"{rid}__{raw}")
    size = 0
    try:
        with open(stored, "wb") as f:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="File too large")
                f.write(chunk)
    except HTTPException:
        try:
            os.remove(stored)
        except OSError:
            pass
        raise
    except Exception as e:
        try:
            os.remove(stored)
        except OSError:
            pass
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
    return {"path": stored, "name": raw}


# ============================================================
# SPA (must be the LAST route so it never shadows /api or /ws)
# ============================================================
@app.get("/{full_path:path}")
async def spa(full_path: str):
    # Never serve the SPA for API / WS / mounted-asset prefixes.
    if full_path.startswith(("api/", "ws", "assets/", "static/")):
        raise HTTPException(status_code=404)
    # A path with a file extension must resolve to a real built file inside dist
    # (and stay inside it) — otherwise 404, so we never serve HTML-as-JS.
    if full_path and "." in os.path.basename(full_path):
        candidate = os.path.realpath(os.path.join(FRONTEND_DIST, full_path))
        try:
            inside = os.path.commonpath([FRONTEND_DIST, candidate]) == FRONTEND_DIST
        except ValueError:
            inside = False
        if inside and os.path.isfile(candidate):
            return FileResponse(candidate)
        raise HTTPException(status_code=404)
    # Extensionless path → SPA shell (client-side routing).
    index_file = os.path.join(FRONTEND_DIST, "index.html")
    if os.path.isfile(index_file):
        return FileResponse(index_file)
    return HTMLResponse(
        "<html><body style='font-family:-apple-system,system-ui,sans-serif;"
        "background:#1a1a1f;color:#eee;padding:48px;line-height:1.6'>"
        "<h2>🖥️ ThinkViewer backend is running</h2>"
        "<p>The frontend hasn't been built yet. Build it with:</p>"
        "<pre style='background:#000;padding:16px;border-radius:8px'>"
        "cd frontend &amp;&amp; npm install &amp;&amp; npm run build</pre>"
        "<p>then reload this page. For development, run <code>npm run dev</code> "
        "and open <a style='color:#4af' href='http://localhost:5173'>http://localhost:5173</a>.</p>"
        "</body></html>",
        status_code=503,
    )


# ============================================================
# Entry Point
# ============================================================
if __name__ == "__main__":
    import uvicorn
    # Default to loopback. Full remote control + shell access make open network
    # exposure dangerous; opt in explicitly with THINKVIEWER_BIND=0.0.0.0.
    bind = os.getenv("THINKVIEWER_BIND", "127.0.0.1")
    if bind == "0.0.0.0":
        print("\n⚠️  THINKVIEWER_BIND=0.0.0.0 — ThinkViewer is exposed on the network.")
        print("   It grants full remote control + shell access. Prefer 127.0.0.1 behind")
        print("   an HTTPS reverse proxy, and always set a strong password.\n")
    start_auto_updater()
    uvicorn.run(app, host=bind, port=PORT)
