import { useState } from 'react'
import { motion } from 'framer-motion'
import clsx from 'clsx'
import type { ManagedService } from '@/types'
import * as api from '@/lib/restClient'
import { notify } from '@/store/notificationStore'
import { confirmDialog } from '@/store/dialogStore'
import { useTerminalStore } from '@/store/terminalStore'
import { openApp } from '@/lib/openApp'
import { formatDate } from '@/lib/format'
import { Icon } from '@/components/common/Icon'

type Action = 'start' | 'stop' | 'restart' | 'delete' | 'pull'
type Status = 'running' | 'starting' | 'stopped'

interface ServerCardProps {
  service: ManagedService
  onPatch: (service: ManagedService) => void
  onDeleted: (id: string) => void
  onEdit: (service: ManagedService) => void
  onViewLogs: (service: ManagedService) => void
  onPublish: (service: ManagedService) => void
  onSetupEnv: (service: ManagedService) => void
}

/** 90 -> "1m 30s", 3700 -> "1h 1m". */
function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (s < 3600) return `${m}m ${s % 60}s`
  const h = Math.floor(s / 3600)
  if (s < 86400) return `${h}h ${m % 60}m`
  const d = Math.floor(s / 86400)
  return `${d}d ${h % 24}h`
}

function basename(p: string): string {
  return p.split('/').filter(Boolean).pop() ?? p
}

function statusOf(s: ManagedService): Status {
  if (!s.running) return 'stopped'
  if (s.port != null && s.port_open === false) return 'starting'
  return 'running'
}

function PlayGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13a1 1 0 0 0 1.54.84l10-6.5a1 1 0 0 0 0-1.68l-10-6.5A1 1 0 0 0 8 5.5z" />
    </svg>
  )
}

function StopGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
    </svg>
  )
}

