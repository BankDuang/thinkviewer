import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import clsx from 'clsx'
import type { Interpreter, ManagedService, SetupLog } from '@/types'
import * as api from '@/lib/restClient'
import { notify } from '@/store/notificationStore'
import { Icon } from '@/components/common/Icon'

interface SetupEnvDialogProps {
  service: ManagedService
  onClose: () => void
  onChanged?: () => void
}

const POLL_MS = 1200
const CUSTOM = '__custom__'
const KIND_LABELS: Record<Interpreter['kind'], string> = {
  venv: 'Virtual environments',
  pyenv: 'pyenv',
  system: 'System',
}

/** Sortable key from a version embedded in the label/path, e.g. "3.12.1". */
function versionKey(i: Interpreter): string {
  const m = `${i.label} ${i.path}`.match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!m) return '0000.0000.0000'
  return [m[1], m[2], m[3] ?? '0'].map((n) => n.padStart(4, '0')).join('.')
}

/**
 * Pick a sensible default base interpreter: prefer a real base (system / pyenv,
 * NOT the project's own .venv), newest-looking first; otherwise the first item.
 */
function pickDefaultBase(list: Interpreter[]): string {
  if (list.length === 0) return ''
  const bases = list.filter((i) => i.kind !== 'venv')
  const pool = bases.length > 0 ? bases : list
  const sorted = [...pool].sort((a, b) => versionKey(b).localeCompare(versionKey(a)))
  return sorted[0]?.path ?? list[0].path
}

