"""Native Financial backend — a FastAPI router over the shared FinanceHub
SQLite db (FinanceHub/instance/invoice.db). Reimplements FinanceHub's
CRM / documents / dashboard logic so the Financial app runs same-origin inside
ThinkViewer (no iframe / no reverse proxy → works locally and via the domain).

Heavy, fidelity-critical operations (PDF, DOCX, AI proposal, OCR) shell out to
FinanceHub's own venv via fin_helpers.py, reusing its exact templates + prompts.
"""
import os
import json
import sqlite3
import subprocess
import tempfile
from datetime import datetime, timedelta

from fastapi import APIRouter, Request, HTTPException, UploadFile, File
from fastapi.responses import Response, FileResponse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# The live FinanceHub (managed under the servers base dir) — its invoice.db is the
# real data the native Financial app reads/writes, and its own venv + templates
# render the PDFs/OCR via fin_helpers.py. Override with THINKVIEWER_FINANCE_DIR.
FIN_DIR = os.path.realpath(os.path.expanduser(
    os.getenv("THINKVIEWER_FINANCE_DIR", "~/Desktop/public_server/FinanceHub")))
FIN_DB = os.path.join(FIN_DIR, "instance", "invoice.db")
TV_DB = os.path.join(BASE_DIR, "thinkviewer.db")
FIN_VENV_PY = os.path.join(FIN_DIR, ".venv", "bin", "python")

router = APIRouter(prefix="/api/fin")

DOC_PREFIX = {"quotation": "QT", "invoice": "INV", "tax_invoice": "TIV"}
OUTSOURCE_CATEGORY = "ค่าจ้าง Outsource"

# ------------------------------------------------------------------ auth
def _require(request: Request):
    """Gate on a valid ThinkViewer session token (header or ?token= for downloads)."""
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip()
    if not token:
        token = request.query_params.get("token", "").strip()
    if not token:
        raise HTTPException(status_code=401)
    conn = sqlite3.connect(TV_DB, timeout=10)
    try:
        row = conn.execute(
            "SELECT 1 FROM sessions WHERE token=? AND expires_at > datetime('now')", (token,)
        ).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=401)


# ------------------------------------------------------------------ db
def _db():
    c = sqlite3.connect(FIN_DB, timeout=10)
    c.row_factory = sqlite3.Row
    return c


def _rows(sql, params=()):
    c = _db()
    try:
        return [dict(r) for r in c.execute(sql, params).fetchall()]
    finally:
        c.close()


def _row(sql, params=()):
    c = _db()
    try:
        r = c.execute(sql, params).fetchone()
        return dict(r) if r else None
    finally:
        c.close()


