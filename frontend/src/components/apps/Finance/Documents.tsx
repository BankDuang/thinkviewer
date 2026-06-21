import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Icon } from '@/components/common/Icon'
import { notify } from '@/store/notificationStore'
import { confirmDialog } from '@/store/dialogStore'
import { fin, baht, ymd, DOC_TYPES, DOC_STATUS, type Row } from './api'
import { Badge, Modal, useRows } from './ui'

const TH = Object.fromEntries(DOC_TYPES.map((t) => [t.key, t.th]))

function calc(items: Row[], dp: number, tr: number, wr: number) {
  const subtotal = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0)
  const discount = subtotal * (dp / 100)
  const taxable = subtotal - discount
  const tax = taxable * (tr / 100)
  const total = taxable + tax
  const wht = wr ? taxable * (wr / 100) : 0
  return { subtotal, discount, tax, total, wht, grand: total - wht }
}

export function FinDocuments() {
  const { rows, loading, reload } = useRows(() => fin.documents(), [])
  const [clients, setClients] = useState<Row[]>([])
  const [projects, setProjects] = useState<Row[]>([])
  const [type, setType] = useState('all')
  const [editing, setEditing] = useState<Row | null | undefined>(undefined)
  const [viewing, setViewing] = useState<Row | null>(null)

  useEffect(() => {
    fin.clients().then(setClients).catch(() => {})
    fin.projects().then(setProjects).catch(() => {})
  }, [])
  const clientName = (id: unknown) => clients.find((c) => String(c.id) === String(id))?.name ?? '—'

  const filtered = useMemo(() => (type === 'all' ? rows : rows.filter((r) => r.doc_type === type)), [rows, type])

  return (
    <div className="cp-section">
      <div className="cp-section-head">
        <div className="cp-section-title"><Icon name="clipboard" size={18} /> <span>Documents</span><span className="cp-count">{filtered.length}</span></div>
        <div className="cp-section-actions">
          <button className="tv-btn" onClick={() => reload()} aria-label="Refresh"><Icon name="refresh" size={14} className={loading ? 'spin' : undefined} /></button>
          <button className="tv-btn tv-btn--primary" onClick={() => setEditing(null)}><Icon name="plus" size={14} /> New Document</button>
        </div>
      </div>
      <div className="fin-pills">
        <button className={type === 'all' ? 'is-on' : ''} onClick={() => setType('all')}>All</button>
        {DOC_TYPES.map((t) => <button key={t.key} className={type === t.key ? 'is-on' : ''} onClick={() => setType(t.key)}>{t.label}</button>)}
      </div>

      {loading ? <div className="cp-empty"><Icon name="refresh" size={26} className="spin" /></div> : filtered.length === 0 ? (
        <div className="cp-empty"><Icon name="clipboard" size={32} strokeWidth={1.3} /><p>No documents yet</p></div>
      ) : (
        <div className="cp-table-wrap">
          <table className="cp-table">
            <thead><tr><th>Number</th><th>Type</th><th>Client</th><th>Date</th><th>Status</th><th>Total</th><th className="cp-col-actions" /></tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="cp-row-click" onClick={() => setViewing(r)}>
                  <td><b>{r.doc_number}</b></td>
                  <td>{TH[r.doc_type] ?? r.doc_type}</td>
                  <td>{clientName(r.client_id)}</td>
                  <td className="cp-mono">{ymd(r.issue_date)}</td>
                  <td><Badge v={r.status} /></td>
                  <td className="cp-mono">{baht(r.total)}</td>
                  <td className="cp-col-actions">
                    <a className="cp-rowbtn" href={fin.pdfUrl('documents', r.id, '&lang=th')} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="PDF"><Icon name="download" size={14} /></a>
                    <button className="cp-rowbtn" onClick={(e) => { e.stopPropagation(); setEditing(r) }} aria-label="Edit"><Icon name="pencil" size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewing && (
        <DocView doc={viewing} clientName={clientName} onClose={() => setViewing(null)}
          onEdit={() => { setEditing(viewing); setViewing(null) }}
          onChanged={() => { reload(true); setViewing(null) }} />
      )}
      {editing !== undefined && (
        <DocForm initial={editing} clients={clients} projects={projects}
          onClose={() => setEditing(undefined)} onSaved={() => { reload(true); setEditing(undefined) }} />
      )}
    </div>
  )
}

function DocView({ doc, clientName, onClose, onEdit, onChanged }: { doc: Row; clientName: (id: unknown) => string; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Row>(doc)
  useEffect(() => { fin.document(doc.id).then(setD).catch(() => {}) }, [doc.id])
  const act = async (fn: () => Promise<any>, msg: string) => { try { await fn(); notify('ok', msg); onChanged() } catch (e) { notify('error', (e as Error).message) } }
  const nextType = d.doc_type === 'quotation' ? 'invoice' : d.doc_type === 'invoice' ? 'tax_invoice' : null

  return (
    <Modal title={`${d.doc_number}`} onClose={onClose} wide>
      <div className="fin-docview">
        <div className="fin-docview-meta">
          <span><Badge v={d.status} /></span>
          <span className="cp-dim">{TH[d.doc_type] ?? d.doc_type} · {clientName(d.client_id)} · {ymd(d.issue_date)}{d.due_date ? ` → ${ymd(d.due_date)}` : ''}</span>
        </div>
        <table className="cp-table fin-itemtbl">
          <thead><tr><th>#</th><th>รายการ</th><th>จำนวน</th><th>หน่วย</th><th>ราคา/หน่วย</th><th>จำนวนเงิน</th></tr></thead>
          <tbody>{(d.items ?? []).map((it: Row, i: number) => (
            <tr key={i}><td>{i + 1}</td><td style={{ whiteSpace: 'pre-line' }}>{it.description}</td><td>{it.quantity}</td><td>{it.unit}</td><td className="cp-mono">{baht(it.unit_price)}</td><td className="cp-mono">{baht(it.amount)}</td></tr>
          ))}</tbody>
        </table>
        <div className="fin-totals">
          <div><span>ยอดรวม</span><b>{baht(d.subtotal)}</b></div>
          {d.discount_amount > 0 && <div><span>ส่วนลด ({d.discount_percent}%)</span><b>-{baht(d.discount_amount)}</b></div>}
          <div><span>VAT ({d.tax_rate}%)</span><b>{baht(d.tax_amount)}</b></div>
          <div><span>รวมทั้งสิ้น (รวม VAT)</span><b>{baht(d.total)}</b></div>
          {d.wht_rate > 0 && <div><span>WHT หัก ณ ที่จ่าย ({d.wht_rate}%)</span><b>-{baht(d.wht_amount)}</b></div>}
          <div className="fin-grand"><span>ยอดรับสุทธิ</span><b>{baht(d.grand_total)}</b></div>
        </div>
        {d.notes && <div className="cp-prose">{d.notes}</div>}
      </div>
      <div className="cp-dialog-foot fin-docfoot">
        <div className="fin-docfoot-l">
          <select className="tv-field" value={d.status} onChange={(e) => void act(() => fin.documentStatus(d.id, e.target.value).then(setD), 'Status updated')}>
            {DOC_STATUS.filter((s) => s !== 'paid' || d.doc_type === 'invoice').map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <a className="tv-btn" href={fin.pdfUrl('documents', d.id, '&copy=original&lang=th')} target="_blank" rel="noreferrer"><Icon name="download" size={14} /> PDF</a>
          <button className="tv-btn" onClick={() => void act(() => fin.duplicateDocument(d.id), 'Duplicated')}><Icon name="archive" size={13} /> Duplicate</button>
          {nextType && <button className="tv-btn" onClick={() => void act(() => fin.convertDocument(d.id, nextType), `Converted to ${nextType}`)}><Icon name="git-branch" size={13} /> Convert</button>}
        </div>
        <div className="fin-docfoot-r">
          <button className="tv-btn cp-sel-del" onClick={() => void confirmDialog({ title: `Delete ${d.doc_number}?`, danger: true, confirmLabel: 'Delete' }).then((ok) => { if (ok) void act(() => fin.deleteDocument(d.id), 'Deleted') })}><Icon name="trash" size={14} /></button>
          <button className="tv-btn tv-btn--primary" onClick={onEdit}><Icon name="pencil" size={13} /> Edit</button>
        </div>
      </div>
    </Modal>
  )
}

function DocForm({ initial, clients, projects, onClose, onSaved }: { initial: Row | null; clients: Row[]; projects: Row[]; onClose: () => void; onSaved: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const plus30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState<Row>(() => ({
    doc_type: initial?.doc_type ?? 'invoice',
    doc_number: initial?.doc_number ?? '',
    client_id: initial?.client_id ?? '',
    project_id: initial?.project_id ?? '',
    issue_date: ymd(initial?.issue_date) || today,
    due_date: ymd(initial?.due_date) || plus30,
    discount_percent: initial?.discount_percent ?? 0,
    tax_rate: initial?.tax_rate ?? 7,
    wht_rate: initial?.wht_rate ?? 0,
    issued_by: initial?.issued_by ?? '',
    notes: initial?.notes ?? '',
    show_approver: initial ? !!initial.show_approver : true,
    show_client_name: initial ? !!initial.show_client_name : true,
    auto_signed: initial ? !!initial.auto_signed : false,
    items: initial?.items?.length ? initial.items.map((i: Row) => ({ ...i })) : [{ description: '', quantity: 1, unit: 'unit', unit_price: 0 }],
  }))
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }))
  const setItem = (i: number, k: string, v: unknown) => setF((p) => ({ ...p, items: p.items.map((it: Row, j: number) => (j === i ? { ...it, [k]: v } : it)) }))
  const addItem = () => setF((p) => ({ ...p, items: [...p.items, { description: '', quantity: 1, unit: 'unit', unit_price: 0 }] }))
  const delItem = (i: number) => setF((p) => ({ ...p, items: p.items.length > 1 ? p.items.filter((_: Row, j: number) => j !== i) : p.items }))
  const t = calc(f.items, Number(f.discount_percent) || 0, Number(f.tax_rate) || 0, Number(f.wht_rate) || 0)

  const save = async () => {
    if (!f.client_id) { notify('warn', 'Select a client'); return }
    setBusy(true)
    try {
      const body = { ...f, items: f.items, project_id: f.project_id || null }
      if (initial?.id) await fin.updateDocument(initial.id, body)
      else await fin.createDocument(body)
      notify('ok', initial?.id ? 'Saved' : 'Document created')
      onSaved()
    } catch (e) { notify('error', (e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Modal title={`${initial?.id ? 'Edit' : 'New'} Document`} onClose={onClose} wide>
      <div className="cp-form-grid">
        <div className="cp-field"><label className="cp-field-label">Type</label>
          <select className="tv-field cp-input" value={f.doc_type} onChange={(e) => set('doc_type', e.target.value)}>{DOC_TYPES.map((d) => <option key={d.key} value={d.key}>{d.singular}</option>)}</select></div>
        <div className="cp-field"><label className="cp-field-label">Client</label>
          <select className="tv-field cp-input" value={String(f.client_id)} onChange={(e) => set('client_id', e.target.value)}><option value="">—</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="cp-field"><label className="cp-field-label">Project</label>
          <select className="tv-field cp-input" value={String(f.project_id)} onChange={(e) => set('project_id', e.target.value)}><option value="">— ไม่ระบุ —</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        {initial?.id && <div className="cp-field"><label className="cp-field-label">Doc number</label><input className="tv-field cp-input" value={f.doc_number} onChange={(e) => set('doc_number', e.target.value)} /></div>}
        <div className="cp-field"><label className="cp-field-label">Issue date</label><input type="date" className="tv-field cp-input" value={f.issue_date} onChange={(e) => set('issue_date', e.target.value)} /></div>
        <div className="cp-field"><label className="cp-field-label">Due date</label><input type="date" className="tv-field cp-input" value={f.due_date} onChange={(e) => set('due_date', e.target.value)} /></div>
        <div className="cp-field"><label className="cp-field-label">Discount %</label><input type="number" className="tv-field cp-input" value={f.discount_percent} onChange={(e) => set('discount_percent', e.target.value)} /></div>
        <div className="cp-field"><label className="cp-field-label">VAT %</label><input type="number" className="tv-field cp-input" value={f.tax_rate} onChange={(e) => set('tax_rate', e.target.value)} /></div>
        <div className="cp-field"><label className="cp-field-label">WHT %</label><input type="number" className="tv-field cp-input" value={f.wht_rate} onChange={(e) => set('wht_rate', e.target.value)} /></div>
        <div className="cp-field"><label className="cp-field-label">Issued by</label><input className="tv-field cp-input" value={f.issued_by} onChange={(e) => set('issued_by', e.target.value)} /></div>
      </div>

      <div className="fin-items">
        <div className="cp-panel-title"><Icon name="list" size={14} /> <span>Items</span></div>
        {f.items.map((it: Row, i: number) => (
          <div className="fin-itemrow" key={i}>
            <textarea className="tv-field" rows={1} placeholder="รายละเอียด…" value={it.description} onChange={(e) => setItem(i, 'description', e.target.value)} />
            <input className="tv-field fin-iq" type="number" placeholder="Qty" value={it.quantity} onChange={(e) => setItem(i, 'quantity', e.target.value)} />
            <input className="tv-field fin-iu" placeholder="unit" value={it.unit} onChange={(e) => setItem(i, 'unit', e.target.value)} />
            <input className="tv-field fin-ip" type="number" placeholder="Price" value={it.unit_price} onChange={(e) => setItem(i, 'unit_price', e.target.value)} />
            <span className="fin-ia cp-mono">{baht((Number(it.quantity) || 0) * (Number(it.unit_price) || 0))}</span>
            <button className="cp-rowbtn is-danger" onClick={() => delItem(i)} aria-label="Remove"><Icon name="close" size={13} /></button>
          </div>
        ))}
        <button className="tv-btn" onClick={addItem}><Icon name="plus" size={13} /> Add item</button>
      </div>

      <div className="cp-field cp-field--full"><label className="cp-field-label">Notes</label><textarea className="tv-field cp-input" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></div>
      <div className="fin-flags">
        <label className="cp-check"><input type="checkbox" checked={f.show_approver} onChange={(e) => set('show_approver', e.target.checked)} /><span>Show approver</span></label>
        <label className="cp-check"><input type="checkbox" checked={f.show_client_name} onChange={(e) => set('show_client_name', e.target.checked)} /><span>Show client name</span></label>
        <label className="cp-check"><input type="checkbox" checked={f.auto_signed} onChange={(e) => set('auto_signed', e.target.checked)} /><span>Auto sign + stamp</span></label>
      </div>

      <div className="fin-totals fin-totals-form">
        <div><span>ยอดรวม</span><b>{baht(t.subtotal)}</b></div>
        {t.discount > 0 && <div><span>ส่วนลด</span><b>-{baht(t.discount)}</b></div>}
        <div><span>VAT</span><b>{baht(t.tax)}</b></div>
        {t.wht > 0 && <div><span>WHT</span><b>-{baht(t.wht)}</b></div>}
        <div className="fin-grand"><span>ยอดรับสุทธิ</span><b>{baht(t.grand)}</b></div>
      </div>

      <div className="cp-dialog-foot">
        <button className="tv-btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className={clsx('tv-btn tv-btn--primary')} onClick={() => void save()} disabled={busy}>{busy ? <Icon name="refresh" size={14} className="spin" /> : <Icon name="check" size={14} />} {initial?.id ? 'Save' : 'Create'}</button>
      </div>
    </Modal>
  )
}
