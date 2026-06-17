import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { CpRecord } from '@/types'
import * as api from '@/lib/restClient'
import { notify } from '@/store/notificationStore'
import { confirmDialog } from '@/store/dialogStore'
import { Icon } from '@/components/common/Icon'
import { cpBadgeClass, cpLabel } from './cpFormat'
import { usePoll } from './usePoll'

interface ChecklistItem {
  text: string
  done: boolean
}

function itemsOf(r: CpRecord): ChecklistItem[] {
  return Array.isArray(r.checklist) ? (r.checklist as ChecklistItem[]) : []
}

export function RequirementsChecklist({
  projectId,
  onChange,
}: {
  projectId: string
  onChange?: () => void
}) {
  const [reqs, setReqs] = useState<CpRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [newFeature, setNewFeature] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [itemText, setItemText] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)

  const reqSig = useRef('')
  const load = useCallback(
    (silent = false) => {
      if (!silent) setLoading(true)
      api
        .cpList('requirements', { project_id: projectId })
        .then((r) => {
          const sig = JSON.stringify(r.items)
          if (silent && sig === reqSig.current) return // unchanged → no re-render
          reqSig.current = sig
          setReqs(r.items)
        })
        .catch(() => {})
        .finally(() => {
          if (!silent) setLoading(false)
        })
    },
    [projectId],
  )
  useEffect(() => load(), [load])
  usePoll(() => load(true)) // flicker-free multi-user sync

  const after = () => {
    load(true) // refresh silently after a local mutation (no spinner flash)
    onChange?.()
  }

  async function addReq() {
    const f = newFeature.trim()
    if (!f) return
    try {
      await api.cpCreate('requirements', {
        project_id: projectId,
        feature: f,
        status: 'proposed',
        in_scope: '1',
        priority: 'medium',
        order_idx: String(reqs.length),
      })
      setNewFeature('')
      after()
    } catch (e) {
      notify('error', e instanceof api.ApiError ? e.message : 'Could not add')
    }
  }

  async function toggleReq(r: CpRecord) {
    const done = String(r.status) === 'done'
    await api.cpUpdate('requirements', String(r.id), { status: done ? 'proposed' : 'done' })
    after()
  }

  async function delReq(r: CpRecord) {
    if (!(await confirmDialog({ title: `Delete “${r.feature}”?`, confirmLabel: 'Delete', danger: true }))) return
    await api.cpDelete('requirements', String(r.id))
    after()
  }

  async function saveItems(r: CpRecord, items: ChecklistItem[]) {
    setReqs((prev) => prev.map((x) => (x.id === r.id ? { ...x, checklist: items } : x)))
    await api.cpUpdate('requirements', String(r.id), { checklist: items })
  }

  // --- drag to reorder: rewrite order_idx of the affected rows ---------------
  async function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) {
      setDragId(null)
      return
    }
    const arr = [...reqs]
    const from = arr.findIndex((r) => String(r.id) === dragId)
    const to = arr.findIndex((r) => String(r.id) === targetId)
    if (from < 0 || to < 0) return setDragId(null)
    const [moved] = arr.splice(from, 1)
    arr.splice(to, 0, moved)
    setReqs(arr) // optimistic
    setDragId(null)
    try {
      await Promise.all(
        arr.map((r, i) =>
          String(r.order_idx ?? '') === String(i)
            ? Promise.resolve()
            : api.cpUpdate('requirements', String(r.id), { order_idx: String(i) }),
        ),
      )
    } catch {
      notify('error', 'Could not save the new order')
    }
    load(true)
  }

  const total = reqs.length
  const done = reqs.filter((r) => String(r.status) === 'done').length
  const pct = total ? Math.round((done / total) * 100) : 0

  return (
    <div className="cp-req">
      <div className="cp-req-progress">
        <div className="cp-req-bar">
          <div className="cp-req-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="cp-req-pct">
          {done}/{total} done · {pct}%
        </span>
      </div>

      <div className="cp-req-add">
        <input
          className="tv-field"
          value={newFeature}
          placeholder="Add a requirement / feature…"
          spellCheck={false}
          onChange={(e) => setNewFeature(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void addReq()}
        />
        <button className="tv-btn tv-btn--primary" onClick={() => void addReq()}>
          <Icon name="plus" size={14} /> Add
        </button>
      </div>

      {loading ? (
        <div className="cp-empty">
          <Icon name="refresh" size={24} className="spin" />
        </div>
      ) : reqs.length === 0 ? (
        <div className="cp-empty">
          <Icon name="list" size={30} strokeWidth={1.3} />
          <p>No requirements yet</p>
        </div>
      ) : (
        <div className="cp-req-list">
          {reqs.map((r) => {
            const items = itemsOf(r)
            const idone = items.filter((i) => i.done).length
            const isOpen = expanded === String(r.id)
            const rdone = String(r.status) === 'done'
            return (
              <div
                className={clsx('cp-req-item', rdone && 'is-done', dragId === String(r.id) && 'is-drag')}
                key={String(r.id)}
                draggable
                onDragStart={() => setDragId(String(r.id))}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => void onDrop(String(r.id))}
              >
                <div className="cp-req-row">
                  <span className="cp-req-grip" aria-hidden title="Drag to reorder">
                    ⠿
                  </span>
                  <button className={clsx('cp-checkbox', rdone && 'is-on')} onClick={() => void toggleReq(r)} aria-label="Toggle done">
                    {rdone && <Icon name="check" size={12} strokeWidth={3} />}
                  </button>
                  <button
                    className="cp-req-feature"
                    onClick={() => setExpanded(isOpen ? null : String(r.id))}
                    title="Click to show details"
                  >
                    {String(r.feature)}
                  </button>
                  {r.priority ? <span className={clsx('cp-badge', cpBadgeClass(r.priority))}>{cpLabel(r.priority)}</span> : null}
                  {String(r.in_scope) === '1' ? (
                    <span className="cp-chip">in scope</span>
                  ) : (
                    <span className="cp-chip is-warn">change req</span>
                  )}
                  <button className="cp-req-toggle" onClick={() => setExpanded(isOpen ? null : String(r.id))} title="Details">
                    {items.length > 0 && (
                      <span className="cp-req-count">
                        {idone}/{items.length}
                      </span>
                    )}
                    <Icon name="chevron-down" size={14} style={{ transform: isOpen ? 'rotate(180deg)' : undefined }} />
                  </button>
                  <button className="cp-rowbtn is-danger" onClick={() => void delReq(r)} aria-label="Delete">
                    <Icon name="trash" size={13} />
                  </button>
                </div>

                {isOpen && (
                  <div className="cp-req-detail">
                    {/* long, multi-line requirement detail */}
                    <textarea
                      className="tv-field cp-input"
                      rows={3}
                      defaultValue={String(r.description ?? '')}
                      placeholder="Details — describe the requirement (multi-line, write as much as you need)…"
                      onChange={(e) => setReqs((prev) => prev.map((x) => (x.id === r.id ? { ...x, description: e.target.value } : x)))}
                      onBlur={(e) => void api.cpUpdate('requirements', String(r.id), { description: e.target.value })}
                    />
                    <div className="cp-checklist">
                      {items.map((it, idx) => (
                        <div className="cp-checklist-item" key={idx}>
                          <button
                            className={clsx('cp-checkbox sm', it.done && 'is-on')}
                            onClick={() =>
                              void saveItems(
                                r,
                                items.map((x, j) => (j === idx ? { ...x, done: !x.done } : x)),
                              )
                            }
                          >
                            {it.done && <Icon name="check" size={10} strokeWidth={3} />}
                          </button>
                          <span className={clsx('cp-checklist-text', it.done && 'is-done')}>{it.text}</span>
                          <button
                            className="cp-rowbtn is-danger"
                            onClick={() => void saveItems(r, items.filter((_, j) => j !== idx))}
                            aria-label="Remove"
                          >
                            <Icon name="close" size={12} />
                          </button>
                        </div>
                      ))}
                      <div className="cp-checklist-add">
                        <input
                          className="tv-field"
                          placeholder="Add checklist item…"
                          value={isOpen ? itemText : ''}
                          spellCheck={false}
                          onChange={(e) => setItemText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && itemText.trim()) {
                              void saveItems(r, [...items, { text: itemText.trim(), done: false }])
                              setItemText('')
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
