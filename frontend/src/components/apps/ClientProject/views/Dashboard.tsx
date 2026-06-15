import { useState, useEffect } from 'react'
import { useCp } from '../CpContext'
import * as api from '@/lib/restClient'
import { notify } from '@/store/notificationStore'
import { Icon } from '@/components/common/Icon'
import { cpMoney, cpDate, cpLabel, cpBadgeClass, cpRelDate } from '../cpFormat'
import { DonutChart, BarList } from '../Charts'
import type { CpRecord, CpDashboard } from '@/types'

/** Severity buckets in escalating order, each with its own accent color. */
const SEVERITIES: { key: string; color: string }[] = [
  { key: 'low', color: '#30d158' },
  { key: 'medium', color: '#ffd60a' },
  { key: 'high', color: '#ff9f0a' },
  { key: 'critical', color: '#ff453a' },
]

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/**
 * Management overview for the CRM: headline stat cards, distribution charts,
 * upcoming deadlines, critical issues, and a recent-activity timeline.
 */
export function Dashboard() {
  const { clients, projects } = useCp()
  const [data, setData] = useState<CpDashboard | null>(null)
  const [projList, setProjList] = useState<CpRecord[]>([])
  const [issueList, setIssueList] = useState<CpRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    Promise.all([api.cpDashboard(), api.cpList('projects'), api.cpList('issues')])
      .then(([dash, pr, iss]) => {
        if (!alive) return
        setData(dash)
        setProjList(pr.items)
        setIssueList(iss.items)
      })
      .catch((e) => {
        if (!alive) return
        const msg = e instanceof api.ApiError ? e.message : 'Failed to load dashboard'
        setError(msg)
        notify('error', msg)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [reloadKey])

  // Resolve a relation id to a human label from the shared lookups.
  const lookup = (list: CpRecord[], id: unknown): string => {
    if (id == null || id === '') return ''
    const hit = list.find((r) => String(r.id) === String(id))
    return hit ? String(hit.name ?? hit.title ?? hit.id) : ''
  }

  const reload = () => setReloadKey((k) => k + 1)

  const head = (
    <div className="cp-section-head">
      <div className="cp-section-title">
        <Icon name="grid" size={18} /> Dashboard
      </div>
      <button className="tv-btn" onClick={reload} disabled={loading}>
        <Icon name="refresh" size={15} /> Refresh
      </button>
    </div>
  )

  if (loading && !data) {
    return (
      <div className="cp-section">
        {head}
        <div className="cp-empty">
          <Icon name="refresh" size={30} className="spin" />
          <span>Loading overview…</span>
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="cp-section">
        {head}
        <div className="cp-empty">
          <Icon name="x-circle" size={30} />
          <span>{error}</span>
          <button className="tv-btn" onClick={reload}>
            <Icon name="refresh" size={15} /> Retry
          </button>
        </div>
      </div>
    )
  }

  if (!data) return null
  const d = data

  // (1) headline stat cards
  const cards: { label: string; icon: 'users' | 'briefcase' | 'bug' | 'check' | 'money'; value: string; tone: string; sub: string }[] = [
    { label: 'Active Clients', icon: 'users', value: String(d.clients_active), tone: '', sub: `${String(d.clients_total)} total` },
    {
      label: 'Active Projects',
      icon: 'briefcase',
      value: String(d.projects_active),
      tone: '',
      sub: `${String(d.projects_delivered)} delivered`,
    },
    {
      label: 'Open Issues',
      icon: 'bug',
      value: String(d.issues_open),
      tone: d.issues_critical > 0 ? 'is-bad' : '',
      sub: `${String(d.issues_critical)} critical`,
    },
    {
      label: 'Overdue Tasks',
      icon: 'check',
      value: String(d.tasks_overdue),
      tone: d.tasks_overdue > 0 ? 'is-warn' : '',
      sub: `${String(d.tasks_open)} open`,
    },
    { label: 'Total Budget', icon: 'money', value: cpMoney(d.total_budget), tone: '', sub: 'across all projects' },
    {
      label: 'Outstanding',
      icon: 'money',
      value: cpMoney(d.outstanding),
      tone: d.outstanding > 0 ? 'is-bad' : 'is-ok',
      sub: d.outstanding > 0 ? 'unpaid balance' : 'all settled',
    },
  ]

  // (2a) projects grouped by status -> donut slices
  const statusCounts = new Map<string, number>()
  for (const p of projList) {
    const key = String(p.status ?? 'unknown')
    statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1)
  }
  const statusData = Array.from(statusCounts, ([status, count]) => ({
    label: cpLabel(status) || 'unknown',
    value: count,
  }))

  // (2b) issues grouped by severity (fixed escalating order) -> bar list
  const severityData = SEVERITIES.map((s) => ({
    label: cap(s.key),
    value: issueList.filter((i) => String(i.severity).toLowerCase() === s.key).length,
    color: s.color,
  }))

  return (
    <div className="cp-section">
      {head}

      {/* (1) headline stat cards */}
      <div className="cp-cards">
        {cards.map((c) => (
          <div className="cp-card" key={c.label}>
            <div className="cp-card-label">
              <Icon name={c.icon} size={15} /> {c.label}
            </div>
            <div className={`cp-card-value ${c.tone}`.trim()}>{c.value}</div>
            <div className="cp-card-sub">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* (2) distribution charts */}
      <div className="cp-grid-2">
        <div className="cp-panel">
          <div className="cp-panel-title">
            <Icon name="briefcase" size={15} /> Projects by status
          </div>
          {statusData.length ? <DonutChart data={statusData} /> : <div className="cp-dim">No projects yet</div>}
        </div>
        <div className="cp-panel">
          <div className="cp-panel-title">
            <Icon name="bug" size={15} /> Issues by severity
          </div>
          <BarList data={severityData} />
        </div>
      </div>

      {/* (3) upcoming deadlines + critical issues */}
      <div className="cp-grid-2">
        <div className="cp-panel">
          <div className="cp-panel-title">
            <Icon name="clipboard" size={15} /> Upcoming deadlines (14d)
          </div>
          {d.deadlines.length === 0 ? (
            <div className="cp-dim">Nothing due</div>
          ) : (
            <ul className="cp-timeline">
              {d.deadlines.map((row, idx) => {
                const name = String(row.name ?? row.title ?? '') || lookup(projects, row.project_id) || '—'
                const client = lookup(clients, row.client_id)
                return (
                  <li className="cp-tl-item" key={String(row.id ?? idx)}>
                    <span className="cp-tl-dot" />
                    <div className="cp-tl-body">
                      <span className="cp-tl-msg">{client ? `${name} · ${client}` : name}</span>
                      <span className="cp-tl-time">{cpDate(row.deliver_date)}</span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="cp-panel">
          <div className="cp-panel-title">
            <Icon name="alert" size={15} /> Critical issues
          </div>
          {d.critical_issues.length === 0 ? (
            <div className="cp-dim">No critical issues</div>
          ) : (
            <ul className="cp-timeline">
              {d.critical_issues.map((row, idx) => {
                const project = lookup(projects, row.project_id)
                return (
                  <li className="cp-tl-item" key={String(row.id ?? idx)}>
                    <span className="cp-tl-dot" />
                    <div className="cp-tl-body">
                      <span className="cp-tl-msg">
                        {String(row.title ?? row.name ?? '—')}
                        {project && <span className="cp-dim"> · {project}</span>}
                      </span>
                      <span className={`cp-badge ${cpBadgeClass(row.severity)}`}>{cpLabel(row.severity) || '—'}</span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* (4) recent activity timeline */}
      <div className="cp-panel">
        <div className="cp-panel-title">
          <Icon name="list" size={15} /> Recent activity
        </div>
        {d.recent_activity.length === 0 ? (
          <div className="cp-dim">No recent activity</div>
        ) : (
          <div className="cp-timeline">
            {d.recent_activity.map((row, idx) => (
              <div className="cp-tl-item" key={String(row.id ?? idx)}>
                <span className="cp-tl-dot" />
                <div className="cp-tl-body">
                  <div className="cp-tl-msg">{String(row.message ?? row.title ?? row.name ?? '—')}</div>
                  <div className="cp-tl-time">{cpRelDate(row.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
