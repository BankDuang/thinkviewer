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
import { ProgressRing } from './Charts'
import { usePoll } from './usePoll'
import type { CpSpec } from './specs'

interface CrudSectionProps {
  spec: CpSpec
  /** when set, only show rows matching this filter (e.g. {project_id}) */
  fixedFilter?: Record<string, string>
  /** notified after any create/update/delete/toggle so parents can refresh counts */
  onChange?: () => void
}

// undefined = form closed, null = creating, record = editing
type Editing = CpRecord | null | undefined

export function CrudSection({ spec, fixedFilter, onChange }: CrudSectionProps) {
  const { refreshRelations } = useCp()
  const [rows, setRows] = useState<CpRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Editing>(undefined)

  const filterKey = JSON.stringify(fixedFilter ?? null)
  const load = useCallback(
    (silent = false) => {
      if (!silent) setLoading(true)
      api
        .cpList(spec.entity, fixedFilter)
        // on a silent background refresh, only swap rows when they actually
        // changed → unchanged polls cause zero re-render (no flicker)
        .then((r) => setRows((prev) => (silent && JSON.stringify(prev) === JSON.stringify(r.items) ? prev : r.items)))
        .catch((e) => {
          if (!silent) notify('error', e instanceof api.ApiError ? e.message : 'Could not load')
        })
        .finally(() => {
          if (!silent) setLoading(false)
        })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [spec.entity, filterKey],
  )

  useEffect(() => load(), [load])
  usePoll(() => load(true)) // flicker-free background sync (multi-user)

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
        load(true) // silent → keeps scroll/sort position (no jump to top)
        onChange?.()
      } catch (e) {
        notify('error', e instanceof api.ApiError ? e.message : 'Could not delete')
      }
    },
    [spec.entity, spec.titleField, load, refreshRelations, onChange],
  )

  const onToggle = useCallback(
    async (rec: CpRecord, col: { key: string }, next: string) => {
      setRows((prev) => prev.map((r) => (r.id === rec.id ? { ...r, [col.key]: next } : r)))
      try {
        await api.cpUpdate(spec.entity, String(rec.id), { [col.key]: next })
        onChange?.()
      } catch (e) {
        notify('error', e instanceof api.ApiError ? e.message : 'Could not update')
        load() // revert optimistic change
      }
    },
    [spec.entity, load, onChange],
  )

  // completion % over ALL rows of the section (not the search-filtered view)
  const prog = useMemo(() => {
    if (!spec.progress || rows.length === 0) return null
    const done = rows.filter(spec.progress.done).length
    return { done, total: rows.length, pct: Math.round((done / rows.length) * 100), label: spec.progress.label }
  }, [rows, spec.progress])

  return (
    <div className="cp-section">
      <div className="cp-section-head">
        <div className="cp-section-title">
          <Icon name={spec.icon as never} size={18} />
          <span>{spec.title}</span>
          <span className="cp-count">{filtered.length}</span>
          {prog && (
            <span className="cp-section-progress" title={`${prog.done}/${prog.total} ${prog.label}`}>
              <ProgressRing value={prog.pct} size={30} stroke={4} color={prog.pct >= 100 ? '#30d158' : '#0a84ff'} />
              <span className="cp-section-progress-text">
                {prog.pct}% {prog.label}
              </span>
            </span>
          )}
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
          <button className="tv-btn" onClick={() => load()} title="Refresh" aria-label="Refresh">
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
        <CpTable
          spec={spec}
          rows={filtered}
          hideProject={!!fixedFilter?.project_id}
          onEdit={(r) => setEditing(r)}
          onDelete={(r) => void onDelete(r)}
          onToggle={(rec, col, next) => void onToggle(rec, col, next)}
        />
      )}

      <AnimatePresence>
        {editing !== undefined && (
          <CpForm
            spec={spec}
            initial={editing ?? { ...(fixedFilter ?? {}) }}
            onClose={() => setEditing(undefined)}
            onSaved={() => {
              load(true) // silent → row stays in place after edit (no jump to top)
              onChange?.()
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
