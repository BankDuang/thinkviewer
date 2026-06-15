import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import * as api from '@/lib/restClient'
import { notify } from '@/store/notificationStore'
import { Icon } from '@/components/common/Icon'
import { Lightbox } from './Lightbox'

interface ImageFieldProps {
  value: string[] // file paths
  onChange: (paths: string[]) => void
  projectId?: string
  issueId?: string
}

/** Drag-drop / paste / multi-select image attachments with thumbnails + viewer. */
export function ImageField({ value, onChange, projectId, issueId }: ImageFieldProps) {
  const paths = Array.isArray(value) ? value : []
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [view, setView] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // refs so the document-level paste handler always sees the latest values
  const valueRef = useRef<string[]>(paths)
  valueRef.current = paths
  const activeRef = useRef(false) // pointer over OR keyboard focus on this field

  const doUpload = useCallback(
    async (files: File[]) => {
      const imgs = files.filter((f) => f.type.startsWith('image/'))
      if (!imgs.length) return
      setBusy(true)
      try {
        const added: string[] = []
        for (const f of imgs) {
          const rec = await api.cpUpload(f, { project_id: projectId, issue_id: issueId, category: 'attachment' })
          if (rec?.path) added.push(String(rec.path))
        }
        if (added.length) onChange([...valueRef.current, ...added])
      } catch (e) {
        notify('error', e instanceof api.ApiError ? e.message : 'Upload failed')
      } finally {
        setBusy(false)
      }
    },
    [onChange, projectId, issueId],
  )

  // Paste an image from the clipboard (⌘/Ctrl+V) when this field is hovered/focused.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!activeRef.current) return
      const files: File[] = []
      for (const it of Array.from(e.clipboardData?.items ?? [])) {
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          const f = it.getAsFile()
          if (f) files.push(f)
        }
      }
      if (files.length) {
        e.preventDefault()
        void doUpload(files)
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [doUpload])

  return (
    <div className="cp-imgfield">
      <div
        className={clsx('cp-dropzone', over && 'is-over', busy && 'is-busy')}
        tabIndex={0}
        onMouseEnter={() => (activeRef.current = true)}
        onMouseLeave={() => (activeRef.current = false)}
        onFocus={() => (activeRef.current = true)}
        onBlur={() => (activeRef.current = false)}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          void doUpload(Array.from(e.dataTransfer.files))
        }}
        onClick={() => !busy && inputRef.current?.click()}
      >
        <Icon name={busy ? 'refresh' : 'image'} size={17} className={busy ? 'spin' : undefined} />
        <span>{busy ? 'Uploading…' : 'Drag, paste (⌘V), or click to add'}</span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            void doUpload(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </div>
      {paths.length > 0 && (
        <div className="cp-thumbs">
          {paths.map((p, idx) => (
            <div className="cp-thumb" key={`${p}-${idx}`}>
              <img src={api.downloadUrl(p)} alt="" onClick={() => setView(idx)} />
              <button
                className="cp-thumb-x"
                onClick={() => onChange(paths.filter((_, j) => j !== idx))}
                aria-label="Remove"
              >
                <Icon name="close" size={11} strokeWidth={2.4} />
              </button>
            </div>
          ))}
        </div>
      )}
      {view !== null && <Lightbox images={paths} start={view} onClose={() => setView(null)} />}
    </div>
  )
}
