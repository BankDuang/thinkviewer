import { useState } from 'react'
import clsx from 'clsx'
import type { CpRecord } from '@/types'
import * as api from '@/lib/restClient'
import { Icon } from '@/components/common/Icon'
import { useCp } from './CpContext'
import { Lightbox } from './Lightbox'
import { cpBadgeClass, cpBool, cpDate, cpLabel, cpMoney, cpRelDate } from './cpFormat'
import type { CpField, CpSpec } from './specs'
import type { FixVersion } from './FixVersions'

/** Read-only, image-rich detail view of one record — shown inline when a table
 *  row is clicked. Renders from the same field spec the form uses. */
export function CpDetail({ spec, rec, onEdit }: { spec: CpSpec; rec: CpRecord; onEdit: () => void }) {
  const { clients, projects } = useCp()
  const [view, setView] = useState<{ imgs: string[]; start: number } | null>(null)

  const relName = (relation: string | undefined, v: unknown) => {
    const list = relation === 'clients' ? clients : projects
    const hit = list.find((r) => String(r.id) === String(v))
    return hit ? String(hit.name ?? hit.title ?? hit.id) : ''
  }

  function thumbs(imgs: string[]) {
    return (
      <div className="cp-thumbs">
        {imgs.map((p, j) => (
          <div className="cp-thumb" key={`${p}-${j}`}>
            <img src={api.downloadUrl(p)} alt="" onClick={() => setView({ imgs, start: j })} />
          </div>
        ))}
      </div>
    )
  }

  function renderValue(f: CpField): React.ReactNode {
    const v = rec[f.key]
    const type = f.type ?? 'text'
    if (type === 'images') {
      const imgs = Array.isArray(v) ? (v as string[]) : []
      return imgs.length ? thumbs(imgs) : null
    }
    if (type === 'versions') {
      const vers = Array.isArray(v) ? (v as FixVersion[]) : []
      if (!vers.length) return null
      return (
        <div className="cp-fixver-list">
          {vers.map((ver, idx) => (
            <div className={clsx('cp-fixver-item', ver.resolved && 'is-resolved')} key={idx}>
              <div className="cp-fixver-head">
                <span className="cp-fixver-no">v{idx + 1}</span>
                <span className={clsx('cp-badge', ver.resolved ? 'is-ok' : 'is-warn')}>
                  {ver.resolved ? 'resolved' : 'attempt'}
                </span>
                <span className="cp-fixver-date">{cpRelDate(ver.date)}</span>
              </div>
              {ver.note && <div className="cp-fixver-note">{ver.note}</div>}
              {Array.isArray(ver.images) && ver.images.length > 0 && thumbs(ver.images)}
            </div>
          ))}
        </div>
      )
    }
    const s = v == null ? '' : String(v)
    if (type === 'checkbox') return cpBool(v) ? <span>Yes</span> : null
    if (s.trim() === '') return null
    if (type === 'money') return <span className="cp-mono">{cpMoney(v)}</span>
    if (type === 'date') return <span className="cp-mono">{cpDate(v)}</span>
    if (type === 'relation') {
      const name = relName(f.relation, v)
      return name ? <span>{name}</span> : null
    }
    if (type === 'select') return <span className={clsx('cp-badge', cpBadgeClass(v))}>{cpLabel(v)}</span>
    if (type === 'textarea') return <div className="cp-prose">{s}</div>
    if (type === 'tags') {
      const arr = Array.isArray(v) ? (v as string[]) : s.split(',').map((x) => x.trim()).filter(Boolean)
      return arr.length ? <span>{arr.join(', ')}</span> : null
    }
    return <span>{s}</span>
  }

  const blockTypes = new Set(['textarea', 'images', 'versions'])
  const fields = spec.fields.filter((f) => f.key !== spec.titleField)
  const inline = fields.filter((f) => !blockTypes.has(f.type ?? 'text'))
  const blocks = fields.filter((f) => blockTypes.has(f.type ?? 'text'))

  const inlineNodes = inline
    .map((f) => ({ f, node: renderValue(f) }))
    .filter((x) => x.node != null)
  const blockNodes = blocks
    .map((f) => ({ f, node: renderValue(f) }))
    .filter((x) => x.node != null)
  const empty = inlineNodes.length === 0 && blockNodes.length === 0

  return (
    <div className="cp-rdetail">
      {inlineNodes.length > 0 && (
        <div className="cp-rdetail-meta">
          {inlineNodes.map(({ f, node }) => (
            <div className="cp-rdetail-item" key={f.key}>
              <span className="cp-rdetail-label">{f.label}</span>
              <span className="cp-rdetail-value">{node}</span>
            </div>
          ))}
        </div>
      )}
      {blockNodes.map(({ f, node }) => (
        <div className="cp-rdetail-block" key={f.key}>
          <div className="cp-rdetail-block-label">{f.label}</div>
          {node}
        </div>
      ))}
      {empty && <div className="cp-dim cp-rdetail-empty">No additional details yet.</div>}
      <div className="cp-rdetail-foot">
        <button className="tv-btn" onClick={onEdit}>
          <Icon name="pencil" size={13} /> Edit
        </button>
      </div>
      {view && <Lightbox images={view.imgs} start={view.start} onClose={() => setView(null)} />}
    </div>
  )
}
