"""Client Project (CRM) backend — a self-contained FastAPI router over
thinkviewer.db. Owns its generic cp_<entity> tables (driven by CP_ENTITIES) +
upload dir, and uses the shared tv_core helpers (db, auth, actor attribution,
upload cap). Files are served back via the generic /api/files/download endpoint.
"""
import os
import json
import uuid
import asyncio
from datetime import datetime, timedelta

from fastapi import APIRouter, Request, HTTPException, UploadFile, File, Form

import tv_core
from tv_core import get_db

router = APIRouter()

CP_FILES_DIR = os.path.join(tv_core.BASE_DIR, "client_project_files")  # CRM attachments

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
    "activity": ["project_id", "client_id", "kind", "message", "actor"],
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


def ensure_schema():
    """Generic cp_<entity> tables, driven by CP_ENTITIES (forward-compatible adds)."""
    conn = get_db()
    c = conn.cursor()
    for _ent, _cols in CP_ENTITIES.items():
        _defs = ", ".join(f"{_c} TEXT" for _c in _cols)
        c.execute(f"CREATE TABLE IF NOT EXISTS cp_{_ent} "
                  f"(id TEXT PRIMARY KEY, {_defs}, created_at TEXT, updated_at TEXT)")
        _have = {r[1] for r in c.execute(f"PRAGMA table_info(cp_{_ent})").fetchall()}
        for _c in _cols:
            if _c not in _have:
                c.execute(f"ALTER TABLE cp_{_ent} ADD COLUMN {_c} TEXT")
    conn.commit()
    conn.close()


ensure_schema()


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


def _cp_log(entity, action, data, actor=""):
    """Auto-append a timeline entry for create/update/delete of CRM records."""
    if entity == "activity":
        return
    label = data.get("name") or data.get("title") or data.get("feature") or ""
    msg = f"{action} {entity}" + (f": {label}" if label else "")
    try:
        conn = get_db()
        now = datetime.now().isoformat()
        conn.execute(
            "INSERT INTO cp_activity (id, project_id, client_id, kind, message, actor, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (uuid.uuid4().hex[:8], str(data.get("project_id") or ""),
             str(data.get("client_id") or ""), entity, msg, actor, now, now))
        conn.commit()
        conn.close()
    except Exception:
        pass


@router.get("/api/cp/dashboard")
async def cp_dashboard(request: Request):
    tv_core.require(request)

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
            # an issue is "done" only when fixed AND client-confirmed; open = the rest
            "issues_open": s("SELECT COUNT(*) FROM cp_issues WHERE NOT (status IN ('fixed','verified','closed') AND client_confirmed IN ('1','true','True'))"),
            "issues_critical": s("SELECT COUNT(*) FROM cp_issues WHERE severity='critical' AND NOT (status IN ('fixed','verified','closed') AND client_confirmed IN ('1','true','True'))"),
            "tasks_open": s("SELECT COUNT(*) FROM cp_tasks WHERE status NOT IN ('done')"),
            "tasks_overdue": s("SELECT COUNT(*) FROM cp_tasks WHERE status NOT IN ('done') AND due_date<>'' AND due_date < ?", today),
            "requirements_open": s("SELECT COUNT(*) FROM cp_requirements WHERE status NOT IN ('done')"),
            "cr_open": s("SELECT COUNT(*) FROM cp_change_requests WHERE status NOT IN ('done','rejected')"),
            "total_budget": s("SELECT COALESCE(SUM(CAST(NULLIF(budget,'') AS REAL)),0) FROM cp_projects"),
            "outstanding": s("SELECT COALESCE(SUM(CAST(NULLIF(amount,'') AS REAL)),0) FROM cp_payments WHERE COALESCE(paid,'0') NOT IN ('1','true','True')"),
        }
        out["deadlines"] = [dict(r) for r in conn.execute(
            "SELECT id,name,deliver_date,status FROM cp_projects WHERE status='active' "
            "AND deliver_date<>'' AND deliver_date <= ? ORDER BY deliver_date LIMIT 10", (soon,)).fetchall()]
        out["critical_issues"] = [dict(r) for r in conn.execute(
            "SELECT id,project_id,title,severity,status FROM cp_issues "
            "WHERE severity='critical' AND NOT (status IN ('fixed','verified','closed') AND client_confirmed IN ('1','true','True')) "
            "ORDER BY created_at DESC LIMIT 10").fetchall()]
        out["recent_activity"] = [dict(r) for r in conn.execute(
            "SELECT * FROM cp_activity ORDER BY created_at DESC LIMIT 15").fetchall()]
        conn.close()
        return out

    return await asyncio.to_thread(work)


@router.post("/api/cp/upload")
async def cp_upload(file: UploadFile = File(...), token: str = Form(""),
                    project_id: str = Form(""), client_id: str = Form(""),
                    issue_id: str = Form(""), category: str = Form("")):
    if not tv_core.verify_token(token):
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
                if size > tv_core.MAX_UPLOAD_BYTES:
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


@router.get("/api/cp/{entity}")
async def cp_list(entity: str, request: Request):
    tv_core.require(request)
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


@router.post("/api/cp/{entity}")
async def cp_create(entity: str, request: Request):
    tv_core.require(request)
    cols = CP_ENTITIES.get(entity)
    if cols is None:
        raise HTTPException(status_code=404, detail="Unknown entity")
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid request")
    actor = tv_core.actor(request)

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
        _cp_log(entity, "created", {**body, "id": rid}, actor)
        return _cp_to_dict(entity, row)

    return await asyncio.to_thread(work)


@router.put("/api/cp/{entity}/{rid}")
async def cp_update(entity: str, rid: str, request: Request):
    tv_core.require(request)
    cols = CP_ENTITIES.get(entity)
    if cols is None:
        raise HTTPException(status_code=404, detail="Unknown entity")
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid request")
    actor = tv_core.actor(request)

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
        _cp_log(entity, "updated", {**body, "id": rid}, actor)
        return _cp_to_dict(entity, row)

    res = await asyncio.to_thread(work)
    if res is None:
        raise HTTPException(status_code=404, detail="Not found")
    return res


@router.delete("/api/cp/{entity}/{rid}")
async def cp_delete(entity: str, rid: str, request: Request):
    tv_core.require(request)
    cols = CP_ENTITIES.get(entity)
    if cols is None:
        raise HTTPException(status_code=404, detail="Unknown entity")
    actor = tv_core.actor(request)

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
        _cp_log(entity, "deleted", d, actor)
        return True

    if not await asyncio.to_thread(work):
        raise HTTPException(status_code=404, detail="Not found")
    return {"success": True}
