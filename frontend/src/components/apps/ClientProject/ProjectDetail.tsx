import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import clsx from 'clsx'
import type { CpRecord } from '@/types'
import * as api from '@/lib/restClient'
import { notify } from '@/store/notificationStore'
import { confirmDialog } from '@/store/dialogStore'
import { Icon, type IconName } from '@/components/common/Icon'
import { useCp } from './CpContext'
import { CpForm } from './CpForm'
import { CrudSection } from './CrudSection'
import { RequirementsChecklist } from './RequirementsChecklist'
import { ProgressRing } from './Charts'
import { CP_SPECS } from './specs'
import { usePoll } from './usePoll'
import { cpBadgeClass, cpDate, cpLabel, cpMoney, cpProgress, issueDone } from './cpFormat'

const TABS: { key: string; label: string; icon: IconName }[] = [
  { key: 'overview', label: 'Overview', icon: 'grid' },
  { key: 'requirements', label: 'Requirements', icon: 'list' },
  { key: 'tasks', label: 'Tasks', icon: 'check' },
  { key: 'issues', label: 'Issues', icon: 'bug' },
  { key: 'change_requests', label: 'Change Requests', icon: 'git-branch' },
  { key: 'phases', label: 'Phases', icon: 'list' },
  { key: 'notes', label: 'Notes', icon: 'pencil' },
  { key: 'files', label: 'Files', icon: 'folder' },
]

const IMG_RE = /\.(png|jpe?g|gif|webp|svg)$/i

