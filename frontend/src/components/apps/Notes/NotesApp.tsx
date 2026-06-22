import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { AppProps, Note, NoteChecklistItem } from '@/types'
import * as api from '@/lib/restClient'
import { notify } from '@/store/notificationStore'
import { confirmDialog } from '@/store/dialogStore'
import { Icon } from '@/components/common/Icon'
import './notes.css'

const COLORS = ['', '#ffd95e', '#ff8a8a', '#8ad0ff', '#a8e6a1', '#d9a8ff']

function relTime(iso: string): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const m = Math.floor((Date.now() - t) / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function todayStr(): string {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function dueLabel(d: string): string {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  if (Number.isNaN(dt.getTime())) return d
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
// '' (none) | 'is-overdue' (past) | 'is-today' | 'is-soon' (within 3 days) | ''
function dueClass(d: string): string {
  if (!d) return ''
  const t = todayStr()
  if (d < t) return 'is-overdue'
  if (d === t) return 'is-today'
  return ''
}

function preview(n: Note): string {
  const line = (n.body || '').split('\n').map((s) => s.trim()).find(Boolean)
  if (line) return line
  const items = Array.isArray(n.checklist) ? n.checklist : []
  if (items.length) return `☑ ${items.filter((i) => i.done).length}/${items.length} done`
  if (Array.isArray(n.images) && n.images.length) return `${n.images.length} image(s)`
  return 'No additional text'
}

// fullscreen image viewer
function Lightbox({ images, start, onClose }: { images: string[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start)
  const n = images.length
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') setI((v) => (v + 1) % n)
      else if (e.key === 'ArrowLeft') setI((v) => (v - 1 + n) % n)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [n, onClose])
  if (!n) return null
  return (
    <div className="notes-lightbox" onClick={onClose}>
      <button className="notes-lb-btn notes-lb-close" onClick={onClose} aria-label="Close">
        <Icon name="close" size={22} />
      </button>
      {n > 1 && (
        <button className="notes-lb-btn notes-lb-prev" onClick={(e) => { e.stopPropagation(); setI((v) => (v - 1 + n) % n) }} aria-label="Previous">
          <Icon name="chevron-left" size={28} />
        </button>
      )}
      <img className="notes-lb-img" src={api.downloadUrl(images[i])} alt="" onClick={(e) => e.stopPropagation()} />
      {n > 1 && (
        <button className="notes-lb-btn notes-lb-next" onClick={(e) => { e.stopPropagation(); setI((v) => (v + 1) % n) }} aria-label="Next">
          <Icon name="chevron-right" size={28} />
        </button>
      )}
      {n > 1 && <div className="notes-lb-count">{i + 1} / {n}</div>}
    </div>
  )
}

function Checklist({ items, onChange }: { items: NoteChecklistItem[]; onChange: (v: NoteChecklistItem[]) => void }) {
  const [text, setText] = useState('')
  const done = items.filter((i) => i.done).length
  const add = () => {
    const t = text.trim()
    if (!t) return
    onChange([...items, { text: t, done: false }])
    setText('')
  }
  return (
    <div className="notes-checklist">
      <div className="notes-section-label">
        <Icon name="check" size={13} /> Checklist
        {items.length > 0 && <span className="notes-cl-count">{done}/{items.length}</span>}
      </div>
      {items.map((it, idx) => (
        <div className={clsx('notes-cl-item', it.done && 'is-done')} key={idx}>
          <button
            className={clsx('notes-checkbox', it.done && 'is-on')}
            onClick={() => onChange(items.map((x, j) => (j === idx ? { ...x, done: !x.done } : x)))}
            aria-label="Toggle"
          >
            {it.done && <Icon name="check" size={11} strokeWidth={3} />}
          </button>
          <input
            className="notes-cl-text"
            value={it.text}
            spellCheck={false}
            onChange={(e) => onChange(items.map((x, j) => (j === idx ? { ...x, text: e.target.value } : x)))}
          />
          <button className="notes-cl-del" onClick={() => onChange(items.filter((_, j) => j !== idx))} aria-label="Remove">
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
      <div className="notes-cl-add">
        <Icon name="plus" size={13} />
        <input
          value={text}
          placeholder="Add a checklist item…"
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
      </div>
    </div>
  )
}

function NoteImages({
  images,
  onChange,
  onOpen,
  registerPaste,
}: {
  images: string[]
  onChange: (v: string[]) => void
  onOpen: (start: number) => void
  registerPaste: (handler: ((files: File[]) => void) | null) => void
}) {
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const imagesRef = useRef(images)
  imagesRef.current = images

  const upload = useCallback(
    async (files: File[]) => {
      const imgs = files.filter((f) => f.type.startsWith('image/'))
      if (!imgs.length) return
      setBusy(true)
      try {
        const added: string[] = []
        for (const f of imgs) {
          const r = await api.uploadNoteImage(f)
          if (r?.path) added.push(r.path)
        }
        if (added.length) onChange([...imagesRef.current, ...added])
      } catch (e) {
        notify('error', e instanceof api.ApiError ? e.message : 'Upload failed')
      } finally {
        setBusy(false)
      }
    },
    [onChange],
  )

  // let the editor forward clipboard pastes to this uploader while it's the active note
  useEffect(() => {
    registerPaste((files) => void upload(files))
    return () => registerPaste(null)
  }, [registerPaste, upload])

  return (
    <div className="notes-images">
      <div className="notes-section-label">
        <Icon name="image" size={13} /> Images
      </div>
      {images.length > 0 && (
        <div className="notes-thumbs">
          {images.map((p, idx) => (
            <div className="notes-thumb" key={`${p}-${idx}`}>
              <img src={api.downloadUrl(p)} alt="" onClick={() => onOpen(idx)} />
              <button className="notes-thumb-x" onClick={() => onChange(images.filter((_, j) => j !== idx))} aria-label="Remove">
                <Icon name="close" size={11} strokeWidth={2.4} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div
        className={clsx('notes-dropzone', over && 'is-over', busy && 'is-busy')}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void upload(Array.from(e.dataTransfer.files)) }}
        onClick={() => !busy && inputRef.current?.click()}
      >
        <Icon name={busy ? 'refresh' : 'image'} size={15} className={busy ? 'spin' : undefined} />
        <span>{busy ? 'Uploading…' : 'Drag, paste (⌘V), or click to add images'}</span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => { void upload(Array.from(e.target.files ?? [])); e.target.value = '' }}
        />
      </div>
    </div>
  )
}

export function NotesApp(_props: AppProps) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [lightbox, setLightbox] = useState<{ images: string[]; start: number } | null>(null)

  const notesRef = useRef<Note[]>([])
  notesRef.current = notes
  const saveTimer = useRef<number>()
  const pasteHandler = useRef<((files: File[]) => void) | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const focusNew = useRef(false)

  const load = useCallback(() => {
    setLoading(true)
    api
      .listNotes()
      .then((r) => {
        setNotes(r.items)
        setSelectedId((cur) => cur ?? (r.items[0]?.id ?? null))
      })
      .catch((e) => notify('error', e instanceof api.ApiError ? e.message : 'Could not load notes'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => load(), [load])

  // sorted view: pinned first, then most-recently-updated
  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase()
    const arr = notes.filter((n) => {
      if (!q) return true
      const hay = [n.title, n.body, ...(n.checklist ?? []).map((c) => c.text)].join(' ').toLowerCase()
      return hay.includes(q)
    })
    return [...arr].sort((a, b) => {
      const pa = a.pinned === '1' ? 0 : 1
      const pb = b.pinned === '1' ? 0 : 1
      if (pa !== pb) return pa - pb // pinned first
      const da = a.deadline || ''
      const db = b.deadline || ''
      if (!!da !== !!db) return da ? -1 : 1 // notes with a deadline before those without
      if (da && db && da !== db) return da < db ? -1 : 1 // soonest deadline first
      return (b.updated_at || '').localeCompare(a.updated_at || '') // then most recent
    })
  }, [notes, query])

  const selected = notes.find((n) => n.id === selectedId) ?? null

  // Grow the body textarea to fit its content (like a real notes app) so the
  // editor never traps text in a tiny box. Re-measure when switching notes.
  const autosizeBody = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])
  useEffect(() => {
    autosizeBody(bodyRef.current)
  }, [selectedId, selected?.body, autosizeBody])

  const selectedIdRef = useRef<string | null>(null)
  selectedIdRef.current = selectedId

  const flushSave = useCallback(() => {
    window.clearTimeout(saveTimer.current)
    const id = selectedIdRef.current
    if (!id) return
    const n = notesRef.current.find((x) => x.id === id)
    if (n) api.updateNote(id, { title: n.title, body: n.body }).catch(() => {})
  }, [])

  const registerPaste = useCallback((h: ((files: File[]) => void) | null) => {
    pasteHandler.current = h
  }, [])

  // patch a note locally; persist text on a debounce, structured fields immediately
  const patch = useCallback(
    (id: string, fields: Partial<Note>, immediate = false) => {
      // keep notesRef authoritative *synchronously* so a blur/flush firing in the
      // same tick as this edit never reads a stale title/body
      setNotes((prev) => {
        const next = prev.map((n) => (n.id === id ? { ...n, ...fields } : n))
        notesRef.current = next
        return next
      })
      if (immediate) {
        api
          .updateNote(id, fields)
          .then((srv) => setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, updated_at: srv.updated_at } : n))))
          .catch(() => notify('error', 'Could not save note'))
      } else {
        window.clearTimeout(saveTimer.current)
        saveTimer.current = window.setTimeout(() => {
          const n = notesRef.current.find((x) => x.id === id)
          if (n) api.updateNote(id, { title: n.title, body: n.body }).catch(() => notify('error', 'Could not save note'))
        }, 600)
      }
    },
    [],
  )

  // flush any pending debounced text save when the app unmounts (window closed)
  useEffect(() => {
    return () => flushSave()
  }, [flushSave])

  const selectNote = (id: string) => {
    if (id === selectedId) return
    flushSave()
    setSelectedId(id)
  }

  const newNote = async () => {
    flushSave()
    try {
      const n = await api.createNote({ title: '', body: '', checklist: [], images: [], pinned: '0', color: '', deadline: '' })
      setNotes((prev) => [n, ...prev])
      setSelectedId(n.id)
      focusNew.current = true
    } catch (e) {
      notify('error', e instanceof api.ApiError ? e.message : 'Could not create note')
    }
  }

  useEffect(() => {
    if (focusNew.current && selected) {
      titleRef.current?.focus()
      focusNew.current = false
    }
  }, [selected])

  const delNote = async (n: Note) => {
    const ok = await confirmDialog({
      title: `Delete ${n.title ? `“${n.title}”` : 'this note'}?`,
      message: 'The note and its images will be permanently removed.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    // if we're deleting the active note, cancel its pending debounced save first
    if (selectedIdRef.current === n.id) window.clearTimeout(saveTimer.current)
    try {
      await api.deleteNote(n.id)
      // hand selection to the next note in the *visible* (sorted/filtered) order
      const nextVisible = sorted.find((x) => x.id !== n.id)?.id ?? null
      setNotes((prev) => prev.filter((x) => x.id !== n.id))
      if (selectedIdRef.current === n.id) setSelectedId(nextVisible)
    } catch (e) {
      notify('error', e instanceof api.ApiError ? e.message : 'Could not delete note')
    }
  }

  return (
    <div className="notes-app" onPaste={(e) => {
      if (!pasteHandler.current) return
      const files: File[] = []
      for (const it of Array.from(e.clipboardData?.items ?? [])) {
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          const f = it.getAsFile()
          if (f) files.push(f)
        }
      }
      if (files.length) {
        e.preventDefault()
        pasteHandler.current(files)
      }
    }}>
      <aside className="notes-sidebar">
        <div className="notes-side-head">
          <span className="notes-side-title">Notes</span>
          <button className="notes-new-btn" onClick={() => void newNote()} title="New note">
            <Icon name="pencil" size={15} />
          </button>
        </div>
        <div className="notes-search">
          <Icon name="search" size={13} />
          <input value={query} placeholder="Search" spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="notes-list">
          {loading ? (
            <div className="notes-empty"><Icon name="refresh" size={20} className="spin" /></div>
          ) : sorted.length === 0 ? (
            <div className="notes-empty">
              <Icon name="pencil" size={26} strokeWidth={1.3} />
              <p>{query ? 'No matches' : 'No notes yet'}</p>
            </div>
          ) : (
            sorted.map((n) => (
              <button
                key={n.id}
                className={clsx('notes-item', n.id === selectedId && 'is-active')}
                onClick={() => selectNote(n.id)}
              >
                {n.color ? <span className="notes-item-accent" style={{ background: n.color }} /> : null}
                <div className="notes-item-main">
                  <div className="notes-item-top">
                    <span className="notes-item-title">{n.title || 'New Note'}</span>
                    {n.deadline && (
                      <span className={clsx('notes-due', dueClass(n.deadline))}>
                        <Icon name="calendar" size={10} />
                        {dueLabel(n.deadline)}
                      </span>
                    )}
                    {n.pinned === '1' && <Icon name="signal" size={11} className="notes-item-pin" />}
                  </div>
                  <div className="notes-item-sub">
                    <span className="notes-item-time">{relTime(n.updated_at)}</span>
                    <span className="notes-item-preview">{preview(n)}</span>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className="notes-main">
        {!selected ? (
          <div className="notes-blank">
            <Icon name="pencil" size={40} strokeWidth={1.2} />
            <p>Select a note, or create a new one.</p>
            <button className="notes-blank-btn" onClick={() => void newNote()}>
              <Icon name="plus" size={14} /> New note
            </button>
          </div>
        ) : (
          <div className="notes-editor" style={selected.color ? { ['--note-accent' as string]: selected.color } : undefined}>
            <div className="notes-editor-bar">
              <div className="notes-colors">
                {COLORS.map((c) => (
                  <button
                    key={c || 'none'}
                    className={clsx('notes-color', selected.color === c && 'is-on', !c && 'is-none')}
                    style={c ? { background: c } : undefined}
                    onClick={() => patch(selected.id, { color: c }, true)}
                    title={c ? 'Color' : 'No color'}
                  />
                ))}
              </div>
              <div className={clsx('notes-deadline', selected.deadline && dueClass(selected.deadline))}>
                <Icon name="calendar" size={14} />
                <input
                  type="date"
                  value={selected.deadline || ''}
                  onChange={(e) => patch(selected.id, { deadline: e.target.value }, true)}
                  title="Deadline"
                />
                {selected.deadline && (
                  <button
                    className="notes-deadline-clear"
                    onClick={() => patch(selected.id, { deadline: '' }, true)}
                    aria-label="Clear deadline"
                  >
                    <Icon name="close" size={11} strokeWidth={2.4} />
                  </button>
                )}
              </div>
              <div className="notes-bar-spacer" />
              <button
                className={clsx('notes-bar-btn', selected.pinned === '1' && 'is-on')}
                onClick={() => patch(selected.id, { pinned: selected.pinned === '1' ? '0' : '1' }, true)}
                title={selected.pinned === '1' ? 'Unpin' : 'Pin to top'}
              >
                <Icon name="signal" size={15} />
              </button>
              <button className="notes-bar-btn is-danger" onClick={() => void delNote(selected)} title="Delete note">
                <Icon name="trash" size={15} />
              </button>
            </div>

            <input
              ref={titleRef}
              className="notes-title"
              value={selected.title}
              placeholder="Title"
              spellCheck={false}
              onChange={(e) => patch(selected.id, { title: e.target.value })}
              onBlur={flushSave}
            />
            <div className="notes-meta">Edited {relTime(selected.updated_at)} ago</div>

            <textarea
              ref={bodyRef}
              className="notes-body"
              value={selected.body}
              placeholder="Start writing…"
              spellCheck={false}
              onChange={(e) => { patch(selected.id, { body: e.target.value }); autosizeBody(e.target) }}
              onBlur={flushSave}
            />

            <Checklist
              key={`cl-${selected.id}`}
              items={Array.isArray(selected.checklist) ? selected.checklist : []}
              onChange={(v) => patch(selected.id, { checklist: v }, true)}
            />

            <NoteImages
              key={`img-${selected.id}`}
              images={Array.isArray(selected.images) ? selected.images : []}
              onChange={(v) => patch(selected.id, { images: v }, true)}
              onOpen={(start) => setLightbox({ images: selected.images, start })}
              registerPaste={registerPaste}
            />
          </div>
        )}
      </section>

      {lightbox && <Lightbox images={lightbox.images} start={lightbox.start} onClose={() => setLightbox(null)} />}
    </div>
  )
}
