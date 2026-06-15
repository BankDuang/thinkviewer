import { useState } from 'react'
import { motion } from 'framer-motion'
import clsx from 'clsx'
import type { CpRecord } from '@/types'
import * as api from '@/lib/restClient'
import { notify } from '@/store/notificationStore'
import { Icon } from '@/components/common/Icon'
import { useCp } from './CpContext'
import { cpBool, cpLabel } from './cpFormat'
import { ImageField } from './ImageField'
import { FixVersions } from './FixVersions'
import type { CpField, CpSpec } from './specs'

interface CpFormProps {
  spec: CpSpec
  initial?: CpRecord | null // null/undefined = create
  onClose: () => void
  onSaved: (rec: CpRecord) => void
}

function todayStr(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function CpForm({ spec, initial, onClose, onSaved }: CpFormProps) {
  const { clients, projects, servers, refreshRelations } = useCp()
  const [form, setForm] = useState<CpRecord>(() => {
    const base: CpRecord = { ...(spec.defaults ?? {}) }
    // prefill "today" defaults only when creating a new record
    if (!initial?.id) {
      for (const f of spec.fields) {
        if (f.defaultToday && base[f.key] == null) base[f.key] = todayStr()
      }
    }
    return { ...base, ...(initial ?? {}) }
  })
  const [busy, setBusy] = useState(false)
  const editing = !!initial?.id

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  async function save() {
    const titleVal = String(form[spec.titleField] ?? '').trim()
    if (!titleVal) {
      notify('warn', `Enter a ${spec.singular.toLowerCase()} name`)
      return
    }
    setBusy(true)
    try {
      const rec = editing
        ? await api.cpUpdate(spec.entity, String(initial!.id), form)
        : await api.cpCreate(spec.entity, form)
      if (spec.entity === 'clients' || spec.entity === 'projects') refreshRelations()
      onSaved(rec)
      onClose()
    } catch (e) {
      notify('error', e instanceof api.ApiError ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  function field(f: CpField) {
    const type = f.type ?? 'text'
    const val = form[f.key]
    const common = { id: `cp-${f.key}`, className: 'tv-field cp-input', disabled: busy }
    if (type === 'textarea')
      return (
        <textarea
          {...common}
          rows={3}
          value={String(val ?? '')}
          onChange={(e) => set(f.key, e.target.value)}
          placeholder={f.placeholder}
        />
      )
    if (type === 'checkbox')
      return (
        <label className="cp-check">
          <input
            type="checkbox"
            checked={cpBool(val)}
            disabled={busy}
            onChange={(e) => set(f.key, e.target.checked ? '1' : '0')}
          />
          <span>{f.label}</span>
        </label>
      )
    if (type === 'select')
      return (
        <select {...common} value={String(val ?? '')} onChange={(e) => set(f.key, e.target.value)}>
          <option value="">—</option>
          {(f.options ?? []).map((o) => (
            <option key={o} value={o}>
              {cpLabel(o)}
            </option>
          ))}
        </select>
      )
    if (type === 'relation') {
      const list = f.relation === 'clients' ? clients : projects
      return (
        <select {...common} value={String(val ?? '')} onChange={(e) => set(f.key, e.target.value)}>
          <option value="">—</option>
          {list.map((r) => (
            <option key={String(r.id)} value={String(r.id)}>
              {String(r.name ?? r.title ?? r.id)}
            </option>
          ))}
        </select>
      )
    }
    if (type === 'server')
      return (
        <select {...common} value={String(val ?? '')} onChange={(e) => set(f.key, e.target.value)}>
          <option value="">— not linked —</option>
          {servers.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )
    if (type === 'images')
      return (
        <ImageField
          value={Array.isArray(val) ? (val as string[]) : []}
          onChange={(v) => set(f.key, v)}
          projectId={String(form.project_id || '')}
          issueId={initial?.id ? String(initial.id) : undefined}
        />
      )
    if (type === 'versions')
      return (
        <FixVersions
          value={Array.isArray(val) ? val : []}
          onChange={(v) => set(f.key, v)}
          projectId={String(form.project_id || '')}
          issueId={initial?.id ? String(initial.id) : undefined}
        />
      )
    if (type === 'tags') {
      const arr: string[] = Array.isArray(val) ? val : val ? String(val).split(',') : []
      return (
        <input
          {...common}
          value={arr.join(', ')}
          placeholder={f.placeholder}
          onChange={(e) =>
            set(
              f.key,
              e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
        />
      )
    }
    return (
      <input
        {...common}
        type={type === 'number' || type === 'money' ? 'number' : type === 'date' ? 'date' : 'text'}
        value={String(val ?? '')}
        placeholder={f.placeholder}
        spellCheck={false}
        onChange={(e) => set(f.key, e.target.value)}
      />
    )
  }

  return (
    <motion.div
      className="cp-overlay"
      onMouseDown={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14 }}
    >
      <motion.div
        className="cp-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="cp-dialog-head">
          <span className="cp-dialog-title">
            <Icon name={spec.icon as never} size={15} />
            {editing ? `Edit ${spec.singular}` : `New ${spec.singular}`}
          </span>
          <button className="cp-iconbtn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="cp-form-grid">
          {spec.fields.map((f) =>
            f.type === 'checkbox' ? (
              <div key={f.key} className={clsx('cp-field', f.full && 'cp-field--full')}>
                {field(f)}
              </div>
            ) : (
              <div key={f.key} className={clsx('cp-field', f.full && 'cp-field--full')}>
                <label className="cp-field-label" htmlFor={`cp-${f.key}`}>
                  {f.label}
                </label>
                {field(f)}
              </div>
            ),
          )}
        </div>
        <div className="cp-dialog-foot">
          <button className="tv-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="tv-btn tv-btn--primary" onClick={() => void save()} disabled={busy}>
            {busy ? <Icon name="refresh" size={14} className="spin" /> : <Icon name="check" size={14} />}
            {editing ? 'Save' : 'Create'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
