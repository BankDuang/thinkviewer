import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '@/lib/restClient'
import { notify } from '@/store/notificationStore'
import { confirmDialog } from '@/store/dialogStore'
import { Icon } from '@/components/common/Icon'
import { useCp } from '../CpContext'
import type { CpRecord } from '@/types'

const CATEGORIES = [
  'Screenshot',
  'Design',
  'Proposal',
  'Contract',
  'Invoice',
  'UAT',
  'API Doc',
  'Other',
] as const

const IMG_RE = /\.(png|jpe?g|gif|webp|svg)$/i

export function Files() {
  const { projects } = useCp()
  const [items, setItems] = useState<CpRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [projectFilter, setProjectFilter] = useState('')
  const [category, setCategory] = useState<string>('Screenshot')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const projectName = useCallback(
    (id: unknown): string => {
      if (id == null || id === '') return ''
      const p = projects.find((r) => String(r.id) === String(id))
      return p ? String(p.name ?? p.id) : String(id)
    },
    [projects],
  )

  const load = useCallback(() => {
    setLoading(true)
    api
      .cpList('files', projectFilter ? { project_id: projectFilter } : undefined)
      .then((r) => setItems(r.items))
      .catch((e) => notify('error', e instanceof api.ApiError ? e.message : 'Could not load files'))
      .finally(() => setLoading(false))
  }, [projectFilter])

  useEffect(() => load(), [load])

  const onPick = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = '' // allow re-picking the same file
      if (!file) return
      setUploading(true)
      try {
        await api.cpUpload(file, {
          project_id: projectFilter || undefined,
          category,
        })
        notify('ok', `Uploaded “${file.name}”`)
        load()
      } catch (err) {
        notify('error', err instanceof api.ApiError ? err.message : 'Upload failed')
      } finally {
        setUploading(false)
      }
    },
    [projectFilter, category, load],
  )

  const onDelete = useCallback(
    async (rec: CpRecord) => {
      const label = String(rec.name ?? 'this file')
      const ok = await confirmDialog({
        title: `Delete “${label}”?`,
        message: 'This file will be permanently removed.',
        confirmLabel: 'Delete',
        danger: true,
      })
      if (!ok) return
      try {
        await api.cpDelete('files', String(rec.id))
        notify('ok', `Deleted “${label}”`)
        load()
      } catch (err) {
        notify('error', err instanceof api.ApiError ? err.message : 'Could not delete')
      }
    },
    [load],
  )

  return (
    <div className="cp-section">
      <div className="cp-section-head">
        <div className="cp-section-title">
          <Icon name="folder" size={18} />
          <span>Files</span>
          <span className="cp-count">{items.length}</span>
        </div>
        <div className="cp-section-actions">
          <select
            className="tv-field"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            title="Project"
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={String(p.id)} value={String(p.id)}>
                {String(p.name ?? p.id)}
              </option>
            ))}
          </select>
          <select
            className="tv-field"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            title="Category"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button className="tv-btn" onClick={load} title="Refresh" aria-label="Refresh">
            <Icon name="refresh" size={14} className={loading ? 'spin' : undefined} />
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            onChange={(e) => void onPick(e)}
          />
          <button
            className="tv-btn tv-btn--primary"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            <Icon name="upload" size={14} />
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="cp-empty">
          <Icon name="refresh" size={26} className="spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="cp-empty">
          <Icon name="folder" size={30} />
          <span>No files yet</span>
        </div>
      ) : (
        <div className="cp-file-grid">
          {items.map((f) => {
            const id = String(f.id)
            const path = String(f.path ?? '')
            const name = String(f.name ?? path.split('/').pop() ?? 'file')
            const href = api.downloadUrl(path)
            const isImage = IMG_RE.test(name)
            const proj = projectName(f.project_id)
            const cat = String(f.category ?? '')
            const sub = [cat, proj].filter(Boolean).join(' · ')
            return (
              <div className="cp-file" key={id}>
                {isImage ? (
                  <img className="cp-file-thumb" src={href} alt={name} loading="lazy" />
                ) : (
                  <div className="cp-file-thumb">
                    <Icon name="file" size={30} />
                  </div>
                )}
                <div className="cp-file-meta">
                  <a className="cp-file-name" href={href} target="_blank" rel="noreferrer">
                    {name}
                  </a>
                  <div className="cp-dim">{sub || '—'}</div>
                </div>
                <button
                  className="cp-rowbtn is-danger"
                  onClick={() => void onDelete(f)}
                  title="Delete"
                  aria-label="Delete file"
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
