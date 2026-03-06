"""
ThinkViewer - Remote Desktop Control Application
Similar to TeamViewer, accessible via browser on port 19080
"""

import os
import json
import uuid
import hashlib
import secrets
import string
import sqlite3
import asyncio
import base64
import io
import platform
import shutil
from pathlib import Path
from datetime import datetime, timedelta
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

from fastapi import (
    FastAPI, WebSocket, WebSocketDisconnect,
    HTTPException, Request, UploadFile, File, Form, Query
)
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

import mss
from PIL import Image, ImageDraw
import pyautogui

# ============================================================
# Configuration
# ============================================================
PORT = int(os.getenv("THINKVIEWER_PORT", "19080"))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "thinkviewer.db")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
ENV_PASSWORD = os.getenv("THINKVIEWER_PASSWORD")

pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0


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


def create_session(ip_address=""):
    token = str(uuid.uuid4())
    expires = (datetime.now() + timedelta(hours=24)).isoformat()
    conn = get_db()
    conn.execute(
        "INSERT INTO sessions (token, expires_at, ip_address) VALUES (?, ?, ?)",
        (token, expires, ip_address),
    )
    conn.commit()
    conn.close()
    return token


def verify_token(token):
    if not token:
        return False
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM sessions WHERE token=? AND expires_at > datetime('now')",
        (token,),
    ).fetchone()
    conn.close()
    return row is not None


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

    def _draw_cursor(self, pil_img):
        """Draw mouse cursor overlay on the captured image."""
        try:
            cx, cy = pyautogui.position()
            cx = int(cx * self.scale)
            cy = int(cy * self.scale)
            s = max(14, int(22 * self.scale))
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
                self.screen_width = monitor["width"]
                self.screen_height = monitor["height"]

                while self.running:
                    if self.clients:
                        try:
                            img = sct.grab(monitor)
                            pil_img = Image.frombytes("RGB", img.size, img.bgra, "raw", "BGRX")

                            if self.scale < 1.0:
                                new_w = int(pil_img.width * self.scale)
                                new_h = int(pil_img.height * self.scale)
                                pil_img = pil_img.resize((new_w, new_h), Image.LANCZOS)

                            self._draw_cursor(pil_img)

                            buf = io.BytesIO()
                            pil_img.save(buf, format="JPEG", quality=self.quality)
                            frame = base64.b64encode(buf.getvalue()).decode()

                            msg = json.dumps({
                                "type": "frame",
                                "data": frame,
                                "width": self.screen_width,
                                "height": self.screen_height,
                            })

                            dead = set()
                            for ws in list(self.clients):
                                try:
                                    await ws.send_text(msg)
                                except Exception:
                                    dead.add(ws)
                            self.clients -= dead
                        except Exception as e:
                            print(f"Capture error: {e}")

                    await asyncio.sleep(1.0 / self.fps)
        except asyncio.CancelledError:
            pass

    def update_settings(self, quality=None, fps=None, scale=None):
        if quality is not None:
            self.quality = max(10, min(100, int(quality)))
        if fps is not None:
            self.fps = max(1, min(30, int(fps)))
        if scale is not None:
            self.scale = max(0.25, min(1.5, float(scale)))


streamer = ScreenStreamer()


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
            pyautogui.doubleClick(x, y, _pause=False)

        elif event_type == "mouse_down":
            x, y = int(data["x"] * sw), int(data["y"] * sh)
            pyautogui.mouseDown(x=x, y=y, button=data.get("button", "left"), _pause=False)

        elif event_type == "mouse_up":
            x, y = int(data["x"] * sw), int(data["y"] * sh)
            pyautogui.mouseUp(x=x, y=y, button=data.get("button", "left"), _pause=False)

        elif event_type == "mouse_scroll":
            x, y = int(data["x"] * sw), int(data["y"] * sh)
            pyautogui.scroll(data.get("delta", 0), x=x, y=y, _pause=False)

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
                    # Always release modifiers to prevent them getting stuck
                    for m in modifiers:
                        try:
                            pyautogui.keyUp(m, _pause=False)
                        except Exception:
                            pass

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
    init_db()
    task = asyncio.create_task(streamer.start())
    yield
    streamer.running = False
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="ThinkViewer", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))


# ============================================================
# Routes
# ============================================================
@app.get("/")
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.post("/api/auth/login")
async def login(request: Request):
    body = await request.json()
    password = body.get("password", "")
    if verify_password(password):
        ip = request.client.host if request.client else "unknown"
        token = create_session(ip)
        conn = get_db()
        conn.execute(
            "INSERT INTO connection_log (ip_address, action) VALUES (?, 'login')",
            (ip,),
        )
        conn.commit()
        conn.close()
        return {"success": True, "token": token}
    raise HTTPException(status_code=401, detail="Invalid password")


@app.post("/api/auth/logout")
async def logout(request: Request):
    body = await request.json()
    delete_session(body.get("token", ""))
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
    }


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

    streamer.clients.add(websocket)
    await websocket.send_json({
        "type": "auth_ok",
        "screen_width": streamer.screen_width,
        "screen_height": streamer.screen_height,
    })

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            if data.get("type") == "stream_settings":
                streamer.update_settings(
                    quality=data.get("quality"),
                    fps=data.get("fps"),
                    scale=data.get("scale"),
                )
            else:
                handle_input(data)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        streamer.clients.discard(websocket)


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
    if not dest_dir.exists():
        raise HTTPException(status_code=404, detail="Destination not found")

    dest_file = dest_dir / file.filename
    content = await file.read()
    with open(dest_file, "wb") as f:
        f.write(content)

    return {"success": True, "path": str(dest_file), "size": len(content)}


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


@app.post("/api/settings/password")
async def change_password(request: Request):
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not verify_token(token):
        raise HTTPException(status_code=401)

    body = await request.json()
    new_password = body.get("password", "")

    if len(new_password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")

    pw_hash = hashlib.sha256(new_password.encode()).hexdigest()
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
# Entry Point
# ============================================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
