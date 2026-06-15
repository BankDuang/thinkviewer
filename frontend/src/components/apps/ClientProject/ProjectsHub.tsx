import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import clsx from 'clsx'
import type { CpRecord } from '@/types'
import * as api from '@/lib/restClient'
import { notify } from '@/store/notificationStore'
import { Icon } from '@/components/common/Icon'
import { useCp } from './CpContext'
import { CpForm } from './CpForm'
import { ProjectDetail } from './ProjectDetail'
import { ProgressRing } from './Charts'
import { CP_SPECS } from './specs'
import { cpBadgeClass, cpDate, cpLabel, cpMoney, cpProgress } from './cpFormat'

interface Stats {
  progress: number
  tasksDone: number
  tasksTotal: number
  openIssues: number
}

function ProjectCard({
  project,
  stats,
  clientName,
  onOpen,
}: {
  project: CpRecord
  stats: Stats
  clientName: string
  onOpen: () => void
}) {
  const ring = stats.progress >= 100 ? '#30d158' : stats.progress >= 50 ? '#0a84ff' : '#ff9f0a'
  return (
    <motion.button
      layout
      className="cp-pcard"
      onClick={onOpen}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
    >
      <div className="cp-pcard-top">
        <div className="cp-pcard-head">
          <span className="cp-pcard-name">{String(project.name)}</span>
          <span className="cp-pcard-client">
            <Icon name="users" size={12} /> {clientName || '—'}
          </span>
        </div>
        <ProgressRing value={stats.progress} size={56} stroke={6} color={ring} />
      </div>
      <div className="cp-pcard-meta">
        {project.status ? (
          <span className={clsx('cp-badge', cpBadgeClass(project.status))}>{cpLabel(project.status)}</span>
        ) : null}
        {project.server_service ? (
          <span className="cp-chip">
            <Icon name="signal" size={11} /> {String(project.server_service)}
          </span>
        ) : null}
      </div>
      <div className="cp-pcard-foot">
        <span title="Budget">
          <Icon name="money" size={13} /> {cpMoney(project.budget)}
        </span>
        <span title="Deliver date">
          <Icon name="check" size={13} /> {cpDate(project.deliver_date)}
        </span>
      </div>
      <div className="cp-pcard-stats">
        <span>
          <b>{stats.tasksDone}</b>/{stats.tasksTotal} tasks
        </span>
        <span className={stats.openIssues ? 'cp-bad' : undefined}>
          <b>{stats.openIssues}</b> open issues
        </span>
      </div>
    </motion.button>
  )
}

export function ProjectsHub() {
  const { clients, refreshRelations } = useCp()
  const [projects, setProjects] = useState<CpRecord[]>([])
  const [tasks, setTasks] = useState<CpRecord[]>([])
  const [reqs, setReqs] = useState<CpRecord[]>([])
  const [issues, setIssues] = useState<CpRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.cpList('projects'),
      api.cpList('tasks'),
      api.cpList('requirements'),
      api.cpList('issues'),
    ])
      .then(([p, t, r, i]) => {
        setProjects(p.items)
        setTasks(t.items)
        setReqs(r.items)
        setIssues(i.items)
      })
      .catch((e) => notify('error', e instanceof api.ApiError ? e.message : 'Could not load projects'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => load(), [load])

  const clientName = useCallback(
    (id: unknown) => String(clients.find((c) => String(c.id) === String(id))?.name ?? ''),
    [clients],
  )

  const statsFor = useCallback(
    (pid: string): Stats => {
      const t = tasks.filter((x) => String(x.project_id) === pid)
      const r = reqs.filter((x) => String(x.project_id) === pid)
      const openIssues = issues.filter(
        (x) => String(x.project_id) === pid && !['verified', 'closed'].includes(String(x.status)),
      ).length
      return {
        progress: cpProgress(t, r),
        tasksDone: t.filter((x) => String(x.status) === 'done').length,
        tasksTotal: t.length,
        openIssues,
      }
    },
    [tasks, reqs, issues],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return projects
    return projects.filter(
      (p) =>
        String(p.name).toLowerCase().includes(q) || clientName(p.client_id).toLowerCase().includes(q),
    )
  }, [projects, query, clientName])

  if (selected) {
    return (
      <ProjectDetail
        projectId={selected}
        onBack={() => {
          setSelected(null)
          load()
        }}
      />
    )
  }

  return (
    <div className="cp-section">
      <div className="cp-section-head">
        <div className="cp-section-title">
          <Icon name="briefcase" size={18} />
          <span>Projects</span>
          <span className="cp-count">{filtered.length}</span>
        </div>
        <div className="cp-section-actions">
          <div className="cp-search">
            <Icon name="search" size={13} />
            <input value={query} placeholder="Search" spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <button className="tv-btn" onClick={load} title="Refresh" aria-label="Refresh">
            <Icon name="refresh" size={14} className={loading ? 'spin' : undefined} />
          </button>
          <button className="tv-btn tv-btn--primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} />
            New Project
          </button>
        </div>
      </div>

      {loading ? (
        <div className="cp-empty">
          <Icon name="refresh" size={26} className="spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="cp-empty">
          <Icon name="briefcase" size={34} strokeWidth={1.3} />
          <p>No projects yet — create one to start tracking</p>
        </div>
      ) : (
        <div className="cp-pcard-grid">
          <AnimatePresence>
            {filtered.map((p) => (
              <ProjectCard
                key={String(p.id)}
                project={p}
                stats={statsFor(String(p.id))}
                clientName={clientName(p.client_id)}
                onOpen={() => setSelected(String(p.id))}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {creating && (
          <CpForm
            spec={CP_SPECS.projects}
            onClose={() => setCreating(false)}
            onSaved={() => {
              refreshRelations()
              load()
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
