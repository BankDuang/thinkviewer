import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import clsx from 'clsx'
import type { AppProps, FileEntry } from '@/types'
import * as api from '@/lib/restClient'
import { notify } from '@/store/notificationStore'
import { confirmDialog } from '@/store/dialogStore'
import { formatBytes } from '@/lib/format'
import { Icon } from '@/components/common/Icon'
import { Breadcrumb } from './Breadcrumb'
import { FileGrid, type FileView } from './FileGrid'
import { UploadDropzone } from './UploadDropzone'
import './files.css'

interface UploadItem {
  id: string
  name: string
  loaded: number
  total: number
  status: 'uploading' | 'done' | 'error'
}

interface HistState {
  stack: string[]
  idx: number
}

interface MenuState {
  entry: FileEntry
  x: number
  y: number
}

const MAX_CONCURRENT = 3

let uploadSeq = 0
const nextUploadId = () => `up-${++uploadSeq}`

function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') ? dir + name : `${dir}/${name}`
}

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes('Files')
}

export function FilesApp({ focused }: AppProps) {
  const [curPath, setCurPath] = useState('')
  const [parent, setParent] = useState('')
  const [items, setItems] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hist, setHist] = useState<HistState>({ stack: [], idx: -1 })
  const [view, setView] = useState<FileView>('grid')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [menu, setMenu] = useState<MenuState | null>(null)

  const reqIdRef = useRef(0)
  const pathRef = useRef('')
  const dragDepth = useRef(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const clearTimer = useRef<number | null>(null)

  useEffect(() => {
    pathRef.current = curPath
  }, [curPath])

  const loadPath = useCallback(async (target: string, mode: 'push' | 'none' | 'init') => {
    const reqId = ++reqIdRef.current
    setLoading(true)
    setError(null)
    try {
      const resp = await api.listFiles(target)
      if (reqId !== reqIdRef.current) return
      setItems(resp.items)
      setCurPath(resp.path)
      setParent(resp.parent)
      if (mode === 'init') {
        setHist({ stack: [resp.path], idx: 0 })
      } else if (mode === 'push') {
        setHist((h) => {
          const stack = h.stack.slice(0, h.idx + 1)
          stack.push(resp.path)
          return { stack, idx: stack.length - 1 }
        })
      }
    } catch (e) {
      if (reqId !== reqIdRef.current) return
      setItems([])
      setError(e instanceof api.ApiError ? e.message : 'Could not read this folder')
    } finally {
      if (reqId === reqIdRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPath('~', 'init')
  }, [loadPath])

  useEffect(
    () => () => {
      if (clearTimer.current) clearTimeout(clearTimer.current)
    },
    [],
  )

  // --- navigation -----------------------------------------------------------
  const navigate = useCallback(
    (target: string) => {
      setSelected(null)
      setQuery('')
      setMenu(null)
      void loadPath(target, 'push')
    },
    [loadPath],
  )

  const refresh = useCallback(() => {
    setMenu(null)
    void loadPath(pathRef.current, 'none')
  }, [loadPath])

  const goBack = useCallback(() => {
    if (hist.idx <= 0) return
    const target = hist.stack[hist.idx - 1]
    setSelected(null)
    setQuery('')
    setMenu(null)
    setHist({ stack: hist.stack, idx: hist.idx - 1 })
    void loadPath(target, 'none')
  }, [hist, loadPath])

  const goForward = useCallback(() => {
    if (hist.idx >= hist.stack.length - 1) return
    const target = hist.stack[hist.idx + 1]
    setSelected(null)
    setQuery('')
    setMenu(null)
    setHist({ stack: hist.stack, idx: hist.idx + 1 })
    void loadPath(target, 'none')
  }, [hist, loadPath])

  const canBack = hist.idx > 0
  const canForward = hist.idx < hist.stack.length - 1
  const canUp = !!parent && parent !== curPath

  const goUp = useCallback(() => {
    if (canUp) navigate(parent)
  }, [canUp, parent, navigate])

  // --- file actions ---------------------------------------------------------
  const downloadEntry = useCallback((entry: FileEntry) => {
    const a = document.createElement('a')
    a.href = api.downloadUrl(entry.path)
    a.download = entry.name
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    notify('info', `Downloading “${entry.name}”`)
  }, [])

  const openEntry = useCallback(
    (entry: FileEntry) => {
      if (entry.error) {
        notify('warn', `No access to “${entry.name}”`)
        return
      }
      if (entry.is_dir) navigate(entry.path)
      else downloadEntry(entry)
    },
    [navigate, downloadEntry],
  )

  const deleteEntry = useCallback(
    async (entry: FileEntry) => {
      setMenu(null)
      const ok = await confirmDialog({
        title: `Delete “${entry.name}”?`,
        message: entry.is_dir
          ? 'This folder and everything inside it will be permanently deleted.'
          : 'This file will be permanently deleted.',
        confirmLabel: 'Delete',
        danger: true,
      })
      if (!ok) return
      try {
        await api.deleteFile(entry.path)
        notify('ok', `Deleted “${entry.name}”`)
        if (selected === entry.path) setSelected(null)
        void loadPath(pathRef.current, 'none')
      } catch (e) {
        notify('error', e instanceof api.ApiError ? e.message : 'Could not delete item')
      }
    },
    [selected, loadPath],
  )

  // --- new folder -----------------------------------------------------------
  useEffect(() => {
    if (creating) folderInputRef.current?.focus()
  }, [creating])

  const submitFolder = useCallback(async () => {
    const name = folderName.trim()
    if (!name) {
      notify('warn', 'Enter a folder name')
      return
    }
    if (name.includes('/')) {
      notify('warn', 'Name can’t contain “/”')
      return
    }
    try {
      await api.mkdir(joinPath(pathRef.current, name))
      setCreating(false)
      setFolderName('')
      notify('ok', `Created “${name}”`)
      void loadPath(pathRef.current, 'none')
    } catch (e) {
      notify('error', e instanceof api.ApiError ? e.message : 'Could not create folder')
    }
  }, [folderName, loadPath])

  // --- uploads --------------------------------------------------------------
  const scheduleClear = useCallback(() => {
    if (clearTimer.current) clearTimeout(clearTimer.current)
    clearTimer.current = window.setTimeout(() => {
      setUploads((prev) => prev.filter((u) => u.status === 'uploading'))
      clearTimer.current = null
    }, 3500)
  }, [])

  const startUploads = useCallback(
    (files: File[]) => {
      if (!files.length) return
      const dir = pathRef.current
      if (clearTimer.current) {
        clearTimeout(clearTimer.current)
        clearTimer.current = null
      }
      const batch: UploadItem[] = files.map((f) => ({
        id: nextUploadId(),
        name: f.name,
        loaded: 0,
        total: f.size,
        status: 'uploading',
      }))
      setUploads((prev) => [...prev.filter((u) => u.status === 'uploading'), ...batch])

      let cursor = 0
      let active = 0
      let done = 0
      const total = files.length

      const runNext = () => {
        while (active < MAX_CONCURRENT && cursor < total) {
          const idx = cursor++
          const file = files[idx]
          const id = batch[idx].id
          active++
          api
            .uploadFile(dir, file, (loaded, t) => {
              setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, loaded, total: t } : u)))
            })
            .then(() => {
              setUploads((prev) =>
                prev.map((u) => (u.id === id ? { ...u, status: 'done', loaded: u.total } : u)),
              )
            })
            .catch((err: unknown) => {
              const msg = err instanceof api.ApiError ? err.message : 'Upload failed'
              setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, status: 'error' } : u)))
              notify('error', `“${file.name}”: ${msg}`)
            })
            .finally(() => {
              active--
              done++
              if (done === total) {
                if (dir === pathRef.current) void loadPath(pathRef.current, 'none')
                scheduleClear()
              } else {
                runNext()
              }
            })
        }
      }
      runNext()
    },
    [loadPath, scheduleClear],
  )

  const onPickFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const fl = e.target.files
    if (fl && fl.length) startUploads(Array.from(fl))
    e.target.value = ''
  }

  // --- drag & drop ----------------------------------------------------------
  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth.current += 1
    setDragOver(true)
  }
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragOver(false)
  }
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth.current = 0
    setDragOver(false)
    startUploads(Array.from(e.dataTransfer.files))
  }

  // --- context menu ---------------------------------------------------------
  const openContext = useCallback((entry: FileEntry, clientX: number, clientY: number) => {
    const r = rootRef.current?.getBoundingClientRect()
    const w = r?.width ?? window.innerWidth
    const h = r?.height ?? window.innerHeight
    const x = Math.min((r ? clientX - r.left : clientX), w - 180)
    const y = Math.min((r ? clientY - r.top : clientY), h - 120)
    setSelected(entry.path)
    setMenu({ entry, x: Math.max(4, x), y: Math.max(4, y) })
  }, [])

  const onRootKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      if (menu) setMenu(null)
      if (creating) {
        setCreating(false)
        setFolderName('')
      }
    }
  }

  // --- derived --------------------------------------------------------------
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items
    return [...base].sort((a, b) =>
      a.is_dir === b.is_dir
        ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        : a.is_dir
          ? -1
          : 1,
    )
  }, [items, query])

  const selectedEntry = useMemo(
    () => filtered.find((i) => i.path === selected) ?? null,
    [filtered, selected],
  )

  const baseName = curPath ? (curPath.split('/').filter(Boolean).pop() ?? 'Root') : 'Home'

  const activeUploads = uploads.filter((u) => u.status === 'uploading').length

  return (
    <div
      className={clsx('fm-root', focused && 'is-focused')}
      ref={rootRef}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => menu && setMenu(null)}
      onKeyDown={onRootKeyDown}
    >
      {/* Toolbar */}
      <div className="fm-toolbar">
        <div className="fm-tb-group">
          <button className="fm-iconbtn" onClick={goBack} disabled={!canBack} title="Back" aria-label="Back">
            <Icon name="chevron-left" size={18} />
          </button>
          <button
            className="fm-iconbtn"
            onClick={goForward}
            disabled={!canForward}
            title="Forward"
            aria-label="Forward"
          >
            <Icon name="chevron-right" size={18} />
          </button>
          <button
            className="fm-iconbtn"
            onClick={goUp}
            disabled={!canUp}
            title="Enclosing folder"
            aria-label="Up"
          >
            <Icon name="chevron-down" size={18} style={{ transform: 'rotate(180deg)' }} />
          </button>
          <button
            className="fm-iconbtn"
            onClick={() => navigate('~')}
            title="Home"
            aria-label="Home"
          >
            <Icon name="home" size={17} />
          </button>
        </div>

        <Breadcrumb path={curPath} onNavigate={navigate} />

        <div className="fm-search">
          <Icon name="search" size={14} />
          <input
            type="text"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
            aria-label="Filter files"
          />
          {query && (
            <button className="fm-search-clear" onClick={() => setQuery('')} aria-label="Clear search">
              <Icon name="x-circle" size={14} />
            </button>
          )}
        </div>

        <div className="fm-seg" role="group" aria-label="View">
          <button
            className={clsx('fm-seg-btn', view === 'grid' && 'is-active')}
            onClick={() => setView('grid')}
            title="Icon view"
            aria-label="Icon view"
          >
            <Icon name="grid" size={16} />
          </button>
          <button
            className={clsx('fm-seg-btn', view === 'list' && 'is-active')}
            onClick={() => setView('list')}
            title="List view"
            aria-label="List view"
          >
            <Icon name="list" size={16} />
          </button>
        </div>

        <div className="fm-tb-group">
          <button className="fm-iconbtn" onClick={refresh} title="Refresh" aria-label="Refresh">
            <Icon name="refresh" size={17} />
          </button>
          <button
            className="fm-iconbtn"
            onClick={() => setCreating((c) => !c)}
            title="New folder"
            aria-label="New folder"
          >
            <Icon name="new-folder" size={18} />
          </button>
          <button
            className="fm-iconbtn"
            onClick={() => fileInputRef.current?.click()}
            title="Upload files"
            aria-label="Upload files"
          >
            <Icon name="upload" size={17} />
          </button>
          <button
            className="fm-iconbtn fm-iconbtn--danger"
            onClick={() => selectedEntry && void deleteEntry(selectedEntry)}
            disabled={!selectedEntry}
            title="Delete"
            aria-label="Delete"
          >
            <Icon name="trash" size={17} />
          </button>
        </div>
      </div>

      {/* New folder bar */}
      <AnimatePresence initial={false}>
        {creating && (
          <motion.div
            className="fm-newfolder"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            <div className="fm-newfolder-inner">
              <Icon name="new-folder" size={17} />
              <input
                ref={folderInputRef}
                className="tv-field fm-newfolder-input"
                placeholder="Untitled folder"
                value={folderName}
                spellCheck={false}
                onChange={(e) => setFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitFolder()
                  else if (e.key === 'Escape') {
                    setCreating(false)
                    setFolderName('')
                  }
                }}
              />
              <button className="tv-btn tv-btn--primary" onClick={() => void submitFolder()}>
                Create
              </button>
              <button
                className="tv-btn"
                onClick={() => {
                  setCreating(false)
                  setFolderName('')
                }}
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Listing */}
      <FileGrid
        items={filtered}
        view={view}
        selected={selected}
        loading={loading}
        error={error}
        query={query}
        onSelect={setSelected}
        onOpen={openEntry}
        onDelete={(en) => void deleteEntry(en)}
        onContext={openContext}
        onRetry={refresh}
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="fm-hidden-input"
        onChange={onPickFiles}
      />

      {/* Drag overlay */}
      <AnimatePresence>{dragOver && <UploadDropzone folderName={baseName} />}</AnimatePresence>

      {/* Upload progress */}
      <AnimatePresence>
        {uploads.length > 0 && (
          <motion.div
            className="fm-uploads glass"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
          >
            <div className="fm-uploads-head">
              <span>
                {activeUploads > 0
                  ? `Uploading ${activeUploads} of ${uploads.length}`
                  : `Uploaded ${uploads.length} item${uploads.length > 1 ? 's' : ''}`}
              </span>
              <button
                className="fm-iconbtn fm-iconbtn--sm"
                onClick={() => {
                  if (clearTimer.current) clearTimeout(clearTimer.current)
                  setUploads([])
                }}
                aria-label="Dismiss"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            <div className="fm-uploads-list">
              {uploads.map((u) => {
                const pct =
                  u.status === 'done' ? 100 : u.total ? Math.round((u.loaded / u.total) * 100) : 0
                return (
                  <div key={u.id} className="fm-up-item">
                    <div className="fm-up-row">
                      <span className="fm-up-name">{u.name}</span>
                      <span className={clsx('fm-up-status', `is-${u.status}`)}>
                        {u.status === 'uploading' && `${pct}%`}
                        {u.status === 'done' && <Icon name="check" size={14} />}
                        {u.status === 'error' && <Icon name="alert" size={14} />}
                      </span>
                    </div>
                    <div className="fm-up-bar">
                      <div
                        className={clsx('fm-up-bar-fill', `is-${u.status}`)}
                        style={{ width: `${u.status === 'error' ? 100 : pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Context menu */}
      {menu && (
        <div
          className="fm-menu glass"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.entry.is_dir ? (
            <button
              className="fm-menu-item"
              onClick={() => {
                openEntry(menu.entry)
                setMenu(null)
              }}
            >
              <Icon name="folder" size={15} />
              Open
            </button>
          ) : (
            <button
              className="fm-menu-item"
              onClick={() => {
                downloadEntry(menu.entry)
                setMenu(null)
              }}
              disabled={!!menu.entry.error}
            >
              <Icon name="download" size={15} />
              Download
            </button>
          )}
          <div className="fm-menu-sep" />
          <button className="fm-menu-item is-danger" onClick={() => void deleteEntry(menu.entry)}>
            <Icon name="trash" size={15} />
            Delete
          </button>
        </div>
      )}

      <span className="fm-statusbar">
        {filtered.length} item{filtered.length === 1 ? '' : 's'}
        {selectedEntry && !selectedEntry.is_dir && ` · ${formatBytes(selectedEntry.size)}`}
      </span>
    </div>
  )
}