function ProjectFiles({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<CpRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    setLoading(true)
    api
      .cpList('files', { project_id: projectId })
      .then((r) => setFiles(r.items))
      .finally(() => setLoading(false))
  }, [projectId])
  useEffect(() => load(), [load])

  // forget selections for files that disappeared after a reload
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const ids = new Set(files.map((f) => String(f.id)))
      const next = new Set([...prev].filter((id) => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [files])

  function toggleSel(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setUploading(true)
    try {
      await api.cpUpload(f, { project_id: projectId, category: 'Project file' })
      notify('ok', `Uploaded “${f.name}”`)
      load()
    } catch (err) {
      notify('error', err instanceof api.ApiError ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function del(rec: CpRecord) {
    if (!(await confirmDialog({ title: `Delete “${rec.name}”?`, confirmLabel: 'Delete', danger: true }))) return
    await api.cpDelete('files', String(rec.id)).then(load)
  }

  async function delSelected() {
    const ids = [...selected]
    if (ids.length === 0) return
    const n = ids.length
    const ok = await confirmDialog({
      title: `Delete ${n} file${n > 1 ? 's' : ''}?`,
      message: 'The selected files will be permanently removed.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    const results = await Promise.allSettled(ids.map((id) => api.cpDelete('files', id)))
    const failed = results.filter((r) => r.status === 'rejected').length
    if (failed) notify('error', `${failed} file${failed > 1 ? 's' : ''} could not be deleted`)
    else notify('ok', `Deleted ${n} file${n > 1 ? 's' : ''}`)
    setSelected(new Set())
    load()
  }

  const allSelected = files.length > 0 && selected.size === files.length

  return (
    <div>
      <div className="cp-tab-actions">
        <button className="tv-btn tv-btn--primary" onClick={() => inputRef.current?.click()} disabled={uploading}>
          <Icon name={uploading ? 'refresh' : 'upload'} size={14} className={uploading ? 'spin' : undefined} />
          Upload file
        </button>
        <input ref={inputRef} type="file" style={{ display: 'none' }} onChange={(e) => void onPick(e)} />
        {files.length > 0 && (
          <button
            className="tv-btn"
            onClick={() => setSelected(allSelected ? new Set() : new Set(files.map((f) => String(f.id))))}
          >
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
        )}
        {selected.size > 0 && (
          <div className="cp-sel-bar">
            <span className="cp-sel-count">{selected.size} selected</span>
            <button className="tv-btn" onClick={() => setSelected(new Set())}>
              Clear
            </button>
            <button className="tv-btn cp-sel-del" onClick={() => void delSelected()}>
              <Icon name="trash" size={14} /> Delete selected
            </button>
          </div>
        )}
      </div>
      {loading ? (
        <div className="cp-empty">
          <Icon name="refresh" size={24} className="spin" />
        </div>
      ) : files.length === 0 ? (
        <div className="cp-empty">
          <Icon name="folder" size={30} strokeWidth={1.3} />
          <p>No files for this project</p>
        </div>
      ) : (
        <div className="cp-file-grid">
          {files.map((f) => {
            const id = String(f.id)
            const sel = selected.has(id)
            return (
              <div className={clsx('cp-file', sel && 'is-sel')} key={id}>
                <button
                  className={clsx('cp-file-check', sel && 'is-on')}
                  onClick={() => toggleSel(id)}
                  aria-label={sel ? 'Deselect' : 'Select'}
                  aria-pressed={sel}
                >
                  {sel && <Icon name="check" size={12} strokeWidth={3} />}
                </button>
                {IMG_RE.test(String(f.name)) ? (
                  <img
                    className="cp-file-thumb"
                    src={api.downloadUrl(String(f.path))}
                    alt={String(f.name)}
                    onClick={() => toggleSel(id)}
                  />
                ) : (
                  <div className="cp-file-thumb" onClick={() => toggleSel(id)}>
                    <Icon name="file" size={30} />
                  </div>
                )}
                <div className="cp-file-meta">
                  <a className="cp-file-name" href={api.downloadUrl(String(f.path))} target="_blank" rel="noreferrer">
                    {String(f.name)}
                  </a>
                  <div className="cp-file-row">
                    <span className="cp-dim">{String(f.category || 'file')}</span>
                    <button className="cp-rowbtn is-danger" onClick={() => void del(f)} aria-label="Delete">
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function ProjectDetail({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const { clients, refreshRelations } = useCp()
  const [project, setProject] = useState<CpRecord | null>(null)
  const [tasks, setTasks] = useState<CpRecord[]>([])
  const [reqs, setReqs] = useState<CpRecord[]>([])
  const [issues, setIssues] = useState<CpRecord[]>([])
  const [crs, setCrs] = useState<CpRecord[]>([])
  const [tab, setTab] = useState('overview')
  const [editing, setEditing] = useState(false)

  const headSig = useRef('')
  const loadHead = useCallback(() => {
    Promise.all([
      api.cpList('projects', { id: projectId }),
      api.cpList('tasks', { project_id: projectId }),
      api.cpList('requirements', { project_id: projectId }),
      api.cpList('issues', { project_id: projectId }),
      api.cpList('change_requests', { project_id: projectId }),
    ])
      .then(([p, t, r, i, c]) => {
        // skip all state updates when nothing changed → idle polls don't re-render
        const sig = JSON.stringify([p.items[0] ?? null, t.items, r.items, i.items, c.items])
        if (sig === headSig.current) return
        headSig.current = sig
        setProject(p.items[0] ?? null)
        setTasks(t.items)
        setReqs(r.items)
        setIssues(i.items)
        setCrs(c.items)
      })
      .catch(() => {})
  }, [projectId])
  useEffect(() => loadHead(), [loadHead])
  usePoll(loadHead) // keep the hero + tab badges synced across users

  const progress = cpProgress(tasks, reqs)
  const clientName = String(clients.find((c) => String(c.id) === String(project?.client_id))?.name ?? '—')
  const openIssues = issues.filter((x) => !issueDone(x)).length // not yet fixed & confirmed
  // count of not-yet-done cases per tab (shown as a highlighted badge)
  const tabOpen: Record<string, number> = {
    requirements: reqs.filter((r) => String(r.status) !== 'done').length,
    tasks: tasks.filter((t) => String(t.status) !== 'done').length,
    issues: openIssues,
    change_requests: crs.filter((c) => !['done', 'rejected'].includes(String(c.status))).length,
  }

  if (!project) {
    return (
      <div className="cp-empty">
        <Icon name="refresh" size={26} className="spin" />
      </div>
    )
  }

  const meta: { icon: IconName; label: string; value: string }[] = [
    { icon: 'money', label: 'Budget', value: cpMoney(project.budget) },
    { icon: 'check', label: 'Deliver', value: cpDate(project.deliver_date) },
    { icon: 'users', label: 'Owner', value: String(project.owner || '—') },
    { icon: 'signal', label: 'Server', value: String(project.server_service || '—') },
    { icon: 'lock', label: 'Domain', value: String(project.domain || '—') },
    { icon: 'git-branch', label: 'Repo', value: String(project.repository || '—') },
  ]

  return (
    <div className="cp-detail">
      <div className="cp-detail-head">
        <button className="cp-back" onClick={onBack}>
          <Icon name="chevron-left" size={16} /> Projects
        </button>
        <button className="tv-btn" onClick={() => setEditing(true)}>
          <Icon name="pencil" size={13} /> Edit
        </button>
      </div>

      <div className="cp-detail-hero">
        <ProgressRing value={progress} size={92} stroke={9} color={progress >= 100 ? '#30d158' : '#0a84ff'} />
        <div className="cp-detail-info">
          <div className="cp-detail-title">
            {String(project.name)}
            <span className={clsx('cp-badge', cpBadgeClass(project.status))}>{cpLabel(project.status)}</span>
          </div>
          <div className="cp-detail-client">
            <Icon name="users" size={13} /> {clientName}
          </div>
          <div className="cp-detail-metrics">
            <span>
              <b>{tasks.filter((t) => String(t.status) === 'done').length}</b>/{tasks.length} tasks done
            </span>
            <span className={openIssues ? 'cp-bad' : undefined}>
              <b>{openIssues}</b> open issues
            </span>
            <span>
              <b>{reqs.length}</b> requirements
            </span>
          </div>
        </div>
      </div>

      <div className="cp-meta-grid">
        {meta.map((m) => (
          <div className="cp-meta-item" key={m.label}>
            <span className="cp-meta-label">
              <Icon name={m.icon} size={12} /> {m.label}
            </span>
            <span className="cp-meta-value">{m.value}</span>
          </div>
        ))}
      </div>

      <div className="cp-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={clsx('cp-tab', tab === t.key && 'is-active')} onClick={() => setTab(t.key)}>
            <Icon name={t.icon} size={14} />
            {t.label}
            {tabOpen[t.key] > 0 && <span className="cp-count-badge">{tabOpen[t.key]}</span>}
          </button>
        ))}
      </div>

      <div className="cp-tab-body">
        {tab === 'overview' && (
          <div className="cp-grid-2">
            <div className="cp-panel">
              <div className="cp-panel-title">Scope</div>
              <div className="cp-prose">{String(project.scope || '—')}</div>
            </div>
            <div className="cp-panel">
              <div className="cp-panel-title">Notes</div>
              <div className="cp-prose">{String(project.notes || '—')}</div>
            </div>
            <div className="cp-panel">
              <div className="cp-panel-title">Tech stack</div>
              <div className="cp-prose">{String(project.tech_stack || '—')}</div>
            </div>
            <div className="cp-panel">
              <div className="cp-panel-title">Timeline</div>
              <div className="cp-prose">
                Start {cpDate(project.start_date)} → Deliver {cpDate(project.deliver_date)}
              </div>
            </div>
          </div>
        )}
        {tab === 'requirements' && <RequirementsChecklist projectId={projectId} onChange={loadHead} />}
        {tab === 'tasks' && (
          <CrudSection spec={CP_SPECS.tasks} fixedFilter={{ project_id: projectId }} onChange={loadHead} />
        )}
        {tab === 'issues' && (
          <CrudSection spec={CP_SPECS.issues} fixedFilter={{ project_id: projectId }} onChange={loadHead} />
        )}
        {tab === 'change_requests' && (
          <CrudSection spec={CP_SPECS.change_requests} fixedFilter={{ project_id: projectId }} onChange={loadHead} />
        )}
        {tab === 'phases' && <CrudSection spec={CP_SPECS.phases} fixedFilter={{ project_id: projectId }} />}
        {tab === 'notes' && <CrudSection spec={CP_SPECS.notes} fixedFilter={{ project_id: projectId }} />}
        {tab === 'files' && <ProjectFiles projectId={projectId} />}
      </div>

      <AnimatePresence>
        {editing && (
          <CpForm
            spec={CP_SPECS.projects}
            initial={project}
            onClose={() => setEditing(false)}
            onSaved={() => {
              refreshRelations()
              loadHead()
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