def _num(v, d=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return d


def _gen_number(table, col, prefix):
    """PREFIX + YYYYMMDD + NN (2-digit daily sequence), matching FinanceHub."""
    date_str = datetime.now().strftime("%Y%m%d")
    c = _db()
    try:
        row = c.execute(
            f"SELECT {col} FROM {table} WHERE {col} LIKE ? ORDER BY {col} DESC LIMIT 1",
            (f"{prefix}{date_str}%",),
        ).fetchone()
    finally:
        c.close()
    if row and row[0]:
        try:
            nxt = int(str(row[0])[-2:]) + 1
        except ValueError:
            nxt = 1
        return f"{prefix}{date_str}{str(nxt).zfill(2)}"
    return f"{prefix}{date_str}01"


def _item_amount(i):
    """Line total: use stored `amount` if present, else quantity × unit_price."""
    if i.get("amount") not in (None, ""):
        return _num(i.get("amount"))
    return (_num(i.get("quantity"), 1) or 1) * _num(i.get("unit_price"))


def _doc_totals(items, discount_percent, tax_rate, wht_rate):
    """Exact FinanceHub document totals (VAT & WHT both on taxable = subtotal-discount)."""
    subtotal = sum(_item_amount(i) for i in items)
    discount_amount = subtotal * (_num(discount_percent) / 100)
    taxable = subtotal - discount_amount
    tax_amount = taxable * (_num(tax_rate) / 100)
    total = taxable + tax_amount
    wht_amount = taxable * (_num(wht_rate) / 100) if _num(wht_rate) else 0
    grand_total = total - wht_amount
    return {
        "subtotal": round(subtotal, 2),
        "discount_amount": round(discount_amount, 2),
        "tax_amount": round(tax_amount, 2),
        "total": round(total, 2),
        "wht_amount": round(wht_amount, 2),
        "grand_total": round(grand_total, 2),
    }


def _company():
    s = _row("SELECT * FROM company_settings ORDER BY id LIMIT 1")
    if s:
        return s
    # self-healing singleton, like get_company_settings()
    c = _db()
    try:
        c.execute("INSERT INTO company_settings (name, shareholder_investment) VALUES ('My Company', 0)")
        c.commit()
        rid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
        return dict(c.execute("SELECT * FROM company_settings WHERE id=?", (rid,)).fetchone())
    finally:
        c.close()


def _bool(v):
    return 1 if v in (True, 1, "1", "true", "True", "on") else 0


# =================================================================
# Clients
# =================================================================
CLIENT_FIELDS = ("name", "company", "email", "phone", "address", "tax_id")


@router.get("/clients")
async def clients_list(request: Request):
    _require(request)
    return {"items": _rows("SELECT * FROM client ORDER BY name")}


@router.post("/clients")
async def client_create(request: Request):
    _require(request)
    b = await request.json()
    data = {k: b.get(k, "") for k in CLIENT_FIELDS}
    c = _db()
    try:
        cur = c.execute(
            "INSERT INTO client (name,company,email,phone,address,tax_id,created_at) VALUES (?,?,?,?,?,?,?)",
            (*[data[k] for k in CLIENT_FIELDS], datetime.utcnow().isoformat()),
        )
        c.commit()
        rid = cur.lastrowid
    finally:
        c.close()
    return _row("SELECT * FROM client WHERE id=?", (rid,))


@router.put("/clients/{cid}")
async def client_update(cid: int, request: Request):
    _require(request)
    b = await request.json()
    sets = ", ".join(f"{k}=?" for k in CLIENT_FIELDS if k in b)
    if sets:
        c = _db()
        try:
            c.execute(f"UPDATE client SET {sets} WHERE id=?", (*[b[k] for k in CLIENT_FIELDS if k in b], cid))
            c.commit()
        finally:
            c.close()
    return _row("SELECT * FROM client WHERE id=?", (cid,)) or HTTPException(404)


@router.delete("/clients/{cid}")
async def client_delete(cid: int, request: Request):
    _require(request)
    c = _db()
    try:
        c.execute("DELETE FROM client WHERE id=?", (cid,))
        c.commit()
    finally:
        c.close()
    return {"success": True}


# =================================================================
# People
# =================================================================
PERSON_FIELDS = ("name", "tax_id", "address", "phone", "email", "notes")


@router.get("/people")
async def people_list(request: Request):
    _require(request)
    return {"items": _rows("SELECT * FROM person ORDER BY name")}


@router.post("/people")
async def person_create(request: Request):
    _require(request)
    b = await request.json()
    c = _db()
    try:
        cur = c.execute(
            "INSERT INTO person (name,tax_id,address,phone,email,notes,created_at) VALUES (?,?,?,?,?,?,?)",
            (*[b.get(k, "") for k in PERSON_FIELDS], datetime.utcnow().isoformat()),
        )
        c.commit()
        rid = cur.lastrowid
    finally:
        c.close()
    return _row("SELECT * FROM person WHERE id=?", (rid,))


@router.put("/people/{pid}")
async def person_update(pid: int, request: Request):
    _require(request)
    b = await request.json()
    sets = ", ".join(f"{k}=?" for k in PERSON_FIELDS if k in b)
    if sets:
        c = _db()
        try:
            c.execute(f"UPDATE person SET {sets} WHERE id=?", (*[b[k] for k in PERSON_FIELDS if k in b], pid))
            c.commit()
        finally:
            c.close()
    return _row("SELECT * FROM person WHERE id=?", (pid,))


@router.delete("/people/{pid}")
async def person_delete(pid: int, request: Request):
    _require(request)
    c = _db()
    try:
        c.execute("DELETE FROM person WHERE id=?", (pid,))
        c.commit()
    finally:
        c.close()
    return {"success": True}


# =================================================================
# Company settings (singleton)
# =================================================================
SETTINGS_FIELDS = ("name", "tagline", "address", "phone", "email", "tax_id", "bank_name",
                   "bank_account", "bank_account_name", "logo_filename", "approver_name",
                   "approver_position", "shareholder_investment")


@router.get("/settings")
async def settings_get(request: Request):
    _require(request)
    return _company()


@router.put("/settings")
async def settings_update(request: Request):
    _require(request)
    b = await request.json()
    s = _company()
    sets = ", ".join(f"{k}=?" for k in SETTINGS_FIELDS if k in b)
    if sets:
        c = _db()
        try:
            c.execute(f"UPDATE company_settings SET {sets} WHERE id=?",
                      (*[b[k] for k in SETTINGS_FIELDS if k in b], s["id"]))
            c.commit()
        finally:
            c.close()
    return _company()


# =================================================================
# Projects + pipeline
# =================================================================
PROJECT_FIELDS = ("name", "description", "client_id", "status", "pipeline_stage", "budget",
                  "start_date", "end_date")


@router.get("/projects")
async def projects_list(request: Request):
    _require(request)
    return {"items": _rows("SELECT * FROM project ORDER BY created_at DESC")}


@router.get("/projects/{pid}")
async def project_get(pid: int, request: Request):
    _require(request)
    p = _row("SELECT * FROM project WHERE id=?", (pid,))
    if not p:
        raise HTTPException(404)
    p["documents"] = _rows("SELECT * FROM document WHERE project_id=? ORDER BY created_at DESC", (pid,))
    p["expenses"] = _rows("SELECT * FROM expense WHERE project_id=? ORDER BY expense_date DESC", (pid,))
    return p


@router.post("/projects")
async def project_create(request: Request):
    _require(request)
    b = await request.json()
    c = _db()
    try:
        cur = c.execute(
            "INSERT INTO project (name,description,client_id,status,pipeline_stage,budget,start_date,end_date,attachments,created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (b.get("name", ""), b.get("description", ""), b.get("client_id") or None,
             b.get("status", "active"), b.get("pipeline_stage", "negotiation"),
             _num(b.get("budget")), b.get("start_date") or None, b.get("end_date") or None,
             "", datetime.utcnow().isoformat()))
        c.commit()
        rid = cur.lastrowid
    finally:
        c.close()
    return _row("SELECT * FROM project WHERE id=?", (rid,))


