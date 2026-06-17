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
  /** hide the Project column (redundant inside a single project's tabs) */
  hideProject?: boolean
}

// sensible ordering for badge columns (severity / priority / status across entities).
// A column only ever holds one enum's values, so overlaps between enums are harmless.
const RANK: Record<string, number> = {
  low: 1, medium: 2, high: 3, urgent: 4, critical: 5,
  open: 1, in_progress: 2, fixed: 3, verified: 4, closed: 5,
  proposed: 1, approved: 2, done: 6,
  requested: 1, rejected: 5,
  todo: 1, doing: 2, blocked: 3,
  not_started: 1, waiting_client: 2,
  planning: 1, active: 2, on_hold: 3, maintenance: 4, delivered: 6, cancelled: 7,
  lead: 1, inactive: 6,
}

export function CpTable({ spec, rows, onEdit, onDelete, onToggle, hideProject }: CpTableProps) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sort, setSort] = useState<{ ci: number; dir: 1 | -1 } | null>(null)
  const { clients, projects } = useCp()
  const nameMap = useMemo(() => {
    const m: Record<string, Record<string, string>> = { clients: {}, projects: {} }
    for (const c of clients) m.clients[String(c.id)] = String(c.name ?? c.id)
    for (const p of projects) m.projects[String(p.id)] = String(p.name ?? p.id)
    return m
  }, [clients, projects])

  // visible columns: optionally drop the project relation column
  const cols = useMemo(
    () => (hideProject ? spec.columns.filter((c) => !(c.type === 'relation' && c.relation === 'projects')) : spec.columns),
    [spec.columns, hideProject],
  )

  const sortVal = (col: CpColumn, rec: CpRecord): number | string => {
    const v = rec[col.key]
    switch (col.type) {
      case 'date':
        return String(v ?? '').slice(0, 10)
      case 'money':
        return Number(v) || 0
      case 'bool':
        return cpBool(v) ? 1 : 0
      case 'check':
        return (col.onValue != null ? String(v) === col.onValue : cpBool(v)) ? 1 : 0
      case 'relation':
        return ((col.relation && nameMap[col.relation]?.[String(v)]) || '').toLowerCase()
      case 'badge':
        return RANK[String(v)] ?? 50 // unknown values sort after the known ones
      default:
        return String(v ?? '').toLowerCase()
    }
  }

  const sortedRows = useMemo(() => {
    if (!sort) return rows
    const col = cols[sort.ci]
    if (!col) return rows
    return [...rows].sort((ra, rb) => {
      const a = sortVal(col, ra)
      const b = sortVal(col, rb)
      return (a < b ? -1 : a > b ? 1 : 0) * sort.dir
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, cols, nameMap])

  const toggleSort = (ci: number) =>
    setSort((s) => (!s || s.ci !== ci ? { ci, dir: 1 } : s.dir === 1 ? { ci, dir: -1 } : null))

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
        return cpBool(v) ? <Icon name="check" size={15} strokeWidth={2.4} /> : <span className="cp-dim">—</span>
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

  const colSpan = cols.length + 1

  return (
    <div className="cp-table-wrap">
      <table className="cp-table">
        <thead>
          <tr>
            {cols.map((c, ci) => (
              <th key={ci} className="cp-th-sort" onClick={() => toggleSort(ci)} title="Sort by this column">
                {c.label}
                {sort?.ci === ci && (
                  <Icon
                    name="chevron-down"
                    size={12}
                    className="cp-sort-caret"
                    style={{ transform: sort.dir === -1 ? 'rotate(180deg)' : undefined }}
                  />
                )}
              </th>
            ))}
            <th className="cp-col-actions" />
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((rec) => {
            const id = String(rec.id)
            const isOpen = expanded === id
            return (
              <Fragment key={id}>
                <tr
                  className={clsx('cp-row-click', isOpen && 'is-expanded')}
                  onClick={() => setExpanded((cur) => (cur === id ? null : id))}
                  title="Click to view details"
                >
                  {cols.map((c, ci) => (
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
