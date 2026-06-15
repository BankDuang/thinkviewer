import { useState } from 'react'
import clsx from 'clsx'
import type { AppProps } from '@/types'
import { Icon, type IconName } from '@/components/common/Icon'
import { CpProvider } from './CpContext'
import { CrudSection } from './CrudSection'
import { ProjectsHub } from './ProjectsHub'
import { CP_SPECS } from './specs'
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
              </button>
            ))}
          </div>
        </nav>
        <main className="cp-main">{item.render()}</main>
      </div>
    </CpProvider>
  )
}