@router.put("/projects/{pid}")
async def project_update(pid: int, request: Request):
    _require(request)
    b = await request.json()
    sets = ", ".join(f"{k}=?" for k in PROJECT_FIELDS if k in b)
    if sets:
        vals = [b[k] if k not in ("client_id",) or b[k] else (b[k] or None) for k in PROJECT_FIELDS if k in b]
        c = _db()
        try:
            c.execute(f"UPDATE project SET {sets} WHERE id=?", (*vals, pid))
            c.commit()
        finally:
            c.close()
    return _row("SELECT * FROM project WHERE id=?", (pid,))


@router.post("/projects/{pid}/pipeline")
async def project_pipeline(pid: int, request: Request):
    _require(request)
    b = await request.json()
    stage = b.get("stage", "")
    valid = ["negotiation", "signed", "in_progress", "delivered", "completed", "cancelled"]
    if stage not in valid:
        raise HTTPException(status_code=400, detail="Invalid stage")
    c = _db()
    try:
        # mirror FinanceHub: sync status for terminal stages
        status_map = {"completed": "completed", "cancelled": "cancelled"}
        if stage in status_map:
            c.execute("UPDATE project SET pipeline_stage=?, status=? WHERE id=?", (stage, status_map[stage], pid))
        else:
            c.execute("UPDATE project SET pipeline_stage=? WHERE id=?", (stage, pid))
        c.commit()
    finally:
        c.close()
    return {"ok": True, "stage": stage}


@router.delete("/projects/{pid}")
async def project_delete(pid: int, request: Request):
    _require(request)
    c = _db()
    try:
        c.execute("DELETE FROM project WHERE id=?", (pid,))
        c.commit()
    finally:
        c.close()
    return {"success": True}


# =================================================================
# Documents (quotation / invoice / tax_invoice)
# =================================================================
def _doc_with_items(did):
    d = _row("SELECT * FROM document WHERE id=?", (did,))
    if d:
        d["items"] = _rows("SELECT * FROM document_item WHERE document_id=? ORDER BY id", (did,))
    return d


def _write_items(c, did, items):
    for it in items:
        desc = (it.get("description") or "").strip()
        if not desc:
            continue
        qty = _num(it.get("quantity"), 1) or 1
        price = _num(it.get("unit_price"), 0)
        c.execute(
            "INSERT INTO document_item (document_id,description,quantity,unit,unit_price,amount) VALUES (?,?,?,?,?,?)",
            (did, desc, qty, it.get("unit") or "unit", price, qty * price))


@router.get("/documents")
async def documents_list(request: Request):
    _require(request)
    dt = request.query_params.get("type")
    if dt:
        return {"items": _rows("SELECT * FROM document WHERE doc_type=? ORDER BY created_at DESC", (dt,))}
    return {"items": _rows("SELECT * FROM document ORDER BY created_at DESC")}


@router.get("/documents/{did}")
async def document_get(did: int, request: Request):
    _require(request)
    d = _doc_with_items(did)
    if not d:
        raise HTTPException(404)
    return d


@router.post("/documents")
async def document_create(request: Request):
    _require(request)
    b = await request.json()
    doc_type = b.get("doc_type", "invoice")
    items = b.get("items") or []
    totals = _doc_totals(items, b.get("discount_percent"), b.get("tax_rate"), b.get("wht_rate"))
    now = datetime.utcnow().isoformat()
    c = _db()
    try:
        cur = c.execute(
            "INSERT INTO document (doc_number,doc_type,client_id,project_id,issue_date,due_date,status,"
            "subtotal,discount_percent,discount_amount,tax_rate,tax_amount,wht_rate,wht_amount,total,grand_total,"
            "notes,issued_by,show_approver,show_client_name,auto_signed,created_at,updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (_gen_number("document", "doc_number", DOC_PREFIX.get(doc_type, "DOC")), doc_type,
             b.get("client_id"), b.get("project_id") or None, b.get("issue_date") or None, b.get("due_date") or None,
             b.get("status", "draft"), totals["subtotal"], _num(b.get("discount_percent")), totals["discount_amount"],
             _num(b.get("tax_rate"), 7), totals["tax_amount"], _num(b.get("wht_rate")), totals["wht_amount"],
             totals["total"], totals["grand_total"], b.get("notes", ""), b.get("issued_by", ""),
             _bool(b.get("show_approver", True)), _bool(b.get("show_client_name", True)), _bool(b.get("auto_signed")),
             now, now))
        did = cur.lastrowid
        _write_items(c, did, items)
        c.commit()
    finally:
        c.close()
    return _doc_with_items(did)


