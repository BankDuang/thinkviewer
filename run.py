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
import tv_core
from tv_core import get_setting, set_setting, SERVER_LOG_DIR  # noqa: F401
from tv_core import pid_alive as _pid_alive, port_open as _port_open  # noqa: F401
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
# Apps a user can be granted visibility of (mirrors the frontend AppKind union).
APP_KINDS = ["remote", "terminal", "files", "settings", "servers", "clientproject", "notes", "finance"]


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
    try:
        import servers_api
        servers_api.server_manager.reconcile()  # recover managed-service status after a restart
    except Exception as _rec_e:
        print(f"[servers] reconcile skipped: {_rec_e}", flush=True)
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


_net_prev = {"sent": None, "recv": None, "ts": None}


def _net_rates():
    """Network up/down in bytes/sec since the previous call (None until 2 samples
    or if psutil is unavailable)."""
    try:
        import psutil
        io = psutil.net_io_counters()
        now = time.monotonic()
        up = down = 0.0
        if _net_prev["ts"] is not None:
            dt = now - _net_prev["ts"]
            if dt > 0:
                up = max(0.0, (io.bytes_sent - _net_prev["sent"]) / dt)
                down = max(0.0, (io.bytes_recv - _net_prev["recv"]) / dt)
        _net_prev["sent"], _net_prev["recv"], _net_prev["ts"] = io.bytes_sent, io.bytes_recv, now
        return round(up), round(down)
    except Exception:
        return None, None


