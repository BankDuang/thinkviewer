"""Shared backend core for ThinkViewer feature-app routers.

Feature apps live in their own `<app>_api.py` modules (notes_api, servers_api,
clientproject_api, finance_api, …) as self-contained FastAPI `APIRouter`s that
`run.py` mounts via `include_router`. This module is the small shared base they
build on — the `thinkviewer.db` connection, token authentication, and the upload
size cap — so an app router never has to reach into `run.py` (which would couple
the apps together and risk circular imports). `run.py` keeps its own copies of
this logic for the core (screen/terminal/auth/SPA); the two are intentionally
identical so the moved endpoints behave exactly as before.
"""
import os
import json
import sqlite3

from fastapi import Request, HTTPException

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "thinkviewer.db")
MAX_UPLOAD_BYTES = int(os.getenv("THINKVIEWER_MAX_UPLOAD_MB", "2048")) * 1024 * 1024


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _token_of(request: Request) -> str:
    return request.headers.get("Authorization", "").replace("Bearer ", "")


def user_for_token(token):
    """The user a (valid, unexpired) token belongs to, or None."""
    if not token:
        return None
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id "
            "WHERE s.token=? AND s.expires_at > datetime('now')", (token,)).fetchone()
    finally:
        conn.close()
    if not row:
        return None
    return {"id": row["id"], "username": row["username"], "role": row["role"],
            "apps": json.loads(row["apps"] or "[]")}


def verify_token(token) -> bool:
    return user_for_token(token) is not None


def require(request: Request) -> dict:
    """Return the authenticated user for this request, or raise 401."""
    user = user_for_token(_token_of(request))
    if not user:
        raise HTTPException(status_code=401)
    return user


def require_admin(request: Request) -> dict:
    user = require(request)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user


def actor(request: Request) -> str:
    """Username behind the request's token (for activity attribution), '' if none."""
    u = user_for_token(_token_of(request))
    return u["username"] if u else ""