@router.put("/documents/{did}")
async def document_update(did: int, request: Request):
    _require(request)
    b = await request.json()
    cur_doc = _row("SELECT * FROM document WHERE id=?", (did,))
    if not cur_doc:
        raise HTTPException(404)
    items = b.get("items")
    if items is None:
        items = _rows("SELECT * FROM document_item WHERE document_id=?", (did,))
    totals = _doc_totals(items, b.get("discount_percent", cur_doc["discount_percent"]),
                         b.get("tax_rate", cur_doc["tax_rate"]), b.get("wht_rate", cur_doc["wht_rate"]))
    fields = {
        "doc_number": b.get("doc_number", cur_doc["doc_number"]),
        "client_id": b.get("client_id", cur_doc["client_id"]),
        "project_id": b.get("project_id", cur_doc["project_id"]) or None,
        "issue_date": b.get("issue_date", cur_doc["issue_date"]) or None,
        "due_date": b.get("due_date", cur_doc["due_date"]) or None,
        "discount_percent": _num(b.get("discount_percent", cur_doc["discount_percent"])),
        "tax_rate": _num(b.get("tax_rate", cur_doc["tax_rate"])),
        "wht_rate": _num(b.get("wht_rate", cur_doc["wht_rate"])),
        "notes": b.get("notes", cur_doc["notes"]),
        "issued_by": b.get("issued_by", cur_doc["issued_by"]),
        "show_approver": _bool(b.get("show_approver", cur_doc["show_approver"])),
        "show_client_name": _bool(b.get("show_client_name", cur_doc["show_client_name"])),
        "auto_signed": _bool(b.get("auto_signed", cur_doc["auto_signed"])),
        **totals,
        "updated_at": datetime.utcnow().isoformat(),
    }
    # guard duplicate doc_number
    if fields["doc_number"] != cur_doc["doc_number"]:
        dup = _row("SELECT id FROM document WHERE doc_number=? AND id<>?", (fields["doc_number"], did))
        if dup:
            raise HTTPException(status_code=400, detail=f"เลขที่เอกสาร {fields['doc_number']} ซ้ำกับเอกสารที่มีอยู่แล้ว")
    c = _db()
    try:
        sets = ", ".join(f"{k}=?" for k in fields)
        c.execute(f"UPDATE document SET {sets} WHERE id=?", (*fields.values(), did))
        if b.get("items") is not None:
            c.execute("DELETE FROM document_item WHERE document_id=?", (did,))
            _write_items(c, did, items)
        c.commit()
    finally:
        c.close()
    return _doc_with_items(did)


@router.post("/documents/{did}/status")
async def document_status(did: int, request: Request):
    _require(request)
    b = await request.json()
    st = b.get("status")
    if st not in ("draft", "sent", "paid", "cancelled"):
        raise HTTPException(status_code=400, detail="Invalid status")
    c = _db()
    try:
        c.execute("UPDATE document SET status=?, updated_at=? WHERE id=?", (st, datetime.utcnow().isoformat(), did))
        c.commit()
    finally:
        c.close()
    return _doc_with_items(did)


def _clone_doc(did, new_type=None):
    src = _doc_with_items(did)
    if not src:
        raise HTTPException(404)
    doc_type = new_type or src["doc_type"]
    items = src["items"]
    totals = _doc_totals(items, src["discount_percent"], src["tax_rate"], src["wht_rate"])
    now = datetime.utcnow()
    c = _db()
    try:
        cur = c.execute(
            "INSERT INTO document (doc_number,doc_type,client_id,project_id,issue_date,due_date,status,"
            "subtotal,discount_percent,discount_amount,tax_rate,tax_amount,wht_rate,wht_amount,total,grand_total,"
            "notes,issued_by,show_approver,show_client_name,auto_signed,created_at,updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (_gen_number("document", "doc_number", DOC_PREFIX.get(doc_type, "DOC")), doc_type,
             src["client_id"], None, now.date().isoformat(), (now + timedelta(days=30)).date().isoformat(), "draft",
             totals["subtotal"], src["discount_percent"], totals["discount_amount"], src["tax_rate"],
             totals["tax_amount"], src["wht_rate"], totals["wht_amount"], totals["total"], totals["grand_total"],
             src["notes"], src["issued_by"], src["show_approver"], src["show_client_name"], src["auto_signed"],
             now.isoformat(), now.isoformat()))
        nid = cur.lastrowid
        _write_items(c, nid, items)
        c.commit()
    finally:
        c.close()
    return _doc_with_items(nid)


@router.post("/documents/{did}/duplicate")
async def document_duplicate(did: int, request: Request):
    _require(request)
    return _clone_doc(did)


@router.post("/documents/{did}/convert/{new_type}")
async def document_convert(did: int, new_type: str, request: Request):
    _require(request)
    return _clone_doc(did, new_type)


@router.delete("/documents/{did}")
async def document_delete(did: int, request: Request):
    _require(request)
    c = _db()
    try:
        c.execute("DELETE FROM document_item WHERE document_id=?", (did,))
        c.execute("DELETE FROM document WHERE id=?", (did,))
        c.commit()
    finally:
        c.close()
    return {"success": True}


