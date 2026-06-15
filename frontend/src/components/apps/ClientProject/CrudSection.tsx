import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import type { CpRecord } from '@/types'
import * as api from '@/lib/restClient'
import { notify } from '@/store/notificationStore'
import { confirmDialog } from '@/store/dialogStore'
import { Icon } from '@/components/common/Icon'
import { useCp } from './CpContext'
import { CpTable } from './CpTable'
import { CpForm } from './CpForm'
import type { CpSpec } from './specs'

interface CrudSectionProps {
  spec: CpSpec
  /** when set, only show rows matching this filter (e.g. {project_id}) */
  fixedFilter?: Record<string, string>
}

// undefined = form closed, null = creating, record = editing
type Editing = CpRecord | null | undefined

export function CrudSection({ spec, fixedFilter }: CrudSectionProps) {
  const { refreshRelations } = useCp()
  const [rows, setRows] = useState<CpRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Editing>(undefined)

  const filterKey = JSON.stringify(fixedFilter ?? null)
  const load = useCallback(() => {
    setLoading(true)
    api
      .cpList(spec.entity, fixedFilter)
      .then((r) => setRows(r.items))
      .catch((e) => notify('error', e instanceof api.ApiError ? e.message : 'Could not load'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.entity, filterKey])

  useEffect(() => load(), [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      spec.columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(q)),
    )
  }, [rows, query, spec.columns])

  const onDelete = useCallback(
    async (rec: CpRecord) => {
      const label = String(rec[spec.titleField] ?? 'this item')
      const ok = await confirmDialog({
        title: `Delete “${label}”?`,
        message: 'This record will be permanently removed.',
        confirmLabel: 'Delete',
        danger: true,
      })
      if (!ok) return
      try {
        await api.cpDelete(spec.entity, String(rec.id))
        notify('ok', `Deleted “${label}”`)
        if (spec.entity === 'clients' || spec.entity === 'projects') refreshRelations()
        load()
      } catch (e) {
        notify('error', e instanceof api.ApiError ? e.message : 'Could not delete')
      }
    },
    [spec.entity, spec.titleField, load, refreshRelations],
  )

  return (
    <div className="cp-section">
      <div className="cp-section-head">
        <div className="cp-section-title">
          <Icon name={spec.icon as never} size={18} />
          <span>{spec.title}</span>
          <span className="cp-count">{filtered.length}</span>
        </div>
        <div className="cp-section-actions">
          <div className="cp-search">
            <Icon name="search" size={13} />
            <input
              value={query}
              placeholder="Search"
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button className="tv-btn" onClick={load} title="Refresh" aria-label="Refresh">
            <Icon name="refresh" size={14} className={loading ? 'spin' : undefined} />
          </button>
          <button className="tv-btn tv-btn--primary" onClick={() => setEditing(null)}>
            <Icon name="plus" size={14} />
            New {spec.singular}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="cp-empty">
          <Icon name="refresh" size={26} className="spin" />
        </div>
      ) : (
        <CpTable spec={spec} rows={filtered} onEdit={(r) => setEditing(r)} onDelete={(r) => void onDelete(r)} />
      )}

      <AnimatePresence>
        {editing !== undefined && (
          <CpForm
            spec={spec}
            initial={editing ?? { ...(fixedFilter ?? {}) }}
            onClose={() => setEditing(undefined)}
            onSaved={() => load()}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
