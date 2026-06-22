"""Notes app backend — a self-contained FastAPI router over thinkviewer.db.

Owns its own `notes` table (+ image dir) and uses the shared `tv_core` helpers
for the db connection and token auth. Note images are written here but served
back through the generic /api/files/download endpoint in run.py.
"""
import os
import json
import uuid
import asyncio
from datetime import datetime

from fastapi import APIRouter, Request, HTTPException, UploadFile, File, Form

import tv_core
from tv_core import get_db

router = APIRouter()

NOTES_FILES_DIR = os.path.join(tv_core.BASE_DIR, "notes_files")  # image attachments
NOTES_JSON = ("checklist", "images")        # JSON-encoded columns
NOTE_COLS = ("title", "body", "checklist", "images", "pinned", "color", "deadline")


def ensure_schema():
    """Create/migrate the notes table (standalone — not the CRM's cp_notes)."""
    conn = get_db()
    c = conn.cursor()
    c.execute("""CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY, title TEXT, body TEXT, checklist TEXT, images TEXT,
        pinned TEXT, color TEXT, deadline TEXT, created_at TEXT, updated_at TEXT)""")
    if "deadline" not in {r[1] for r in c.execute("PRAGMA table_info(notes)").fetchall()}:
        c.execute("ALTER TABLE notes ADD COLUMN deadline TEXT")  # migrate older DBs
    conn.commit()
    conn.close()


ensure_schema()


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
    for k in ("title", "body", "pinned", "color", "deadline", "created_at", "updated_at"):
        if d.get(k) is None:
            d[k] = ""
    return d


def _note_clean(key, value):
    if key in NOTES_JSON or isinstance(value, (dict, list)):
        return json.dumps(value)
    if isinstance(value, bool):
        return "1" if value else "0"
    return value


@router.get("/api/notes")
async def notes_list(request: Request):
    tv_core.require(request)

    def work():
        conn = get_db()
        rows = conn.execute(
            "SELECT * FROM notes ORDER BY "
            "CASE WHEN pinned IN ('1','true','True') THEN 0 ELSE 1 END, "      # pinned first
            "CASE WHEN deadline IS NULL OR deadline='' THEN 1 ELSE 0 END, "    # dated before undated
            "deadline ASC, "                                                  # soonest deadline first
            "updated_at DESC").fetchall()
        conn.close()
        return [_note_to_dict(r) for r in rows]

    return {"items": await asyncio.to_thread(work)}


@router.post("/api/notes")
async def notes_create(request: Request):
    tv_core.require(request)
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


@router.put("/api/notes/{nid}")
async def notes_update(nid: str, request: Request):
    tv_core.require(request)
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


@router.delete("/api/notes/{nid}")
async def notes_delete(nid: str, request: Request):
    tv_core.require(request)

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


@router.post("/api/notes/upload")
async def notes_upload(file: UploadFile = File(...), token: str = Form("")):
    if not tv_core.verify_token(token):
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
                if size > tv_core.MAX_UPLOAD_BYTES:
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