# =================================================================
# Expenses (+ auto-WHT for outsource)
# =================================================================
EXPENSE_CATEGORIES = ["ค่าเดินทาง", "ค่าอาหาร", "ค่าที่พัก", "ค่าวัสดุสำนักงาน", "ค่าสาธารณูปโภค",
                      "ค่าโทรศัพท์/อินเทอร์เน็ต", "ค่าซ่อมบำรุง", "ค่าบริการ", "ค่าโฆษณา",
                      "ค่าจ้าง Outsource", "อื่นๆ"]
EXP_FIELDS = ("expense_date", "category", "description", "vendor", "amount", "vat_rate", "vat",
              "wht_rate", "wht_amount", "total", "payment_method", "receipt_number", "person_id",
              "project_id", "notes", "reimbursement_status")


def _expense_calc(b):
    amount = _num(b.get("amount"))
    vat_rate = _num(b.get("vat_rate"))
    wht_rate = _num(b.get("wht_rate"))
    vat = round(amount * vat_rate / 100, 2)
    wht_amount = round(amount * wht_rate / 100, 2)
    total = round(amount + vat, 2)
    return vat, wht_amount, total


def _auto_wht(c, exp):
    """Create a paired WHT cert when an outsource expense has a WHT rate (mirrors FinanceHub)."""
    if exp.get("category") != OUTSOURCE_CATEGORY or not _num(exp.get("wht_rate")) or not _num(exp.get("wht_amount")):
        return
    comp = _company()
    income = [{"type": "5", "date": exp.get("expense_date") or "", "amount": _num(exp.get("amount")),
               "tax": _num(exp.get("wht_amount"))}]
    c.execute(
        "INSERT INTO withholding_tax (wht_number,payer_tax_id,payer_name,payer_address,person_id,payee_tax_id,"
        "payee_name,payee_address,form_type,payment_date,income_items,total_amount,total_tax,payment_type,"
        "payment_type_other,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (_gen_number("withholding_tax", "wht_number", "WHT"), comp.get("tax_id") or "", comp.get("name") or "",
         comp.get("address") or "", exp.get("person_id"), "",
         exp.get("vendor") or exp.get("description") or "Outsource", "",
         "pnd53" if exp.get("vendor") else "pnd3", exp.get("expense_date") or datetime.now().date().isoformat(),
         json.dumps(income, ensure_ascii=False), _num(exp.get("amount")), _num(exp.get("wht_amount")), 1, "",
         f"Auto from expense {exp.get('expense_number')}", datetime.utcnow().isoformat()))


@router.get("/expenses")
async def expenses_list(request: Request):
    _require(request)
    return {"items": _rows("SELECT * FROM expense ORDER BY expense_date DESC, id DESC"),
            "categories": EXPENSE_CATEGORIES}


@router.post("/expenses")
async def expense_create(request: Request):
    _require(request)
    b = await request.json()
    vat, wht_amount, total = _expense_calc(b)
    exp = {**b, "vat": vat, "wht_amount": wht_amount, "total": total,
           "expense_number": _gen_number("expense", "expense_number", "EXP")}
    c = _db()
    try:
        cur = c.execute(
            "INSERT INTO expense (expense_number,expense_date,category,description,vendor,amount,vat_rate,vat,"
            "wht_rate,wht_amount,total,payment_method,receipt_number,person_id,project_id,notes,"
            "reimbursement_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (exp["expense_number"], b.get("expense_date") or None, b.get("category", ""), b.get("description", ""),
             b.get("vendor", ""), _num(b.get("amount")), _num(b.get("vat_rate")), vat, _num(b.get("wht_rate")),
             wht_amount, total, b.get("payment_method", "cash"), b.get("receipt_number", ""),
             b.get("person_id") or None, b.get("project_id") or None, b.get("notes", ""),
             b.get("reimbursement_status", "pending"), datetime.utcnow().isoformat()))
        rid = cur.lastrowid
        _auto_wht(c, exp)
        c.commit()
    finally:
        c.close()
    return _row("SELECT * FROM expense WHERE id=?", (rid,))


@router.put("/expenses/{eid}")
async def expense_update(eid: int, request: Request):
    _require(request)
    b = await request.json()
    cur_e = _row("SELECT * FROM expense WHERE id=?", (eid,))
    if not cur_e:
        raise HTTPException(404)
    merged = {**cur_e, **b}
    vat, wht_amount, total = _expense_calc(merged)
    fields = {k: merged.get(k) for k in EXP_FIELDS}
    fields["vat"], fields["wht_amount"], fields["total"] = vat, wht_amount, total
    for k in ("person_id", "project_id"):
        fields[k] = fields[k] or None
    c = _db()
    try:
        sets = ", ".join(f"{k}=?" for k in fields)
        c.execute(f"UPDATE expense SET {sets} WHERE id=?", (*fields.values(), eid))
        c.commit()
    finally:
        c.close()
    return _row("SELECT * FROM expense WHERE id=?", (eid,))


