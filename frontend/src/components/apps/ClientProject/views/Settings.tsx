import { useEffect, useState } from 'react'
import * as api from '@/lib/restClient'
import { notify } from '@/store/notificationStore'
import { Icon } from '@/components/common/Icon'
import type { IconName } from '@/components/common/Icon'

// Read-only "About / Settings" view for the Software-House CRM. It surfaces a
// short description, a live count of the core entities, and a few usage tips.
// Nothing here mutates data — destructive actions live in their own sections.

interface OverviewCard {
  entity: string
  label: string
  icon: IconName
}

const OVERVIEW: OverviewCard[] = [
  { entity: 'clients', label: 'Clients', icon: 'users' },
  { entity: 'projects', label: 'Projects', icon: 'briefcase' },
  { entity: 'issues', label: 'Issues', icon: 'bug' },
  { entity: 'payments', label: 'Payments', icon: 'money' },
]

const MANAGED = [
  'clients',
  'projects',
  'phases',
  'tasks',
  'issues',
  'change requests',
  'meeting notes',
  'requirements',
  'files',
  'payments',
]

export function CpSettings() {
  const [counts, setCounts] = useState<Record<string, number> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    Promise.all(OVERVIEW.map((c) => api.cpList(c.entity)))
      .then((results) => {
        if (!alive) return
        const next: Record<string, number> = {}
        OVERVIEW.forEach((c, i) => {
          next[c.entity] = results[i].items.length
        })
        setCounts(next)
      })
      .catch((e) => {
        if (!alive) return
        const msg = e instanceof api.ApiError ? e.message : 'Could not load overview'
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

  return (
    <div className="cp-section">
      <div className="cp-section-head">
        <div className="cp-section-title">
          <Icon name="gear" size={18} />
          <span>Settings</span>
        </div>
      </div>

      <div className="cp-panel">
        <div className="cp-panel-title">
          <Icon name="info" size={15} />
          <span>About</span>
        </div>
        <p className="cp-dim">
          Client Project is a Software-House CRM for running client engagements end to end. Manage{' '}
          {MANAGED.join(', ')} from a single workspace.
        </p>
        <p className="cp-dim">
          All records are stored locally in the ThinkViewer database — nothing is sent to a third
          party. Each section is a self-contained list you can search, create, edit, and archive.
        </p>
      </div>

      <div className="cp-panel">
        <div className="cp-panel-title">
          <Icon name="chart-bar" size={15} />
          <span>Overview</span>
        </div>
        {loading ? (
          <div className="cp-empty">
            <Icon name="refresh" size={26} className="spin" />
          </div>
        ) : error ? (
          <div className="cp-empty">
            <Icon name="x-circle" size={22} />
            <span>{error}</span>
          </div>
        ) : (
          <div className="cp-cards">
            {OVERVIEW.map((c) => (
              <div className="cp-card" key={c.entity}>
                <div className="cp-card-label">
                  <Icon name={c.icon} size={13} />
                  <span>{c.label}</span>
                </div>
                <div className="cp-card-value">{String(counts?.[c.entity] ?? 0)}</div>
                <div className="cp-card-sub">total records</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="cp-panel">
        <div className="cp-panel-title">
          <Icon name="check" size={15} />
          <span>Tips</span>
        </div>
        <ul className="cp-dim">
          <li>Double-click any row in a list to open it for editing.</li>
          <li>
            Link a project to a running app via the Projects form&rsquo;s &ldquo;Linked
            server&rdquo; field to track it alongside the Servers app.
          </li>
          <li>Attach screenshots, contracts, and assets to a project or issue in Files.</li>
          <li>Use the Timeline and Reports views to review recent activity and budgets.</li>
        </ul>
      </div>
    </div>
  )
}
