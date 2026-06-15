import { useEffect, useState } from 'react'
import { useCp } from '../CpContext'
import * as api from '@/lib/restClient'
import { notify } from '@/store/notificationStore'
import { Icon } from '@/components/common/Icon'
import { cpMoney, cpDate, cpBool, cpLabel, cpBadgeClass } from '../cpFormat'
import { DonutChart, BarList, CP_PALETTE } from '../Charts'
import type { CpRecord, CpDashboard } from '@/types'

// Brand colors for the recurring project lifecycle states (falls back to palette).
const STATUS_COLORS: Record<string, string> = {
  planning: '#64d2ff',
  active: '#0a84ff',
  on_hold: '#ff9f0a',
  delivered: '#30d158',
  maintenance: '#bf5af2',
  cancelled: '#ff453a',
}

const SEVERITY: { key: string; color: string }[] = [
  { key: 'low', color: '#30d158' },
  { key: 'medium', color: '#ffd60a' },
  { key: 'high', color: '#ff9f0a' },
  { key: 'critical', color: '#ff453a' },
]

const TASK_STATES: { key: string; color: string }[] = [
  { key: 'todo', color: '#8a8a96' },
  { key: 'doing', color: '#0a84ff' },
  { key: 'blocked', color: '#ff453a' },
  { key: 'done', color: '#30d158' },
]

const num = (v: unknown): number => Number(v) || 0

/** Read-only management report: budget vs. collected, project & payment mix,
 *  issue / task breakdowns, and a full project ledger. */