@router.post("/expenses/{eid}/reimbursement")
async def expense_reimbursement(eid: int, request: Request):
    _require(request)
    b = await request.json()
    st = b.get("reimbursement_status", "pending")
    c = _db()
    try:
        c.execute("UPDATE expense SET reimbursement_status=?, reimbursed_at=? WHERE id=?",
                  (st, datetime.utcnow().isoformat() if st == "reimbursed" else None, eid))
        c.commit()
    finally:
        c.close()
    return _row("SELECT * FROM expense WHERE id=?", (eid,))


@router.delete("/expenses/{eid}")
async def expense_delete(eid: int, request: Request):
    _require(request)
    c = _db()
    try:
        c.execute("DELETE FROM expense WHERE id=?", (eid,))
        c.commit()
    finally:
        c.close()
    return {"success": True}


# =================================================================
# Withholding tax certificates
# =================================================================
WHT_FIELDS = ("payer_tax_id", "payer_name", "payer_address", "person_id", "payee_tax_id", "payee_name",
              "payee_address", "form_type", "payment_date", "total_amount", "total_tax", "payment_type",
              "payment_type_other", "reference_doc_id", "notes")


def _wht_totals(income_items):
    return (round(sum(_num(i.get("amount")) for i in income_items), 2),
            round(sum(_num(i.get("tax")) for i in income_items), 2))


def _wht_out(w):
    if w and isinstance(w.get("income_items"), str):
        try:
            w["income_items"] = json.loads(w["income_items"] or "[]")
        except Exception:
            w["income_items"] = []
    return w


@router.get("/wht")
async def wht_list(request: Request):
    _require(request)
    return {"items": [_wht_out(w) for w in _rows("SELECT * FROM withholding_tax ORDER BY created_at DESC")]}


@router.get("/wht/{wid}")
async def wht_get(wid: int, request: Request):
    _require(request)
    w = _wht_out(_row("SELECT * FROM withholding_tax WHERE id=?", (wid,)))
    if not w:
        raise HTTPException(404)
    return w


@router.post("/wht")
async def wht_create(request: Request):
    _require(request)
    b = await request.json()
    income = b.get("income_items") or []
    ta, tt = _wht_totals(income)
    c = _db()
    try:
        cur = c.execute(
            "INSERT INTO withholding_tax (wht_number,payer_tax_id,payer_name,payer_address,person_id,payee_tax_id,"
            "payee_name,payee_address,form_type,payment_date,income_items,total_amount,total_tax,payment_type,"
            "payment_type_other,reference_doc_id,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (_gen_number("withholding_tax", "wht_number", "WHT"), b.get("payer_tax_id", ""), b.get("payer_name", ""),
             b.get("payer_address", ""), b.get("person_id") or None, b.get("payee_tax_id", ""),
             b.get("payee_name", ""), b.get("payee_address", ""), b.get("form_type", "pnd3"),
             b.get("payment_date") or None, json.dumps(income, ensure_ascii=False), ta, tt,
             int(_num(b.get("payment_type"), 1)), b.get("payment_type_other", ""),
             b.get("reference_doc_id") or None, b.get("notes", ""), datetime.utcnow().isoformat()))
        rid = cur.lastrowid
        c.commit()
    finally:
        c.close()
    return _wht_out(_row("SELECT * FROM withholding_tax WHERE id=?", (rid,)))


@router.put("/wht/{wid}")
async def wht_update(wid: int, request: Request):
    _require(request)
    b = await request.json()
    cur_w = _row("SELECT * FROM withholding_tax WHERE id=?", (wid,))
    if not cur_w:
        raise HTTPException(404)
    fields = {k: b.get(k, cur_w.get(k)) for k in WHT_FIELDS}
    for k in ("person_id", "reference_doc_id"):
        fields[k] = fields[k] or None
    if "income_items" in b:
        income = b.get("income_items") or []
        fields["income_items"] = json.dumps(income, ensure_ascii=False)
        fields["total_amount"], fields["total_tax"] = _wht_totals(income)
    c = _db()
    try:
        sets = ", ".join(f"{k}=?" for k in fields)
        c.execute(f"UPDATE withholding_tax SET {sets} WHERE id=?", (*fields.values(), wid))
        c.commit()
    finally:
        c.close()
    return _wht_out(_row("SELECT * FROM withholding_tax WHERE id=?", (wid,)))


@router.delete("/wht/{wid}")
async def wht_delete(wid: int, request: Request):
    _require(request)
    c = _db()
    try:
        c.execute("DELETE FROM withholding_tax WHERE id=?", (wid,))
        c.commit()
    finally:
        c.close()
    return {"success": True}


