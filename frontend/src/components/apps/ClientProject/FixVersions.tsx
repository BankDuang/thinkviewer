import { useState } from 'react'
import clsx from 'clsx'
import * as api from '@/lib/restClient'
import { Icon } from '@/components/common/Icon'
import { ImageField } from './ImageField'
import { Lightbox } from './Lightbox'
import { cpRelDate } from './cpFormat'

export interface FixVersion {
  note: string
  images: string[]
  date: string
  resolved: boolean
}

interface FixVersionsProps {
  value: FixVersion[]
  onChange: (v: FixVersion[]) => void
  projectId?: string
  issueId?: string
}

/** Append-only log of fix attempts (a "did this actually fix it?" history). */
export function FixVersions({ value, onChange, projectId, issueId }: FixVersionsProps) {
  const versions: FixVersion[] = Array.isArray(value) ? value : []
  const [note, setNote] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [resolved, setResolved] = useState(false)
  const [view, setView] = useState<{ imgs: string[]; start: number } | null>(null)

  function add() {
    if (!note.trim() && images.length === 0) return
    onChange([...versions, { note: note.trim(), images, date: new Date().toISOString(), resolved }])
    setNote('')
    setImages([])
    setResolved(false)
  }
  function remove(idx: number) {
    onChange(versions.filter((_, j) => j !== idx))
  }

  return (
    <div className="cp-fixver">
      {versions.length > 0 && (
        <div className="cp-fixver-list">
          {versions.map((v, idx) => (
            <div className={clsx('cp-fixver-item', v.resolved && 'is-resolved')} key={idx}>
              <div className="cp-fixver-head">
                <span className="cp-fixver-no">v{idx + 1}</span>
                {v.resolved ? (
                  <span className="cp-badge is-ok">resolved</span>
                ) : (
                  <span className="cp-badge is-warn">attempt</span>
                )}
                <span className="cp-fixver-date">{cpRelDate(v.date)}</span>
                <button className="cp-rowbtn is-danger" onClick={() => remove(idx)} aria-label="Remove">
                  <Icon name="trash" size={13} />
                </button>
              </div>
              {v.note && <div className="cp-fixver-note">{v.note}</div>}
              {Array.isArray(v.images) && v.images.length > 0 && (
                <div className="cp-thumbs">
                  {v.images.map((p, j) => (
                    <div className="cp-thumb" key={`${p}-${j}`}>
                      <img src={api.downloadUrl(p)} alt="" onClick={() => setView({ imgs: v.images, start: j })} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="cp-fixver-add">
        <textarea
          className="tv-field cp-input"
          rows={2}
          value={note}
          placeholder="What did you try this time? (e.g. patched X, redeployed)…"
          onChange={(e) => setNote(e.target.value)}
        />
        <ImageField value={images} onChange={setImages} projectId={projectId} issueId={issueId} />
        <div className="cp-fixver-foot">
          <label className="cp-check">
            <input type="checkbox" checked={resolved} onChange={(e) => setResolved(e.target.checked)} />
            <span>This attempt resolved it</span>
          </label>
          <button className="tv-btn tv-btn--primary" onClick={add} type="button">
            <Icon name="plus" size={13} /> Add version
          </button>
        </div>
      </div>

      {view && <Lightbox images={view.imgs} start={view.start} onClose={() => setView(null)} />}
    </div>
  )
}
