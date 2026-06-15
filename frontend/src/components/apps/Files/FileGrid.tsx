import { useRef } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import clsx from 'clsx'
import type { FileEntry } from '@/types'
import { formatBytes, formatDate } from '@/lib/format'
import { Icon } from '@/components/common/Icon'
import { FileIcon } from './FileIcon'

export type FileView = 'grid' | 'list'

interface FileGridProps {
  items: FileEntry[]
  view: FileView
  selected: string | null
  loading: boolean
  error: string | null
  query: string
  onSelect: (path: string | null) => void
  onOpen: (entry: FileEntry) => void
  onDelete: (entry: FileEntry) => void
  onContext: (entry: FileEntry, x: number, y: number) => void
  onRetry: () => void
}

export function FileGrid({
  items,
  view,
  selected,
  loading,
  error,
  query,
  onSelect,
  onOpen,
  onDelete,
  onContext,
  onRetry,
}: FileGridProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  const getCols = () => {
    const el = gridRef.current
    if (!el) return 1
    const cols = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length
    return Math.max(1, cols)
  }

  const scrollTo = (idx: number) => {
    bodyRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${idx}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!items.length) return
    const cur = selected ? items.findIndex((i) => i.path === selected) : -1

    if (e.key === 'Enter') {
      if (cur >= 0) {
        e.preventDefault()
        onOpen(items[cur])
      }
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (cur >= 0) {
        e.preventDefault()
        onDelete(items[cur])
      }
      return
    }

    const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']
    if (!arrows.includes(e.key)) return
    e.preventDefault()
    const cols = view === 'list' ? 1 : getCols()
    let next = cur
    if (cur < 0) next = 0
    else if (e.key === 'ArrowRight') next = Math.min(items.length - 1, cur + 1)
    else if (e.key === 'ArrowLeft') next = Math.max(0, cur - 1)
    else if (e.key === 'ArrowDown') next = Math.min(items.length - 1, cur + cols)
    else if (e.key === 'ArrowUp') next = Math.max(0, cur - cols)
    const target = items[next]
    if (target) {
      onSelect(target.path)
      scrollTo(next)
    }
  }

  const onBackgroundClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!(e.target as HTMLElement).closest('[data-idx]')) onSelect(null)
  }

  const selectAnd = (entry: FileEntry) => {
    onSelect(entry.path)
    bodyRef.current?.focus()
  }

  let content: JSX.Element

  if (loading) {
    content = (
      <div className="fm-state">
        <Icon name="refresh" size={26} className="spin" />
        <div className="fm-state-sub">Loading…</div>
      </div>
    )
  } else if (error) {
    content = (
      <div className="fm-state">
        <Icon name="x-circle" size={40} strokeWidth={1.4} />
        <div className="fm-state-title">Can’t open this folder</div>
        <div className="fm-state-sub">{error}</div>
        <button className="tv-btn" onClick={onRetry}>
          <Icon name="refresh" size={15} />
          Try again
        </button>
      </div>
    )
  } else if (items.length === 0) {
    content = query.trim() ? (
      <div className="fm-state">
        <Icon name="search" size={38} strokeWidth={1.4} />
        <div className="fm-state-title">No matches</div>
        <div className="fm-state-sub">Nothing here matches “{query.trim()}”.</div>
      </div>
    ) : (
      <div className="fm-state">
        <Icon name="folder" size={42} strokeWidth={1.3} />
        <div className="fm-state-title">This folder is empty</div>
        <div className="fm-state-sub">Drag files here to upload.</div>
      </div>
    )
  } else if (view === 'grid') {
    content = (
      <div className="fm-grid" ref={gridRef}>
        {items.map((entry, idx) => (
          <button
            key={entry.path}
            data-idx={idx}
            className={clsx(
              'fm-tile',
              selected === entry.path && 'is-selected',
              entry.error && 'is-locked',
            )}
            onClick={() => selectAnd(entry)}
            onDoubleClick={() => onOpen(entry)}
            onContextMenu={(e) => {
              e.preventDefault()
              onContext(entry, e.clientX, e.clientY)
            }}
            title={entry.error ? `${entry.name} — ${entry.error}` : entry.name}
          >
            <span className="fm-tile-icon">
              <FileIcon entry={entry} size={56} />
              {entry.error && (
                <span className="fm-lock-badge">
                  <Icon name="lock" size={11} strokeWidth={2} />
                </span>
              )}
            </span>
            <span className="fm-tile-name">{entry.name}</span>
            {!entry.is_dir && <span className="fm-tile-size">{formatBytes(entry.size)}</span>}
          </button>
        ))}
      </div>
    )
  } else {
    content = (
      <div className="fm-list-wrap">
        <div className="fm-list-head">
          <span>Name</span>
          <span>Size</span>
          <span>Modified</span>
        </div>
        <div className="fm-list">
          {items.map((entry, idx) => (
            <button
              key={entry.path}
              data-idx={idx}
              className={clsx(
                'fm-row',
                selected === entry.path && 'is-selected',
                entry.error && 'is-locked',
              )}
              onClick={() => selectAnd(entry)}
              onDoubleClick={() => onOpen(entry)}
              onContextMenu={(e) => {
                e.preventDefault()
                onContext(entry, e.clientX, e.clientY)
              }}
              title={entry.error ? `${entry.name} — ${entry.error}` : entry.name}
            >
              <span className="fm-row-name">
                <FileIcon entry={entry} size={22} />
                <span className="fm-row-label">{entry.name}</span>
                {entry.error && (
                  <span className="fm-row-lock">
                    <Icon name="lock" size={12} />
                  </span>
                )}
              </span>
              <span className="fm-row-size">{entry.is_dir ? '—' : formatBytes(entry.size)}</span>
              <span className="fm-row-date">{formatDate(entry.modified) || '—'}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      className="fm-body"
      ref={bodyRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onClick={onBackgroundClick}
    >
      {content}
    </div>
  )
}