# =================================================================
# Dashboard
# =================================================================
@router.get("/dashboard")
async def dashboard(request: Request):
    _require(request)
    qp = request.query_params
    fm = qp.get("month")
    fy = qp.get("year")
    filter_month = int(fm) if fm and fm.isdigit() else None
    filter_year = int(fy) if fy and fy.isdigit() else None
    if filter_year is None and fy != "":
        filter_year = datetime.now().year

    def date_clause(col):
        conds, params = [], []
        if filter_month:
            conds.append(f"CAST(strftime('%m',{col}) AS INTEGER)=?")
            params.append(filter_month)
        if filter_year:
            conds.append(f"CAST(strftime('%Y',{col}) AS INTEGER)=?")
            params.append(filter_year)
        return (" WHERE " + " AND ".join(conds) if conds else "", params)

    dwhere, dparams = date_clause("issue_date")
    ewhere, eparams = date_clause("expense_date")
    docs = _rows(f"SELECT * FROM document{dwhere}", dparams)
    exps = _rows(f"SELECT * FROM expense{ewhere}", eparams)
    projects = _rows("SELECT id,status,pipeline_stage FROM project")
    proj_status = {r["id"]: r["status"] for r in projects}

    quotations = [d for d in docs if d["doc_type"] == "quotation" and d["status"] != "cancelled"
                  and (not d["project_id"] or proj_status.get(d["project_id"]) != "cancelled")]
    invoices = [d for d in docs if d["doc_type"] == "invoice"]
    recognized = [d for d in docs if d["doc_type"] == "tax_invoice" and d["status"] in ("sent", "paid")]
    company_exps = [e for e in exps if e["reimbursement_status"] not in ("owner_paid", "company_paid")]

    revenue = sum(_num(d["total"]) for d in recognized)
    expenses_total = sum(_num(e["total"]) for e in company_exps)
    comp = _company()
    shareholder = _num(comp.get("shareholder_investment"))
    pst = {s: sum(1 for p in projects if p["status"] == s) for s in ("active", "completed", "on_hold", "cancelled")}
    total_projects = len(projects)

    # monthly (last 6 months, 30-day step, revenue only)
    monthly = []
    now = datetime.now()
    for i in range(5, -1, -1):
        md = now - timedelta(days=i * 30)
        m, y = md.month, md.year
        rev = sum(_num(d["total"]) for d in _rows(
            "SELECT total FROM document WHERE doc_type='tax_invoice' AND status IN ('sent','paid') "
            "AND CAST(strftime('%m',issue_date) AS INTEGER)=? AND CAST(strftime('%Y',issue_date) AS INTEGER)=?", (m, y)))
        monthly.append({"month": md.strftime("%b"), "revenue": round(rev, 2)})

    return {
        "filter_month": filter_month, "filter_year": filter_year,
        "years": [now.year - 2, now.year - 1, now.year],
        "total_clients": _row("SELECT COUNT(*) n FROM client")["n"],
        "total_people": _row("SELECT COUNT(*) n FROM person")["n"],
        "total_projects": total_projects,
        "project_status": pst,
        "completed_projects": pst["completed"],
        "success_rate": (pst["completed"] / total_projects * 100) if total_projects else 0,
        "quotation_total": round(sum(_num(d["total"]) for d in quotations), 2),
        "quotation_count": len(quotations),
        "revenue": round(revenue, 2),
        "paid_invoice_count": len(recognized),
        "expenses_total": round(expenses_total, 2),
        "profit": round(revenue - expenses_total, 2),
        "shareholder_investment": shareholder,
        "cashflow": round(revenue + shareholder - expenses_total, 2),
        "vat_output": round(sum(_num(d["tax_amount"]) for d in recognized), 2),
        "vat_input": round(sum(_num(e["vat"]) for e in exps if e["vat"]), 2),
        "wht_deducted": round(sum(_num(d["wht_amount"]) for d in recognized if d["wht_amount"]), 2),
        "wht_withheld": round(sum(_num(e["wht_amount"]) for e in company_exps if e["wht_amount"]), 2),
        "monthly_data": monthly,
        "recent_docs": _rows("SELECT id,doc_number,doc_type,total,issue_date,client_id,status FROM document ORDER BY created_at DESC LIMIT 5"),
        "recent_expenses": _rows("SELECT id,description,category,total,expense_date FROM expense ORDER BY created_at DESC LIMIT 5"),
        "company": comp,
    }
    # vat_payable computed client-side as vat_output - vat_input


# =================================================================
# PDF (shell out to FinanceHub's venv → reuses its exact pdf.html + WeasyPrint)
# =================================================================
def _render_pdf(kind, rid, copy="original", lang="th"):
    if not os.path.isfile(FIN_VENV_PY):
        raise HTTPException(status_code=503, detail="Finance PDF engine not set up (FinanceHub/.venv missing)")
    env = dict(os.environ)
    env["DYLD_FALLBACK_LIBRARY_PATH"] = "/opt/homebrew/lib:" + env.get("DYLD_FALLBACK_LIBRARY_PATH", "")
    try:
        proc = subprocess.run(
            [FIN_VENV_PY, os.path.join(FIN_DIR, "fin_helpers.py"), kind, str(rid), copy, lang],
            cwd=FIN_DIR, capture_output=True, env=env, timeout=60)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="PDF render timed out")
    if proc.returncode != 0 or proc.stdout[:4] != b"%PDF":
        raise HTTPException(status_code=500, detail=f"PDF render failed: {proc.stderr.decode('utf-8','replace')[:500]}")
    return proc.stdout