export function SetupEnvDialog({ service, onClose, onChanged }: SetupEnvDialogProps) {
  const [interpreters, setInterpreters] = useState<Interpreter[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [basePython, setBasePython] = useState('')
  const [mode, setMode] = useState<'select' | 'custom'>('select')

  const [setupLog, setSetupLog] = useState<SetupLog | null>(null)
  const [starting, setStarting] = useState(false)
  const [building, setBuilding] = useState(false)

  const mountedRef = useRef(true)
  const logBoxRef = useRef<HTMLPreElement>(null)
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged

  const inProgress = starting || building

  // --- Load interpreters on mount -------------------------------------------
  useEffect(() => {
    mountedRef.current = true
    setLoading(true)
    api
      .serverInterpreters(service.cwd)
      .then(({ interpreters: list }) => {
        if (!mountedRef.current) return
        setInterpreters(list)
        setBasePython(pickDefaultBase(list))
        setMode('select')
        setLoadError(null)
      })
      .catch((e: unknown) => {
        if (!mountedRef.current) return
        setLoadError(e instanceof api.ApiError ? e.message : 'Could not list interpreters')
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false)
      })
    return () => {
      mountedRef.current = false
    }
  }, [service.cwd])

  // --- Poll the setup log while a build is running --------------------------
  useEffect(() => {
    if (!building) return
    let cancelled = false
    const tick = async () => {
      try {
        const log = await api.getSetupLog(service.id)
        if (cancelled) return
        setSetupLog(log)
        if (!log.running) {
          setBuilding(false)
          if (log.success === true) {
            notify('ok', 'Environment ready')
            onChangedRef.current?.()
          } else {
            notify('error', 'Environment setup failed — see the log below')
          }
        }
      } catch (e) {
        if (cancelled) return
        setBuilding(false)
        notify('error', e instanceof api.ApiError ? e.message : 'Lost connection to the build')
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [building, service.id])

  // --- Auto-scroll the live log ---------------------------------------------
  useLayoutEffect(() => {
    const el = logBoxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [setupLog?.log])

  const handleClose = useCallback(() => {
    if (inProgress) {
      notify('warn', 'The environment is still building — please wait for it to finish')
      return
    }
    onClose()
  }, [inProgress, onClose])

  // --- Escape to close ------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleClose])

  const venvPath = `${service.cwd.replace(/\/+$/, '')}/.venv`
  const canBuild = !!basePython.trim() && !inProgress && !loading && !loadError

  async function build() {
    if (!canBuild) return
    const base = basePython.trim()
    setStarting(true)
    try {
      await api.setupEnv(service.id, base)
      if (!mountedRef.current) return
      setSetupLog({ running: true, success: null, venv_python: null, log: '' })
      setBuilding(true)
    } catch (e) {
      if (!mountedRef.current) return
      notify('error', e instanceof api.ApiError ? e.message : 'Could not start the build')
    } finally {
      if (mountedRef.current) setStarting(false)
    }
  }

  return (
    <motion.div
      className="srv-overlay is-dialog"
      onMouseDown={handleClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
    >
      <motion.div
        className="srv-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="srv-dialog-head">
          <span className="srv-dialog-title">
            <Icon name="download" size={15} strokeWidth={1.9} />
            <span>Set up environment for “{service.name}”</span>
          </span>
          <button className="srv-close" onClick={handleClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="srv-dialog-body">
          {/* ---------- What this does ---------- */}
          <div className="srv-deploy-info">
            <div className="srv-deploy-info-row">
              <Icon name="info" size={14} strokeWidth={1.9} />
              <span>
                This creates a fresh <span className="srv-mono">.venv</span> in the working
                directory and runs <code>pip install -r requirements.txt</code>. The service will
                then use this environment.
              </span>
            </div>
            <div className="srv-deploy-info-row">
              <Icon name="refresh" size={14} strokeWidth={1.9} />
              <span>
                This may take a minute or two while <strong>pip</strong> installs the
                dependencies.
              </span>
            </div>
          </div>

          {/* ---------- Working directory ---------- */}
          <div className="srv-field">
            <span className="srv-field-label">Working directory</span>
            <div className="srv-readonly">
              <Icon name="folder" size={14} />
              <span className="srv-readonly-path" title={service.cwd}>
                {service.cwd}
              </span>
            </div>
            <span className="srv-deploy-hint">
              Builds into <span className="srv-mono">{venvPath}</span>
            </span>
          </div>

          {/* ---------- Base Python ---------- */}
          <div className="srv-field">
            <span className="srv-field-label">Base Python</span>
            {loading ? (
              <div className="srv-readonly">
                <Icon name="refresh" size={14} className="spin" />
                Finding interpreters…
              </div>
            ) : loadError ? (
              <div className="srv-deploy-warn is-strong">
                <Icon name="alert" size={15} />
                <span>{loadError}</span>
              </div>
            ) : mode === 'custom' ? (
              <div className="srv-custom-row">
                <input
                  className="tv-field srv-input"
                  value={basePython}
                  spellCheck={false}
                  autoCapitalize="none"
                  placeholder="/path/to/python"
                  disabled={inProgress}
                  onChange={(e) => setBasePython(e.target.value)}
                />
                <button
                  className="srv-link-btn"
                  disabled={inProgress}
                  onClick={() => {
                    setBasePython(pickDefaultBase(interpreters))
                    setMode('select')
                  }}
                >
                  Use list
                </button>
              </div>
            ) : (
              <select
                className="tv-field srv-select"
                value={basePython}
                disabled={inProgress}
                onChange={(e) => {
                  if (e.target.value === CUSTOM) {
                    setBasePython('')
                    setMode('custom')
                  } else {
                    setBasePython(e.target.value)
                  }
                }}
              >
                {basePython && !interpreters.some((i) => i.path === basePython) && (
                  <option value={basePython}>{basePython}</option>
                )}
                {(['system', 'pyenv', 'venv'] as const).map((kind) => {
                  const group = interpreters.filter((i) => i.kind === kind)
                  if (group.length === 0) return null
                  return (
                    <optgroup key={kind} label={KIND_LABELS[kind]}>
                      {group.map((i) => (
                        <option key={i.path} value={i.path}>
                          {i.label}
                        </option>
                      ))}
                    </optgroup>
                  )
                })}
                <option value={CUSTOM}>Custom path…</option>
              </select>
            )}
            <span className="srv-deploy-hint">
              The interpreter used to create the virtualenv — pick a real base Python (system or
              pyenv), not an existing project <span className="srv-mono">.venv</span>.
            </span>
          </div>

          {/* ---------- Live setup log ---------- */}
          {setupLog && (
            <div className="srv-field">
              <div className="srv-deploy-sectionhead">
                <span className="srv-field-label">Build log</span>
                <span
                  className={clsx(
                    'srv-deploy-status',
                    setupLog.running ? 'is-running' : setupLog.success ? 'is-ok' : 'is-bad',
                  )}
                >
                  {setupLog.running ? (
                    <>
                      <Icon name="refresh" size={12} className="spin" />
                      Running
                    </>
                  ) : setupLog.success ? (
                    <>
                      <Icon name="check" size={12} strokeWidth={2.4} />
                      Done
                    </>
                  ) : (
                    <>
                      <Icon name="x-circle" size={12} strokeWidth={2.2} />
                      Failed
                    </>
                  )}
                </span>
              </div>
              <pre className="srv-deploy-out is-log" ref={logBoxRef}>
                {setupLog.log || 'Starting…'}
              </pre>
            </div>
          )}
        </div>

        <div className="srv-dialog-foot">
          <button className="tv-btn" onClick={handleClose} disabled={inProgress}>
            {inProgress ? 'Building…' : 'Close'}
          </button>
          <button
            className="tv-btn tv-btn--primary"
            onClick={() => void build()}
            disabled={!canBuild}
          >
            {inProgress ? (
              <Icon name="refresh" size={14} className="spin" />
            ) : (
              <Icon name="download" size={14} strokeWidth={1.9} />
            )}
            {inProgress ? 'Building…' : 'Build environment'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
