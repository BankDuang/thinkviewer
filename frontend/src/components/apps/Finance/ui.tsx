import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import clsx from 'clsx'
import { Icon, type IconName } from '@/components/common/Icon'
import { notify } from '@/store/notificationStore'
import { confirmDialog } from '@/store/dialogStore'
import type { Row } from './api'

export const TONE: Record<string, string> = {
  draft: 'is-neutral', sent: 'is-warn', paid: 'is-ok', cancelled: 'is-bad',
  active: 'is-ok', completed: 'is-ok', on_hold: 'is-warn',
  negotiation: 'is-warn', signed: 'is-ok', in_progress: 'is-warn', delivered: 'is-ok',
  pending: 'is-warn', reimbursed: 'is-ok', company_paid: 'is-neutral', owner_paid: 'is-neutral', not_required: 'is-neutral',
  pnd3: 'is-neutral', pnd53: 'is-neutral',
}
export const Badge = ({ v }: { v: unknown }) =>
  v ? <span className={clsx('cp-badge', TONE[String(v)] ?? 'is-neutral')}>{String(v).replace(/_/g, ' ')}</span> : <span className="cp-dim">—</span>

export function useRows(load: () => Promise<Row[]>, deps: unknown[] = []) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const reload = useCallback((silent = false) => {
    if (!silent) setLoading(true)
    load()
      .then((r) => setRows((prev) => (silent && JSON.stringify(prev) === JSON.stringify(r) ? prev : r)))
      .catch((e) => !silent && notify('error', e.message))
      .finally(() => !silent && setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => reload(), [reload])
  useEffect(() => {
    const id = window.setInterval(() => document.visibilityState === 'visible' && reload(true), 7000)
    return () => window.clearInterval(id)
  }, [reload])
  return { rows, loading, reload }
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <motion.div className="cp-overlay" onMouseDown={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
      <motion.div
        className={clsx('cp-dialog', wide && 'fin-dialog-wide')}
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="cp-dialog-head">
          <span className="cp-dialog-title">{title}</span>
          <button className="cp-iconbtn" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  )
}

export interface FieldDef {
  key: string
  label: string
  type?: 'text' | 'textarea' | 'number' | 'money' | 'date' | 'select' | 'checkbox'
  options?: { value: string | number; label: string }[]
  full?: boolean
  placeholder?: string
}

export function Field({ f, value, onChange }: { f: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const common = { id: `fin-${f.key}`, className: 'tv-field cp-input' }
  const t = f.type ?? 'text'
  if (t === 'checkbox')
    return (
      <label className="cp-check">
        <input type="checkbox" checked={value === true || value === 1 || value === '1'} onChange={(e) => onChange(e.target.checked)} />
        <span>{f.label}</span>
      </label>
    )
  if (t === 'textarea')
    return <textarea {...common} rows={3} value={String(value ?? '')} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />
  if (t === 'select')
    return (
      <select {...common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
  return (
    <input
      {...common}
      type={t === 'number' || t === 'money' ? 'number' : t === 'date' ? 'date' : 'text'}
      value={String(value ?? '')}
      placeholder={f.placeholder}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export function FormGrid({ fields, form, set }: { fields: FieldDef[]; form: Row; set: (k: string, v: unknown) => void }) {
  return (
    <div className="cp-form-grid">
      {fields.map((f) =>
        f.type === 'checkbox' ? (
          <div key={f.key} className={clsx('cp-field', f.full && 'cp-field--full')}>
            <Field f={f} value={form[f.key]} onChange={(v) => set(f.key, v)} />
          </div>
        ) : (
          <div key={f.key} className={clsx('cp-field', f.full && 'cp-field--full')}>
            <label className="cp-field-label" htmlFor={`fin-${f.key}`}>{f.label}</label>
            <Field f={f} value={form[f.key]} onChange={(v) => set(f.key, v)} />
          </div>
        ),
      )}
    </div>
  )
}

export interface Col {
  key: string
  label: string
  fmt?: (v: unknown, row: Row) => ReactNode
}

export interface CrudConfig {
  title: string
  singular: string
  icon: IconName
  load: () => Promise<Row[]>
  create: (b: Row) => Promise<any>
  update: (id: number, b: Row) => Promise<any>
  remove: (id: number) => Promise<any>
  columns: Col[]
  fields: FieldDef[]
  defaults?: Row
  titleField?: string
  /** extra UI inside the form (e.g. computed preview / sub-lists) */
  extraForm?: (form: Row, set: (k: string, v: unknown) => void) => ReactNode
  /** transform the form before sending to create/update */
  prepare?: (form: Row) => Row
  /** extra header action(s); receives a fn that opens the create form prefilled */
  headerExtra?: (openWith: (prefill: Row) => void) => ReactNode
}

export function CrudSection({ cfg }: { cfg: CrudConfig }) {
  const { rows, loading, reload } = useRows(cfg.load, [cfg.title])
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Row | null | undefined>(undefined)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => cfg.columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(q)))
  }, [rows, query, cfg.columns])

  const del = async (r: Row) => {
    const label = String(r[cfg.titleField ?? 'name'] ?? 'this item')
    if (!(await confirmDialog({ title: `Delete “${label}”?`, confirmLabel: 'Delete', danger: true }))) return
    try {
      await cfg.remove(r.id)
      notify('ok', `Deleted “${label}”`)
      reload(true)
    } catch (e) {
      notify('error', (e as Error).message)
    }
  }

  return (
    <div className="cp-section">
      <div className="cp-section-head">
        <div className="cp-section-title">
          <Icon name={cfg.icon} size={18} />
          <span>{cfg.title}</span>
          <span className="cp-count">{filtered.length}</span>
        </div>
        <div className="cp-section-actions">
          <div className="cp-search">
            <Icon name="search" size={13} />
            <input value={query} placeholder="Search" spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <button className="tv-btn" onClick={() => reload()} aria-label="Refresh"><Icon name="refresh" size={14} className={loading ? 'spin' : undefined} /></button>
          {cfg.headerExtra?.((prefill) => setEditing(prefill))}
          <button className="tv-btn tv-btn--primary" onClick={() => setEditing(null)}><Icon name="plus" size={14} /> New {cfg.singular}</button>
        </div>
      </div>

      {loading ? (
        <div className="cp-empty"><Icon name="refresh" size={26} className="spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="cp-empty"><Icon name={cfg.icon} size={32} strokeWidth={1.3} /><p>No {cfg.title.toLowerCase()} yet</p></div>
      ) : (
        <div className="cp-table-wrap">
          <table className="cp-table">
            <thead><tr>{cfg.columns.map((c, i) => <th key={i}>{c.label}</th>)}<th className="cp-col-actions" /></tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="cp-row-click" onClick={() => setEditing(r)}>
                  {cfg.columns.map((c, i) => <td key={i}>{c.fmt ? c.fmt(r[c.key], r) : r[c.key] ? <span>{String(r[c.key])}</span> : <span className="cp-dim">—</span>}</td>)}
                  <td className="cp-col-actions">
                    <button className="cp-rowbtn" onClick={(e) => { e.stopPropagation(); setEditing(r) }} aria-label="Edit"><Icon name="pencil" size={14} /></button>
                    <button className="cp-rowbtn is-danger" onClick={(e) => { e.stopPropagation(); void del(r) }} aria-label="Delete"><Icon name="trash" size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing !== undefined && (
        <CrudForm cfg={cfg} initial={editing} onClose={() => setEditing(undefined)} onSaved={() => { reload(true); setEditing(undefined) }} />
      )}
    </div>
  )
}

function CrudForm({ cfg, initial, onClose, onSaved }: { cfg: CrudConfig; initial: Row | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Row>(() => ({ ...(cfg.defaults ?? {}), ...(initial ?? {}) }))
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))
  const editing = !!initial?.id
  const save = async () => {
    setBusy(true)
    try {
      const body = cfg.prepare ? cfg.prepare(form) : form
      if (editing) await cfg.update(initial!.id, body)
      else await cfg.create(body)
      notify('ok', editing ? 'Saved' : `Created ${cfg.singular.toLowerCase()}`)
      onSaved()
    } catch (e) {
      notify('error', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={`${editing ? 'Edit' : 'New'} ${cfg.singular}`} onClose={onClose}>
      <FormGrid fields={cfg.fields} form={form} set={set} />
      {cfg.extraForm?.(form, set)}
      <div className="cp-dialog-foot">
        <button className="tv-btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="tv-btn tv-btn--primary" onClick={() => void save()} disabled={busy}>
          {busy ? <Icon name="refresh" size={14} className="spin" /> : <Icon name="check" size={14} />} {editing ? 'Save' : 'Create'}
        </button>
      </div>
    </Modal>
  )
}
