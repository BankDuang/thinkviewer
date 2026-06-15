import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import type { AppProps, ManagedService } from '@/types'
import * as api from '@/lib/restClient'
import { notify } from '@/store/notificationStore'
import { Icon } from '@/components/common/Icon'
import { ServerCard } from './ServerCard'
import { AddServerDialog } from './AddServerDialog'
import { LogViewer } from './LogViewer'
import { DeployDialog } from './DeployDialog'
import { SetupEnvDialog } from './SetupEnvDialog'
import './servers.css'

type DialogState = { mode: 'add' } | { mode: 'edit'; service: ManagedService }

const POLL_MS = 3000

export function ServersApp({ focused }: AppProps) {
  const [services, setServices] = useState<ManagedService[]>([])
  const [baseDir, setBaseDir] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [logService, setLogService] = useState<ManagedService | null>(null)
  const [deployService, setDeployService] = useState<ManagedService | null>(null)
  const [setupService, setSetupService] = useState<ManagedService | null>(null)

  const [editingBaseDir, setEditingBaseDir] = useState(false)
  const [baseDirDraft, setBaseDirDraft] = useState('')

  const inFlight = useRef(false)
  const mounted = useRef(true)
  const skipBaseDirCommit = useRef(false)

  const fetchServers = useCallback(async (opts?: { silent?: boolean }) => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const resp = await api.getServers()
      if (!mounted.current) return
      setServices(resp.services)
      setBaseDir(resp.base_dir)
      setError(null)
    } catch (e) {
      if (!mounted.current || opts?.silent) return
      setError(e instanceof api.ApiError ? e.message : 'Could not load servers')
    } finally {
      inFlight.current = false
      if (mounted.current && !opts?.silent) setLoading(false)
    }
  }, [])

  // Initial load.
  useEffect(() => {
    mounted.current = true
    void fetchServers()
    return () => {
      mounted.current = false
    }
  }, [fetchServers])

  // Background polling (paused when the window is not focused).
  useEffect(() => {
    if (!focused) return
    const timer = window.setInterval(() => void fetchServers({ silent: true }), POLL_MS)
    return () => window.clearInterval(timer)
  }, [focused, fetchServers])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await fetchServers({ silent: true })
    if (mounted.current) setRefreshing(false)
  }, [fetchServers])

  const patchService = useCallback((updated: ManagedService) => {
    setServices((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
  }, [])

  const removeService = useCallback((id: string) => {
    setServices((prev) => prev.filter((s) => s.id !== id))
  }, [])

  // --- base dir editing -----------------------------------------------------
  const startEditBaseDir = () => {
    setBaseDirDraft(baseDir)
    setEditingBaseDir(true)
  }

  const commitBaseDir = async () => {
    setEditingBaseDir(false)
    if (skipBaseDirCommit.current) {
      skipBaseDirCommit.current = false
      return
    }
    const next = baseDirDraft.trim()
    if (!next || next === baseDir) return
    try {
      const resp = await api.setServersBaseDir(next)
      setBaseDir(resp.base_dir)
      notify('ok', 'Base directory updated')
      void fetchServers({ silent: true })
    } catch (e) {
      notify('error', e instanceof api.ApiError ? e.message : 'Could not set base directory')
    }
  }

  const showEmpty = !loading && !error && services.length === 0
  const showError = !loading && !!error && services.length === 0

  return (
    <div className="srv-root">
      <header className="srv-header">
        <div className="srv-header-left">
          <span className="srv-title">Servers</span>
          {editingBaseDir ? (
            <div className="srv-basedir-edit">
              <input
                className="tv-field srv-basedir-input"
                value={baseDirDraft}
                spellCheck={false}
                autoFocus
                onChange={(e) => setBaseDirDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  else if (e.key === 'Escape') {
                    skipBaseDirCommit.current = true
                    e.currentTarget.blur()
                  }
                }}
                onBlur={() => void commitBaseDir()}
              />
            </div>
          ) : (
            <button
              className="srv-basedir"
              onClick={startEditBaseDir}
              title="Click to change the base directory"
            >
              <Icon name="folder" size={12} strokeWidth={1.8} />
              <span className="srv-basedir-path">{baseDir || 'Loading…'}</span>
            </button>
          )}
        </div>

        <div className="srv-spacer" />

        <div className="srv-header-actions">
          <button className="tv-btn" onClick={() => void refresh()} disabled={refreshing}>
            <Icon name="refresh" size={15} className={refreshing ? 'spin' : undefined} />
            Refresh
          </button>
          <button className="tv-btn tv-btn--primary" onClick={() => setDialog({ mode: 'add' })}>
            <Icon name="plus" size={15} />
            Add Server
          </button>
        </div>
      </header>

      {loading ? (
        <div className="srv-state">
          <Icon name="refresh" size={26} className="spin" />
          <div className="srv-state-sub">Loading servers…</div>
        </div>
      ) : showError ? (
        <div className="srv-state">
          <div className="srv-state-icon">
            <Icon name="alert" size={26} />
          </div>
          <div className="srv-state-title">Couldn’t load servers</div>
          <div className="srv-state-sub">{error}</div>
          <button className="tv-btn" onClick={() => void fetchServers()}>
            <Icon name="refresh" size={15} />
            Try again
          </button>
        </div>
      ) : showEmpty ? (
        <div className="srv-state">
          <div className="srv-state-icon">
            <Icon name="signal" size={26} />
          </div>
          <div className="srv-state-title">No servers configured yet</div>
          <div className="srv-state-sub">
            Add a Python app from <code>{baseDir || '~/Desktop/public_server'}</code> to start,
            stop and monitor it from here.
          </div>
          <button className="tv-btn tv-btn--primary" onClick={() => setDialog({ mode: 'add' })}>
            <Icon name="plus" size={15} />
            Add Server
          </button>
        </div>
      ) : (
        <div className="srv-body">
          <div className="srv-list">
            <AnimatePresence initial={false}>
              {services.map((s) => (
                <ServerCard
                  key={s.id}
                  service={s}
                  onPatch={patchService}
                  onDeleted={removeService}
                  onEdit={(svc) => setDialog({ mode: 'edit', service: svc })}
                  onViewLogs={(svc) => setLogService(svc)}
                  onPublish={(svc) => setDeployService(svc)}
                  onSetupEnv={(svc) => setSetupService(svc)}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      <AnimatePresence>
        {dialog && (
          <AddServerDialog
            key={dialog.mode === 'edit' ? `edit-${dialog.service.id}` : 'add'}
            mode={dialog.mode}
            service={dialog.mode === 'edit' ? dialog.service : undefined}
            onClose={() => setDialog(null)}
            onSaved={() => void fetchServers({ silent: true })}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {logService && (
          <LogViewer
            key={logService.id}
            service={logService}
            onClose={() => setLogService(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deployService && (
          <DeployDialog
            key={deployService.id}
            service={deployService}
            onClose={() => setDeployService(null)}
            onChanged={() => void fetchServers({ silent: true })}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {setupService && (
          <SetupEnvDialog
            key={setupService.id}
            service={setupService}
            onClose={() => setSetupService(null)}
            onChanged={() => void fetchServers({ silent: true })}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