@router.get("/documents/{did}/pdf")
async def document_pdf(did: int, request: Request):
    _require(request)
    copy = request.query_params.get("copy", "original")
    lang = request.query_params.get("lang", "th")
    pdf = _render_pdf("doc", did, copy, lang)
    num = (_row("SELECT doc_number FROM document WHERE id=?", (did,)) or {}).get("doc_number", "document")
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename={num}.pdf"})


@router.get("/wht/{wid}/pdf")
async def wht_pdf(wid: int, request: Request):
    _require(request)
    pdf = _render_pdf("wht", wid, "original", request.query_params.get("lang", "th"))
    num = (_row("SELECT wht_number FROM withholding_tax WHERE id=?", (wid,)) or {}).get("wht_number", "wht")
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename={num}.pdf"})


# =================================================================
# Pipeline (kanban with per-project billing values, like FinanceHub)
# =================================================================
PIPELINE_META = [
    {"key": "negotiation", "label": "เจรจา/เสนอราคา", "color": "purple"},
    {"key": "signed", "label": "เซ็นสัญญา", "color": "blue"},
    {"key": "in_progress", "label": "กำลังดำเนินการ", "color": "yellow"},
    {"key": "completed", "label": "เสร็จสิ้น", "color": "green"},
]


@router.get("/pipeline")
async def pipeline(request: Request):
    _require(request)
    projects = _rows("SELECT * FROM project WHERE pipeline_stage IS NULL OR pipeline_stage != 'cancelled'")
    docs_by_proj = {}
    for d in _rows("SELECT project_id,doc_type,status,total FROM document WHERE project_id IS NOT NULL"):
        docs_by_proj.setdefault(d["project_id"], []).append(d)
    clients = {c["id"]: c["name"] for c in _rows("SELECT id,name FROM client")}
    data = []
    for p in projects:
        docs = docs_by_proj.get(p["id"], [])
        quotations = [d for d in docs if d["doc_type"] == "quotation" and d["status"] != "cancelled"]
        contract = sum(_num(d["total"]) for d in quotations) if quotations else _num(p.get("budget"))
        tax = [d for d in docs if d["doc_type"] == "tax_invoice" and d["status"] != "cancelled"]
        invoiced = (sum(_num(d["total"]) for d in tax) if tax
                    else sum(_num(d["total"]) for d in docs if d["doc_type"] == "invoice" and d["status"] != "cancelled"))
        paid = sum(_num(d["total"]) for d in docs if d["doc_type"] == "tax_invoice" and d["status"] in ("sent", "paid"))
        eff = contract if contract > 0 else invoiced
        outstanding = eff - paid
        pct = min((paid / eff * 100) if eff > 0 else (100 if paid > 0 else 0), 100)
        data.append({"id": p["id"], "name": p["name"], "client": clients.get(p.get("client_id"), ""),
                     "stage": p.get("pipeline_stage") or "negotiation", "budget": _num(p.get("budget")),
                     "contract_value": round(eff, 2), "invoiced": round(invoiced, 2), "paid": round(paid, 2),
                     "outstanding": round(outstanding, 2), "payment_pct": round(pct)})
    totals = {k: round(sum(d[k] for d in data), 2) for k in ("contract_value", "invoiced", "paid", "outstanding")}
    totals["pipeline_value"] = totals.pop("contract_value")
    return {"stages": PIPELINE_META, "projects": data, "totals": totals,
            "cancelled_count": _row("SELECT COUNT(*) n FROM project WHERE pipeline_stage='cancelled'")["n"]}


# =================================================================
# Company logo (served with ?token= so an <img> can load it)
# =================================================================
@router.get("/logo")
async def company_logo(request: Request):
    _require(request)
    fn = os.path.basename((_company().get("logo_filename") or "").strip())
    if not fn:
        raise HTTPException(404)
    path = os.path.join(FIN_DIR, "static", "uploads", fn)
    if not os.path.isfile(path):
        raise HTTPException(404)
    return FileResponse(path)


# =================================================================
# OCR receipt → expense fields (reuses FinanceHub's Gemini OCR via venv)
# =================================================================
@router.post("/ocr")
async def ocr(request: Request, file: UploadFile = File(...)):
    _require(request)
    if not os.path.isfile(FIN_VENV_PY):
        raise HTTPException(status_code=503, detail="OCR engine not set up (FinanceHub/.venv missing)")
    raw = await file.read()
    suffix = os.path.splitext(file.filename or "receipt.jpg")[1] or ".jpg"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tf:
        tf.write(raw)
        tmp = tf.name
    try:
        env = dict(os.environ)
        env["DYLD_FALLBACK_LIBRARY_PATH"] = "/opt/homebrew/lib:" + env.get("DYLD_FALLBACK_LIBRARY_PATH", "")
        proc = subprocess.run(
            [FIN_VENV_PY, os.path.join(FIN_DIR, "fin_helpers.py"), "ocr", tmp, file.filename or "receipt.jpg"],
            cwd=FIN_DIR, capture_output=True, env=env, timeout=120)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass
    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail=f"OCR failed: {proc.stderr.decode('utf-8', 'replace')[:500]}")
    try:
        return json.loads(proc.stdout.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=500, detail="OCR returned invalid data")
