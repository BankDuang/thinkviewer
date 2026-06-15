import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from '@/lib/restClient'
import { notify } from '@/store/notificationStore'
import { Icon } from '@/components/common/Icon'
import { cpRelDate } from '../cpFormat'
import { useCp } from '../CpContext'
import type { CpRecord } from '@/types'

/** Activity log: a project-filterable feed of notes/events with quick note entry. */
export function Timeline() {
  const { projects } = useCp()
  const [items, setItems] = useState<CpRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [projectFilter, setProjectFilter] = useState('')
  const [newMsg, setNewMsg] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    api
      .cpList('activity', projectFilter ? { project_id: projectFilter } : undefined)
      .then((r) => setItems(r.items))
      .catch((e) => notify('error', e instanceof api.ApiError ? e.message : 'Could not load activity'))
      .finally(() => setLoading(false))
  }, [projectFilter])

  useEffect(() => load(), [load])

  const projectName = useCallback(
    (id: unknown): string => {
      const key = String(id ?? '')
      if (!key) return ''
      const p = projects.find((proj) => String(proj.id) === key)
      return p ? String(p.name ?? key) : key
    },
    [projects],
  )

  const addNote = useCallback(async () => {
    const message = newMsg.trim()
    if (!message) return
    setAdding(true)
    try {
      await api.cpCreate('activity', {
        kind: 'note',
        message,
        project_id: projectFilter || '',
      })
      setNewMsg('')
      load()
    } catch (e) {
      notify('error', e instanceof api.ApiError ? e.message : 'Could not add note')
    } finally {
      setAdding(false)
    }
  }, [newMsg, projectFilter, load])

  const sorted = useMemo(
    () =>
      [...items].sort(
        (a, b) =>
          new Date(String(b.created_at ?? 0)).getTime() - new Date(String(a.created_at ?? 0)).getTime(),
      ),
    [items],
  )

  return (
    <div className="cp-section">
      <div className="cp-section-head">
        <div className="cp-section-title">
          <Icon name="signal" size={18} />
          <span>Timeline</span>
          <span className="cp-count">{items.length}</span>
        </div>
        <div className="cp-section-actions">
          <select
            className="tv-field"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={String(p.id)} value={String(p.id)}>
                {String(p.name ?? p.id)}
              </option>
            ))}
          </select>
          <button className="tv-btn" onClick={load} title="Refresh" aria-label="Refresh">
            <Icon name="refresh" size={14} className={loading ? 'spin' : undefined} />
          </button>
        </div>
      </div>

      <div className="cp-grid-2" style={{ gridTemplateColumns: '1fr auto', alignItems: 'stretch' }}>
        <input
          className="tv-field"
          value={newMsg}
          placeholder="Add a note to the timeline…"
          spellCheck={false}
          onChange={(e) => setNewMsg(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addNote()
          }}
        />
        <button
          className="tv-btn tv-btn--primary"
          onClick={() => void addNote()}
          disabled={adding || !newMsg.trim()}
        >
          <Icon name="plus" size={14} />
          Add
        </button>
      </div>

      {loading ? (
        <div className="cp-empty">
          <Icon name="refresh" size={26} className="spin" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="cp-empty">
          <Icon name="signal" size={26} />
          <span>No activity yet</span>
        </div>
      ) : (
        <div className="cp-panel">
          <div className="cp-timeline">
            {sorted.map((it) => {
              const proj = projectName(it.project_id)
              return (
                <div className="cp-tl-item" key={String(it.id)}>
                  <span className="cp-tl-dot" />
                  <div className="cp-tl-body">
                    <div className="cp-tl-msg">{String(it.message ?? it.kind ?? '—')}</div>
                    <div className="cp-tl-time">
                      {cpRelDate(it.created_at)}
                      {proj ? ` · ${proj}` : ''}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
