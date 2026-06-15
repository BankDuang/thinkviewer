import { Fragment, useMemo, useState } from 'react'
import clsx from 'clsx'
import type { CpRecord } from '@/types'
import { Icon } from '@/components/common/Icon'
import { useCp } from './CpContext'
import { CpDetail } from './CpDetail'
import { cpBadgeClass, cpBool, cpDate, cpLabel, cpMoney } from './cpFormat'
import type { CpColumn, CpSpec } from './specs'

interface CpTableProps {
  spec: CpSpec
  rows: CpRecord[]
  onEdit: (rec: CpRecord) => void
  onDelete: (rec: CpRecord) => void
  onToggle?: (rec: CpRecord, col: CpColumn, next: string) => void
}

export function CpTable({ spec, rows, onEdit, onDelete, onToggle }: CpTableProps) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const { clients, projects } = useCp()
  const nameMap = useMemo(() => {
    const m: Record<string, Record<string, string>> = { clients: {}, projects: {} }
    for (const c of clients) m.clients[String(c.id)] = String(c.name ?? c.id)
    for (const p of projects) m.projects[String(p.id)] = String(p.name ?? p.id)
    return m
  }, [clients, projects])

  function cell(col: CpColumn, rec: CpRecord) {
    const v = rec[col.key]
    switch (col.type) {
      case 'badge':
        return v ? <span className={clsx('cp-badge', cpBadgeClass(v))}>{cpLabel(v)}</span> : <span className="cp-dim">—</span>
      case 'money':
        return <span className="cp-mono">{cpMoney(v)}</span>
      case 'date':
        return <span className="cp-mono">{cpDate(v)}</span>
      case 'bool':
        return cpBool(v) ? (
          <Icon name="check" size={15} strokeWidth={2.4} />
        ) : (
          <span className="cp-dim">—</span>
        )
      case 'check': {
        const checked = col.onValue != null ? String(v) === col.onValue : cpBool(v)
        return (
          <button
            className={clsx('cp-checkbox sm', checked && 'is-on')}
            onClick={(e) => {
              e.stopPropagation()
              onToggle?.(rec, col, checked ? (col.offValue ?? '0') : (col.onValue ?? '1'))
            }}
            aria-label="Toggle"
          >
            {checked && <Icon name="check" size={11} strokeWidth={3} />}
          </button>
        )
      }
      case 'relation':
        return <span>{(col.relation && nameMap[col.relation]?.[String(v)]) || <span className="cp-dim">—</span>}</span>
      default:
        return v ? <span>{String(v)}</span> : <span className="cp-dim">—</span>
    }
  }

  if (rows.length === 0) {
    return (
      <div className="cp-empty">
        <Icon name={spec.icon as never} size={34} strokeWidth={1.3} />
        <p>No {spec.title.toLowerCase()} yet</p>
      </div>
    )
  }

  const colSpan = spec.columns.length + 1

  return (
    <div className="cp-table-wrap">
      <table className="cp-table">
        <thead>
          <tr>
            {spec.columns.map((c, ci) => (
              <th key={ci}>{c.label}</th>
            ))}
            <th className="cp-col-actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((rec) => {
            const id = String(rec.id)
            const isOpen = expanded === id
            return (
              <Fragment key={id}>
                <tr
                  className={clsx('cp-row-click', isOpen && 'is-expanded')}
                  onClick={() => setExpanded((cur) => (cur === id ? null : id))}
                  title="Click to view details"
                >
                  {spec.columns.map((c, ci) => (
                    <td key={ci}>{cell(c, rec)}</td>
                  ))}
                  <td className="cp-col-actions">
                    <Icon
                      name="chevron-down"
                      size={14}
                      className="cp-row-caret"
                      style={{ transform: isOpen ? 'rotate(180deg)' : undefined }}
                    />
                    <button
                      className="cp-rowbtn"
                      onClick={(e) => {
                        e.stopPropagation()
                        onEdit(rec)
                      }}
                      title="Edit"
                      aria-label="Edit"
                    >
                      <Icon name="pencil" size={14} />
                    </button>
                    <button
                      className="cp-rowbtn is-danger"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(rec)
                      }}
                      title="Delete"
                      aria-label="Delete"
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="cp-rdetail-row">
                    <td colSpan={colSpan}>
                      <CpDetail spec={spec} rec={rec} onEdit={() => onEdit(rec)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