def _system_stats() -> dict:
    """Host CPU% + RAM (bytes) + network up/down (bytes/sec). Uses psutil when
    available; native fallback else."""
    net_up, net_down = _net_rates()
    try:
        import psutil
        vm = psutil.virtual_memory()
        return {
            "cpu": round(psutil.cpu_percent(interval=None), 1),  # non-blocking, % since last call
            "mem_used": int(vm.used),
            "mem_total": int(vm.total),
            "mem_percent": round(vm.percent, 1),
            "net_up": net_up,
            "net_down": net_down,
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
    return {"cpu": cpu, "mem_used": mem_used, "mem_total": mem_total, "mem_percent": mem_percent,
            "net_up": net_up, "net_down": net_down}


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
        ip = await asyncio.to_thread(tv_core.public_ip)
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

    # NOTE: do NOT start screen streaming here. Capturing + JPEG-encoding +
    # pushing frames to a client is only needed while the Remote Desktop app is
    # actually open. Streaming on every connection wastes host CPU and a lot of
    # client bandwidth (a keepalive frame every 2s + full fps on any screen
    # change) even when the user is just looking at the desktop. The client now
    # opts in with `stream_start` (and out with `stream_stop`) — see below.
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

            if msg_type == "stream_start":
                # Remote Desktop app opened → start streaming to this client.
                wake_screen()
                keep_awake_start()
                streamer._prev_frame_hash = None  # force an immediate fresh frame
                streamer.clients.add(websocket)
            elif msg_type == "stream_stop":
                # Remote Desktop app closed → stop streaming to this client.
                streamer.clients.discard(websocket)
                if not streamer.clients:
                    keep_awake_stop()
            elif msg_type == "stream_settings":
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


# ============================================================
# Financial app — embedded FinanceHub (Flask) run as a local service.
# We run the real app (own venv) on a loopback port; the Financial desktop
# app embeds it in an iframe so it behaves exactly like the real site with
# real data + PDF/document export.
# ============================================================
FINANCE_DIR = os.path.join(BASE_DIR, "FinanceHub")
FINANCE_PORT = int(os.getenv("THINKVIEWER_FINANCE_PORT", "19092"))
# random per-process SSO token handed to FinanceHub so the embed skips its login
FINANCE_AUTOLOGIN_TOKEN = secrets.token_urlsafe(24)
_finance_lock = threading.Lock()
_finance_proc = None


def _finance_python():
    p = os.path.join(FINANCE_DIR, ".venv", "bin", "python")
    return p if os.path.isfile(p) else None


def _finance_port_open():
    import socket
    try:
        with socket.create_connection(("127.0.0.1", FINANCE_PORT), timeout=0.4):
            return True
    except OSError:
        return False


def finance_start():
    """Spawn FinanceHub (Flask) on a loopback port if not already up."""
    global _finance_proc
    with _finance_lock:
        if _finance_port_open():
            return {"running": True, "port": FINANCE_PORT}
        # a previous spawn may still be booting (Flask cold-start takes a few
        # seconds) — don't start a second, doomed process in that window
        if _finance_proc is not None and _finance_proc.poll() is None:
            return {"running": False, "port": FINANCE_PORT, "starting": True}
        py = _finance_python()
        if not py or not os.path.isfile(os.path.join(FINANCE_DIR, "app.py")):
            return {"running": False, "port": FINANCE_PORT,
                    "available": False,
                    "error": "FinanceHub is not set up (missing .venv or app.py)."}
        os.makedirs(SERVER_LOG_DIR, exist_ok=True)
        logf = open(os.path.join(SERVER_LOG_DIR, "finance.log"), "a")
        env = dict(os.environ)
        # WeasyPrint (PDF export) loads Homebrew's pango/cairo dylibs at runtime
        env["DYLD_FALLBACK_LIBRARY_PATH"] = "/opt/homebrew/lib:" + env.get("DYLD_FALLBACK_LIBRARY_PATH", "")
        env["TV_AUTOLOGIN_TOKEN"] = FINANCE_AUTOLOGIN_TOKEN  # SSO for the embed
        try:
            _finance_proc = subprocess.Popen(
                [py, "-m", "flask", "--app", "app", "run", "--host", "127.0.0.1", "--port", str(FINANCE_PORT)],
                cwd=FINANCE_DIR, stdout=logf, stderr=subprocess.STDOUT,
                start_new_session=True, env=env)
        except Exception as e:
            return {"running": False, "port": FINANCE_PORT, "available": True, "error": f"Could not start: {e}"}
        return {"running": True, "port": FINANCE_PORT, "starting": True}


def finance_status():
    return {"running": _finance_port_open(), "port": FINANCE_PORT,
            "available": bool(_finance_python()), "autologin_token": FINANCE_AUTOLOGIN_TOKEN}


@app.get("/api/finance/status")
async def finance_status_ep(request: Request):
    _require_token(request)
    return await asyncio.to_thread(finance_status)


@app.post("/api/finance/start")
async def finance_start_ep(request: Request):
    _require_token(request)
    return await asyncio.to_thread(finance_start)


# ============================================================
# Native Financial app backend (FastAPI router over FinanceHub/instance/invoice.db).
# Guarded so a finance issue can never block ThinkViewer startup.
# ============================================================
try:
    from finance_api import router as _finance_router
    app.include_router(_finance_router)
    print("[finance] /api/fin router loaded", flush=True)
except Exception as _fin_e:  # pragma: no cover
    print(f"[finance] router NOT loaded: {_fin_e}", flush=True)

try:
    from notes_api import router as _notes_router
    app.include_router(_notes_router)
    print("[notes] /api/notes router loaded", flush=True)
except Exception as _notes_e:  # pragma: no cover
    print(f"[notes] router NOT loaded: {_notes_e}", flush=True)

try:
    from clientproject_api import router as _cp_router
    app.include_router(_cp_router)
    print("[clientproject] /api/cp router loaded", flush=True)
except Exception as _cp_e:  # pragma: no cover
    print(f"[clientproject] router NOT loaded: {_cp_e}", flush=True)

try:
    from servers_api import router as _servers_router
    app.include_router(_servers_router)
    print("[servers] /api/servers router loaded", flush=True)
except Exception as _srv_e:  # pragma: no cover
    print(f"[servers] router NOT loaded: {_srv_e}", flush=True)


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
