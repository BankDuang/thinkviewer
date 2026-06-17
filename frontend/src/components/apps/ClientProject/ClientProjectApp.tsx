import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { AppProps } from '@/types'
import * as api from '@/lib/restClient'
import { notify } from '@/store/notificationStore'
import { useSessionStore } from '@/store/sessionStore'
import { Icon, type IconName } from '@/components/common/Icon'
import { CpProvider } from './CpContext'
import { CrudSection } from './CrudSection'
import { ProjectsHub } from './ProjectsHub'
import { CP_SPECS } from './specs'
import { usePoll } from './usePoll'
import { Dashboard } from './views/Dashboard'
import { Files } from './views/Files'
import { Timeline } from './views/Timeline'
import { Reports } from './views/Reports'
import { CpSettings } from './views/Settings'
import './cp.css'

interface NavItem {
  key: string
  label: string
  icon: IconName
  render: () => JSX.Element
}

const NAV: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'grid', render: () => <Dashboard /> },
  { key: 'clients', label: 'Clients', icon: 'users', render: () => <CrudSection spec={CP_SPECS.clients} /> },
  { key: 'projects', label: 'Projects', icon: 'briefcase', render: () => <ProjectsHub /> },
  { key: 'phases', label: 'Phases', icon: 'list', render: () => <CrudSection spec={CP_SPECS.phases} /> },
  { key: 'requirements', label: 'Requirements', icon: 'list', render: () => <CrudSection spec={CP_SPECS.requirements} /> },
  { key: 'tasks', label: 'Tasks', icon: 'check', render: () => <CrudSection spec={CP_SPECS.tasks} /> },
  { key: 'issues', label: 'Issues / Bugs', icon: 'bug', render: () => <CrudSection spec={CP_SPECS.issues} /> },
  { key: 'change_requests', label: 'Change Requests', icon: 'git-branch', render: () => <CrudSection spec={CP_SPECS.change_requests} /> },
  { key: 'meeting_notes', label: 'Meeting Notes', icon: 'clipboard', render: () => <CrudSection spec={CP_SPECS.meeting_notes} /> },
  { key: 'notes', label: 'Notes', icon: 'pencil', render: () => <CrudSection spec={CP_SPECS.notes} /> },
  { key: 'files', label: 'Files', icon: 'folder', render: () => <Files /> },
  { key: 'timeline', label: 'Timeline', icon: 'signal', render: () => <Timeline /> },
  { key: 'payments', label: 'Payments', icon: 'money', render: () => <CrudSection spec={CP_SPECS.payments} /> },
  { key: 'reports', label: 'Reports', icon: 'chart-bar', render: () => <Reports /> },
  { key: 'settings', label: 'Settings', icon: 'gear', render: () => <CpSettings /> },
]

export function ClientProjectApp(_props: AppProps) {
  const [active, setActive] = useState('dashboard')
  const item = NAV.find((n) => n.key === active) ?? NAV[0]

  // open (not-yet-done) counts per section, shown as highlighted nav badges
  const [open, setOpen] = useState<Record<string, number>>({})
  const username = useSessionStore((s) => s.user?.username)
  const seenActivity = useRef<Set<string> | null>(null) // null until baseline captured

  const refreshCounts = useCallback(() => {
    api
      .cpDashboard()
      .then((d) => {
        const next = {
          requirements: d.requirements_open,
          tasks: d.tasks_open,
          issues: d.issues_open,
          change_requests: d.cr_open,
        }
        setOpen((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))

        // toast when a *teammate* adds something (opt-out in CP Settings).
        const acts = (d.recent_activity ?? []) as Array<Record<string, unknown>>
        if (seenActivity.current === null) {
          seenActivity.current = new Set(acts.map((a) => String(a.id))) // baseline, no toast
        } else {
          const enabled = localStorage.getItem('cpNotify') !== '0'
          for (const a of acts) {
            const id = String(a.id)
            if (seenActivity.current.has(id)) continue
            seenActivity.current.add(id)
            const msg = String(a.message ?? '')
            const actor = String(a.actor ?? '')
            if (enabled && msg.startsWith('created') && actor && actor !== username) {
              const label = msg.includes(': ') ? msg.split(': ').slice(1).join(': ') : String(a.kind ?? '')
              notify('info', `${actor} added ${a.kind}: ${label}`)
            }
          }
        }
      })
      .catch(() => {})
  }, [username])
  // refresh on mount, on section switch, and on a background poll (multi-user sync)
  useEffect(() => refreshCounts(), [refreshCounts, active])
  usePoll(refreshCounts)

  return (
    <CpProvider>
      <div className="cp-root">
        <nav className="cp-sidebar">
          <div className="cp-brand">
            <Icon name="briefcase" size={18} />
            <span>Client Project</span>
          </div>
          <div className="cp-nav">
            {NAV.map((n) => (
              <button
                key={n.key}
                className={clsx('cp-nav-item', active === n.key && 'is-active')}
                onClick={() => setActive(n.key)}
              >
                <Icon name={n.icon} size={16} />
                <span>{n.label}</span>
                {open[n.key] > 0 && <span className="cp-nav-badge">{open[n.key]}</span>}
              </button>
            ))}
          </div>
        </nav>
        <main className="cp-main">{item.render()}</main>
      </div>
    </CpProvider>
  )
}
