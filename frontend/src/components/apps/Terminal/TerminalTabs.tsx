import { useState, type KeyboardEvent } from 'react'
import clsx from 'clsx'
import type { TermSessionMeta } from '@/types'
import { Icon } from '@/components/common/Icon'

interface TerminalTabsProps {
  order: string[]
  sessions: Record<string, TermSessionMeta>
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onClose: (id: string) => void
  onRename: (id: string, name: string) => void
  onPasteImage: () => void
}

export function TerminalTabs({
  order,
  sessions,
  activeId,
  onSelect,
  onCreate,
  onClose,
  onRename,
  onPasteImage,
}: TerminalTabsProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const labelFor = (id: string, idx: number) => {
    const name = sessions[id]?.name?.trim()
    return name || `Terminal ${idx + 1}`
  }

  const startEdit = (id: string) => {
    setEditingId(id)
    setDraft(sessions[id]?.name ?? '')
  }

  const commit = (id: string) => {
    const next = draft.trim()
    const current = (sessions[id]?.name ?? '').trim()
    if (next !== current) onRename(id, next)
    setEditingId(null)
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>, id: string) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit(id)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setEditingId(null)
    }
  }

  return (
    <div className="term-tabbar">
      <div className="term-tabs" role="tablist">
        {order.map((id, idx) => {
          const editing = editingId === id
          const meta = sessions[id]
          const alive = meta ? meta.alive : true
          return (
            <div
              key={id}
              role="tab"
              aria-selected={id === activeId}
              className={clsx('term-tab', id === activeId && 'term-tab--active')}
              onClick={() => {
                if (!editing) onSelect(id)
              }}
              onDoubleClick={() => startEdit(id)}
              title={editing ? undefined : 'Double-click to rename'}
            >
              <span className={clsx('term-tab-dot', !alive && 'term-tab-dot--dead')} />
              {editing ? (
                <input
                  className="term-tab-input"
                  autoFocus
                  value={draft}
                  placeholder={labelFor(id, idx)}
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => onKey(e, id)}
                  onBlur={() => commit(id)}
                />
              ) : (
                <span className="term-tab-label">{labelFor(id, idx)}</span>
              )}
              <button
                className="term-tab-close"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(id)
                }}
                aria-label="Close terminal"
                tabIndex={-1}
              >
                <Icon name="close" size={12} strokeWidth={2} />
              </button>
            </div>
          )
        })}
      </div>

      <div className="term-tab-actions">
        <button
          className="term-iconbtn"
          onClick={onPasteImage}
          title="Paste image from clipboard"
          aria-label="Paste image from clipboard"
        >
          <Icon name="image" size={16} />
        </button>
        <button
          className="term-iconbtn term-newtab"
          onClick={onCreate}
          title="New terminal"
          aria-label="New terminal"
        >
          <Icon name="plus" size={17} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