export function ServerCard({
  service,
  onPatch,
  onDeleted,
  onEdit,
  onViewLogs,
  onPublish,
  onSetupEnv,
}: ServerCardProps) {
  const [busy, setBusy] = useState<Action | null>(null)
  const status = statusOf(service)
  const running = service.running

  async function run(action: Exclude<Action, 'delete'>, fn: () => Promise<ManagedService>) {
    if (busy) return
    setBusy(action)
    try {
      onPatch(await fn())
    } catch (e) {
      notify('error', e instanceof api.ApiError ? e.message : `Could not ${action} service`)
    } finally {
      setBusy(null)
    }
  }

  async function onDelete() {
    if (busy) return
    const ok = await confirmDialog({
      title: `Delete “${service.name}”?`,
      message: running
        ? 'The service is running and will be stopped, then removed from the manager.'
        : 'This service will be removed from the manager.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    setBusy('delete')
    try {
      await api.deleteServer(service.id)
      notify('ok', `Removed “${service.name}”`)
      onDeleted(service.id)
    } catch (e) {
      notify('error', e instanceof api.ApiError ? e.message : 'Could not delete service')
      setBusy(null)
    }
  }

  async function onPull() {
    if (busy) return
    setBusy('pull')
    try {
      const res = await api.gitPull(service.id)
      onPatch(res.service)
      // git writes the diffstat to stdout but the fetch banner to stderr (which
      // lands last in the combined output), so don't just take the final line —
      // pick the most informative one. Full output is in the service log.
      const lines = res.output.split('\n').map((l) => l.trim()).filter(Boolean)
      const summary =
        lines.find((l) => /already up to date/i.test(l)) ??
        lines.find((l) => /changed|insertion|deletion/i.test(l)) ??
        lines.find((l) => /^updating |fast-forward/i.test(l)) ??
        lines[lines.length - 1] ??
        (res.ok ? 'Up to date' : 'git pull failed')
      if (!res.ok) {
        notify('error', `Pull failed: ${summary} — see View logs`)
      } else if (res.restart_error) {
        notify('warn', `Pulled, but restart failed: ${res.restart_error}`)
      } else if (res.restarted) {
        notify('ok', `Pulled & restarted — ${summary}`)
      } else {
        notify('ok', `Pulled — ${summary}`)
      }
    } catch (e) {
      notify('error', e instanceof api.ApiError ? e.message : 'Could not pull from GitHub')
    } finally {
      setBusy(null)
    }
  }

  function onOpenTerminal() {
    // Hand the project off to the Terminal app: it focuses a tab named after the
    // service if one is already open, otherwise spawns one cd'd into the project
    // ROOT (service.cwd may be a run subfolder like <root>/server).
    useTerminalStore.getState().requestOpen(service.name, service.root)
    openApp('terminal')
  }

  const spin = (a: Action) => (busy === a ? <Icon name="refresh" size={15} className="spin" /> : null)
  const interp = service.python ? basename(service.python) : 'default'
  const isVenv = service.python.includes('/.venv/')
  const portLinkable = running && service.port != null && service.port_open === true

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className={clsx('srv-card', running && 'is-running')}
    >
      <div className="srv-status">
        <span className={clsx('srv-dot', `is-${status}`)} />
      </div>

      <div className="srv-card-main">
        <div className="srv-name-row">
          <span className="srv-name">{service.name}</span>
          <span className={clsx('srv-state-label', `is-${status}`)}>
            {status === 'running' ? 'Running' : status === 'starting' ? 'Starting' : 'Stopped'}
          </span>
          {!running && service.exit_code != null && (
            <span className="srv-exit">exited (code {service.exit_code})</span>
          )}
          {service.domain && (
            <span className={clsx('srv-domain', service.https && 'is-secure')}>
              <Icon name="lock" size={11} strokeWidth={2.1} />
              {service.https ? (
                <a
                  className="srv-domain-link"
                  href={`https://${service.domain}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {service.domain}
                </a>
              ) : (
                <span className="srv-domain-text">{service.domain}</span>
              )}
              {service.https ? (
                <span className="srv-https-badge">HTTPS</span>
              ) : (
                <span className="srv-domain-hint">not secured</span>
              )}
            </span>
          )}
        </div>

        <div className="srv-meta">
          <span className="srv-meta-item" title={service.cwd}>
            <Icon name="folder" size={13} strokeWidth={1.8} />
            <span className="srv-mono">{basename(service.cwd)}</span>
          </span>
          <span className="srv-meta-item" title="Entry file">
            <Icon name="file" size={13} strokeWidth={1.8} />
            <span className="srv-mono">{service.entry}</span>
          </span>
          <span className="srv-meta-item" title={service.python || 'Default interpreter'}>
            <Icon name="terminal" size={13} strokeWidth={1.8} />
            <span className="srv-mono">{interp}</span>
            {isVenv && <span className="srv-venv-chip">venv</span>}
          </span>
          {service.port != null && (
            <span className="srv-meta-item" title="Port">
              <Icon name="signal" size={13} strokeWidth={1.8} />
              {portLinkable ? (
                <a
                  className="srv-port-link"
                  href={`http://localhost:${service.port}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  :{service.port}
                </a>
              ) : (
                <span className="srv-mono">:{service.port}</span>
              )}
            </span>
          )}
          {running && service.pid != null && (
            <span className="srv-meta-item" title="Process ID">
              <span className="srv-mono">pid {service.pid}</span>
            </span>
          )}
          {running && service.uptime != null && (
            <span className="srv-meta-item" title={service.started_at ? formatDate(service.started_at) : 'Uptime'}>
              {formatUptime(service.uptime)}
            </span>
          )}
        </div>
      </div>

      <div className="srv-actions">
        {running ? (
          <button
            className="srv-iconbtn is-stop"
            onClick={() => void run('stop', () => api.stopServer(service.id))}
            disabled={busy != null}
            title="Stop"
            aria-label="Stop"
          >
            {spin('stop') ?? <StopGlyph />}
          </button>
        ) : (
          <button
            className="srv-iconbtn is-start"
            onClick={() => void run('start', () => api.startServer(service.id))}
            disabled={busy != null}
            title="Start"
            aria-label="Start"
          >
            {spin('start') ?? <PlayGlyph />}
          </button>
        )}
        <button
          className="srv-iconbtn"
          onClick={() => void run('restart', () => api.restartServer(service.id))}
          disabled={busy != null}
          title="Restart"
          aria-label="Restart"
        >
          {spin('restart') ?? <Icon name="refresh" size={16} />}
        </button>
        <button
          className="srv-iconbtn"
          onClick={() => void onPull()}
          disabled={busy != null}
          title="Pull from GitHub (git pull, then restart if running)"
          aria-label="Pull from GitHub"
        >
          {spin('pull') ?? <Icon name="git-branch" size={16} />}
        </button>
        <button
          className="srv-iconbtn"
          onClick={onOpenTerminal}
          disabled={busy != null}
          title="Open in Terminal (cd into the project)"
          aria-label="Open in Terminal"
        >
          <Icon name="terminal" size={16} />
        </button>
        <button
          className="srv-iconbtn"
          onClick={() => onViewLogs(service)}
          disabled={busy != null}
          title="View logs"
          aria-label="View logs"
        >
          <Icon name="file" size={16} />
        </button>
        <button
          className={clsx('srv-iconbtn', service.https && 'is-secure')}
          onClick={() => onPublish(service)}
          disabled={busy != null}
          title="Publish / HTTPS"
          aria-label="Publish / HTTPS"
        >
          <Icon name="lock" size={16} />
        </button>
        <button
          className="srv-iconbtn"
          onClick={() => onSetupEnv(service)}
          disabled={busy != null}
          title="Set up environment"
          aria-label="Set up environment"
        >
          <Icon name="download" size={16} />
        </button>
        <button
          className="srv-iconbtn"
          onClick={() => onEdit(service)}
          disabled={busy != null}
          title="Edit"
          aria-label="Edit"
        >
          <Icon name="sliders" size={16} />
        </button>
        <button
          className="srv-iconbtn is-danger"
          onClick={() => void onDelete()}
          disabled={busy != null}
          title="Delete"
          aria-label="Delete"
        >
          {spin('delete') ?? <Icon name="trash" size={16} />}
        </button>
      </div>
    </motion.div>
  )
}