export function Reports() {
  const { clients } = useCp()
  const [dash, setDash] = useState<CpDashboard | null>(null)
  const [projects, setProjects] = useState<CpRecord[]>([])
  const [payments, setPayments] = useState<CpRecord[]>([])
  const [issues, setIssues] = useState<CpRecord[]>([])
  const [tasks, setTasks] = useState<CpRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    Promise.all([
      api.cpDashboard(),
      api.cpList('projects'),
      api.cpList('payments'),
      api.cpList('issues'),
      api.cpList('tasks'),
    ])
      .then(([d, p, pay, iss, tsk]) => {
        if (!alive) return
        setDash(d)
        setProjects(p.items)
        setPayments(pay.items)
        setIssues(iss.items)
        setTasks(tsk.items)
      })
      .catch((e) => {
        if (!alive) return
        const msg = e instanceof api.ApiError ? e.message : 'Could not load reports'
        setError(msg)
        notify('error', msg)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const head = (
    <div className="cp-section-head">
      <div className="cp-section-title">
        <Icon name="chart-bar" size={18} />
        <span>Reports</span>
      </div>
    </div>
  )

  if (loading) {
    return (
      <div className="cp-section">
        {head}
        <div className="cp-empty">
          <Icon name="refresh" size={26} className="spin" />
          <span>Compiling report…</span>
        </div>
      </div>
    )
  }

  if (error || !dash) {
    return (
      <div className="cp-section">
        {head}
        <div className="cp-empty">
          <Icon name="alert" size={26} />
          <span>{error || 'No report data available.'}</span>
        </div>
      </div>
    )
  }

  // --- Money roll-up from payments (Number(x)||0 guards bad/blank cells) ---
  let collected = 0
  let outstanding = 0
  let paidCount = 0
  let unpaidCount = 0
  for (const p of payments) {
    const amt = num(p.amount)
    if (cpBool(p.paid)) {
      collected += amt
      paidCount += 1
    } else {
      outstanding += amt
      unpaidCount += 1
    }
  }

  // --- Projects grouped by status, busiest first ---
  const statusCounts = new Map<string, number>()
  for (const p of projects) {
    const s = String(p.status ?? 'unknown')
    statusCounts.set(s, (statusCounts.get(s) ?? 0) + 1)
  }
  const projectSlices = [...statusCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([status, value], i) => ({
      label: cpLabel(status) || 'unknown',
      value,
      color: STATUS_COLORS[status] ?? CP_PALETTE[i % CP_PALETTE.length],
    }))

  const paymentSlices = [
    { label: 'Paid', value: paidCount, color: '#30d158' },
    { label: 'Unpaid', value: unpaidCount, color: '#ff9f0a' },
  ]

  const issueData = SEVERITY.map((s) => ({
    label: cpLabel(s.key),
    value: issues.filter((it) => String(it.severity).toLowerCase() === s.key).length,
    color: s.color,
  }))

  const taskData = TASK_STATES.map((s) => ({
    label: cpLabel(s.key),
    value: tasks.filter((t) => String(t.status).toLowerCase() === s.key).length,
    color: s.color,
  }))

  const clientName = (id: unknown): string => {
    if (id == null || id === '') return ''
    const hit = clients.find((c) => String(c.id) === String(id))
    return hit ? String(hit.name ?? hit.id) : ''
  }

  const isEmpty = !projects.length && !payments.length && !issues.length && !tasks.length

  return (
    <div className="cp-section">
      {head}

      {isEmpty ? (
        <div className="cp-empty">
          <Icon name="chart-bar" size={26} />
          <span>Nothing to report yet — add projects, payments, issues, or tasks.</span>
        </div>
      ) : (
        <>
          {/* (1) Financial + delivery summary */}
          <div className="cp-cards">
            <div className="cp-card">
              <div className="cp-card-label">
                <Icon name="money" size={14} /> Total Budget
              </div>
              <div className="cp-card-value">{cpMoney(dash.total_budget)}</div>
              <div className="cp-card-sub">across all projects</div>
            </div>

            <div className="cp-card">
              <div className="cp-card-label">
                <Icon name="check" size={14} /> Collected
              </div>
              <div className="cp-card-value is-ok">{cpMoney(collected)}</div>
              <div className="cp-card-sub">{String(paidCount)} paid invoices</div>
            </div>

            <div className="cp-card">
              <div className="cp-card-label">
                <Icon name="money" size={14} /> Outstanding
              </div>
              <div className={'cp-card-value' + (outstanding > 0 ? ' is-bad' : '')}>
                {cpMoney(outstanding)}
              </div>
              <div className="cp-card-sub">{String(unpaidCount)} unpaid invoices</div>
            </div>

            <div className="cp-card">
              <div className="cp-card-label">
                <Icon name="briefcase" size={14} /> Active Projects
              </div>
              <div className="cp-card-value">{String(dash.projects_active)}</div>
              <div className="cp-card-sub">{String(dash.projects_total)} total</div>
            </div>

            <div className="cp-card">
              <div className="cp-card-label">
                <Icon name="archive" size={14} /> Delivered Projects
              </div>
              <div className="cp-card-value is-ok">{String(dash.projects_delivered)}</div>
              <div className="cp-card-sub">shipped to client</div>
            </div>
          </div>

          {/* (2) Project mix + payment mix */}
          <div className="cp-grid-2">
            <div className="cp-panel">
              <div className="cp-panel-title">
                <Icon name="briefcase" size={15} /> Projects by status
              </div>
              <DonutChart data={projectSlices} />
            </div>

            <div className="cp-panel">
              <div className="cp-panel-title">
                <Icon name="money" size={15} /> Payments
              </div>
              <DonutChart data={paymentSlices} />
              <div className="cp-dim" style={{ marginTop: 8 }}>
                Paid <span className="cp-mono">{cpMoney(collected)}</span> · Unpaid{' '}
                <span className="cp-mono">{cpMoney(outstanding)}</span>
              </div>
            </div>
          </div>

          {/* (3) Issue + task breakdowns */}
          <div className="cp-grid-2">
            <div className="cp-panel">
              <div className="cp-panel-title">
                <Icon name="bug" size={15} /> Issues by severity
              </div>
              <BarList data={issueData} />
            </div>

            <div className="cp-panel">
              <div className="cp-panel-title">
                <Icon name="check" size={15} /> Tasks by status
              </div>
              <BarList data={taskData} />
            </div>
          </div>

          {/* (4) Full project ledger */}
          <div className="cp-panel">
            <div className="cp-panel-title">
              <Icon name="list" size={15} /> Projects
            </div>
            {projects.length === 0 ? (
              <div className="cp-empty">
                <span className="cp-dim">No projects to report.</span>
              </div>
            ) : (
              <div className="cp-table-wrap">
                <table className="cp-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Status</th>
                      <th>Budget</th>
                      <th>Deliver date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((p) => {
                      const client = clientName(p.client_id)
                      return (
                        <tr key={String(p.id)}>
                          <td>
                            {String(p.name ?? '—')}
                            {client && <div className="cp-dim">{client}</div>}
                          </td>
                          <td>
                            {p.status ? (
                              <span className={'cp-badge ' + cpBadgeClass(p.status)}>
                                {cpLabel(p.status)}
                              </span>
                            ) : (
                              <span className="cp-dim">—</span>
                            )}
                          </td>
                          <td className="cp-mono">{cpMoney(p.budget)}</td>
                          <td className="cp-mono">{cpDate(p.deliver_date)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
