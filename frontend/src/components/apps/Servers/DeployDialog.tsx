import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import clsx from 'clsx'
import type { DeployInfo, DeployLog, ManagedService } from '@/types'
import * as api from '@/lib/restClient'
import { notify } from '@/store/notificationStore'
import { Icon } from '@/components/common/Icon'

interface DeployDialogProps {
  service: ManagedService
  onClose: () => void
  onChanged?: () => void
}

const POLL_MS = 1500

function PrereqRow({
  ok,
  label,
  detail,
  neutral = false,
}: {
  ok: boolean
  label: string
  detail: string
  neutral?: boolean
}) {
  return (
    <div className="srv-prereq-row">
      <span className={clsx('srv-prereq-ico', neutral ? 'is-neutral' : ok ? 'is-ok' : 'is-bad')}>
        <Icon name={neutral ? 'info' : ok ? 'check' : 'x-circle'} size={13} strokeWidth={2.2} />
      </span>
      <span className="srv-prereq-label">{label}</span>
      <span className="srv-prereq-detail srv-mono" title={detail}>
        {detail}
      </span>
    </div>
  )
}

export function DeployDialog({ service, onClose, onChanged }: DeployDialogProps) {
  const [info, setInfo] = useState<DeployInfo | null>(null)
  const [infoLoading, setInfoLoading] = useState(true)
  const [infoError, setInfoError] = useState<string | null>(null)

  const [domain, setDomain] = useState(service.domain ?? '')
  const [email, setEmail] = useState(service.email ?? '')
  const [staging, setStaging] = useState(false)

  const [reachOutput, setReachOutput] = useState<string | null>(null)
  const [reachChecking, setReachChecking] = useState(false)

  const [deployLog, setDeployLog] = useState<DeployLog | null>(null)
  const [starting, setStarting] = useState(false)
  const [deploying, setDeploying] = useState(false)

  const mountedRef = useRef(true)
  const logBoxRef = useRef<HTMLPreElement>(null)
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged

  const inProgress = starting || deploying

  // --- Load deploy info on mount --------------------------------------------
  useEffect(() => {
    mountedRef.current = true
    setInfoLoading(true)
    api
      .getDeployInfo()
      .then((di) => {
        if (!mountedRef.current) return
        setInfo(di)
        setInfoError(null)
      })
      .catch((e: unknown) => {
        if (!mountedRef.current) return
        setInfoError(e instanceof api.ApiError ? e.message : 'Could not load deploy info')
      })
      .finally(() => {
        if (mountedRef.current) setInfoLoading(false)
      })
    return () => {
      mountedRef.current = false
    }
  }, [])

  // --- Poll the deploy log while a deploy is running ------------------------
  useEffect(() => {
    if (!deploying) return
    let cancelled = false
    const tick = async () => {
      try {
        const log = await api.getDeployLog(service.id)
        if (cancelled) return
        setDeployLog(log)
        if (!log.running) {
          setDeploying(false)
          if (log.success === true) {
            notify('ok', `HTTPS is live for ${log.domain ?? service.domain ?? 'your domain'}`)
            onChangedRef.current?.()
          } else {
            notify(
              'error',
              `Deploy failed${log.exit != null ? ` (exit ${log.exit})` : ''} — see the log below`,
            )
          }
        }
      } catch (e) {
        if (cancelled) return
        setDeploying(false)
        notify('error', e instanceof api.ApiError ? e.message : 'Lost connection to the deploy')
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [deploying, service.id, service.domain])

  // --- Auto-scroll the live log ---------------------------------------------
  useLayoutEffect(() => {
    const el = logBoxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [deployLog?.log])

  const handleClose = useCallback(() => {
    if (inProgress) {
      notify('warn', 'Deploy is still running — please wait for it to finish')
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

  const noPort = service.port == null
  const kitMissing = info != null && !info.kit_found
  const toolsMissing = info != null && (info.nginx == null || info.certbot == null)

  const canDeploy =
    !!domain.trim() && !noPort && !!info?.kit_found && !inProgress && !infoLoading

  async function checkReach() {
    if (reachChecking) return
    const d = domain.trim()
    if (!d) {
      notify('warn', 'Enter a domain to check')
      return
    }
    setReachChecking(true)
    setReachOutput(null)
    try {
      const resp = await api.checkReachability(service.id, d, 80)
      if (!mountedRef.current) return
      setReachOutput(resp.output || '(no output)')
    } catch (e) {
      if (!mountedRef.current) return
      notify('error', e instanceof api.ApiError ? e.message : 'Reachability check failed')
    } finally {
      if (mountedRef.current) setReachChecking(false)
    }
  }

  async function deploy() {
    if (!canDeploy) return
    const d = domain.trim()
    setStarting(true)
    try {
      await api.deployService(service.id, {
        domain: d,
        email: email.trim() || undefined,
        staging,
      })
      if (!mountedRef.current) return
      setDeployLog({ running: true, success: null, exit: null, domain: d, log: '' })
      setDeploying(true)
    } catch (e) {
      if (!mountedRef.current) return
      notify('error', e instanceof api.ApiError ? e.message : 'Could not start the deploy')
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
            <Icon name="lock" size={15} strokeWidth={1.9} />
            <span>Publish “{service.name}” over HTTPS</span>
          </span>
          <button className="srv-close" onClick={handleClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="srv-dialog-body">
          {/* ---------- Prerequisites ---------- */}
          <div className="srv-field">
            <span className="srv-field-label">Prerequisites</span>
            {infoLoading ? (
              <div className="srv-readonly">
                <Icon name="refresh" size={14} className="spin" />
                Checking the host…
              </div>
            ) : infoError ? (
              <div className="srv-deploy-warn is-strong">
                <Icon name="alert" size={15} />
                <span>{infoError}</span>
              </div>
            ) : info ? (
              <>
                <div className="srv-deploy-prereq">
                  <PrereqRow
                    ok={info.kit_found}
                    label="deploy-kit"
                    detail={info.kit_found ? info.kit_dir : 'not found'}
                  />
                  <PrereqRow ok={info.nginx != null} label="nginx" detail={info.nginx ?? 'not installed'} />
                  <PrereqRow
                    ok={info.certbot != null}
                    label="certbot"
                    detail={info.certbot ?? 'not installed'}
                  />
                  <PrereqRow
                    ok={info.public_ip != null}
                    neutral
                    label="Public IP"
                    detail={info.public_ip ?? 'unknown'}
                  />
                </div>
                {kitMissing && (
                  <div className="srv-deploy-warn is-strong">
                    <Icon name="alert" size={15} />
                    <span>deploy-kit not found in the servers base dir. Deploy is unavailable.</span>
                  </div>
                )}
                {!kitMissing && toolsMissing && (
                  <div className="srv-deploy-warn">
                    <Icon name="info" size={15} />
                    <span>
                      Missing tools. Install with: <code>brew install nginx certbot</code>
                    </span>
                  </div>
                )}
              </>
            ) : null}
          </div>

          {/* ---------- Port guard ---------- */}
          {noPort && (
            <div className="srv-deploy-warn is-strong">
              <Icon name="alert" size={15} />
              <span>
                Set a port for this service first — HTTPS proxies the domain to its port.
              </span>
            </div>
          )}

          {/* ---------- Info banner ---------- */}
          <div className="srv-deploy-info">
            <div className="srv-deploy-info-row">
              <Icon name="info" size={14} strokeWidth={1.9} />
              <span>
                Point the domain’s DNS <strong>A record</strong> to this machine
                {info?.public_ip ? (
                  <>
                    {' '}(<span className="srv-mono">{info.public_ip}</span>)
                  </>
                ) : (
                  ''
                )}
                , and make sure inbound <strong>port 80</strong> is open.
              </span>
            </div>
            <div className="srv-deploy-info-row">
              <Icon name="lock" size={14} strokeWidth={1.9} />
              <span>
                A <strong>macOS admin prompt will appear on the host Mac</strong> — approve it
                (Touch ID / password) to continue.
              </span>
            </div>
          </div>

          {/* ---------- Fields ---------- */}
          <div className="srv-field">
            <span className="srv-field-label">Domain</span>
            <input
              className="tv-field srv-input"
              value={domain}
              spellCheck={false}
              autoCapitalize="none"
              placeholder="app.example.com"
              disabled={inProgress}
              onChange={(e) => setDomain(e.target.value.trim())}
            />
          </div>

          <div className="srv-field">
            <span className="srv-field-label">
              Email <span className="srv-optional">Let’s Encrypt expiry notices</span>
            </span>
            <input
              className="tv-field srv-input"
              value={email}
              type="email"
              spellCheck={false}
              autoCapitalize="none"
              placeholder="you@example.com"
              disabled={inProgress}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <label className={clsx('srv-check', inProgress && 'is-disabled')}>
            <input
              type="checkbox"
              checked={staging}
              disabled={inProgress}
              onChange={(e) => setStaging(e.target.checked)}
            />
            <span className="srv-check-box" aria-hidden="true">
              {staging && <Icon name="check" size={12} strokeWidth={2.6} />}
            </span>
            <span className="srv-check-text">
              Test certificate <span className="srv-optional">no rate limit, not trusted by browsers</span>
            </span>
          </label>

          {/* ---------- Reachability ---------- */}
          <div className="srv-field">
            <div className="srv-deploy-sectionhead">
              <span className="srv-field-label">Reachability</span>
              <button
                className="tv-btn srv-deploy-smallbtn"
                onClick={() => void checkReach()}
                disabled={reachChecking || !domain.trim()}
              >
                <Icon name="signal" size={14} className={reachChecking ? 'spin' : undefined} />
                {reachChecking ? 'Checking…' : 'Check reachability'}
              </button>
            </div>
            <span className="srv-deploy-hint">
              Probes whether the outside world can reach port 80 (needed to issue the cert). Takes
              ~30s.
            </span>
            {reachChecking ? (
              <pre className="srv-deploy-out is-pending">Probing inbound port 80 from the internet…</pre>
            ) : reachOutput != null ? (
              <pre className="srv-deploy-out">{reachOutput}</pre>
            ) : null}
          </div>

          {/* ---------- Live deploy log ---------- */}
          {deployLog && (
            <div className="srv-field">
              <div className="srv-deploy-sectionhead">
                <span className="srv-field-label">Deploy log</span>
                <span
                  className={clsx(
                    'srv-deploy-status',
                    deployLog.running
                      ? 'is-running'
                      : deployLog.success
                        ? 'is-ok'
                        : 'is-bad',
                  )}
                >
                  {deployLog.running ? (
                    <>
                      <Icon name="refresh" size={12} className="spin" />
                      Running
                    </>
                  ) : deployLog.success ? (
                    <>
                      <Icon name="check" size={12} strokeWidth={2.4} />
                      Done
                    </>
                  ) : (
                    <>
                      <Icon name="x-circle" size={12} strokeWidth={2.2} />
                      Failed{deployLog.exit != null ? ` (${deployLog.exit})` : ''}
                    </>
                  )}
                </span>
              </div>
              <pre className="srv-deploy-out is-log" ref={logBoxRef}>
                {deployLog.log || 'Starting…'}
              </pre>
            </div>
          )}
        </div>

        <div className="srv-dialog-foot">
          <button className="tv-btn" onClick={handleClose} disabled={inProgress}>
            {inProgress ? 'Running…' : 'Close'}
          </button>
          <button
            className="tv-btn tv-btn--primary"
            onClick={() => void deploy()}
            disabled={!canDeploy}
            title={
              noPort
                ? 'Set a port for this service first'
                : kitMissing
                  ? 'deploy-kit is not available'
                  : undefined
            }
          >
            {inProgress ? (
              <Icon name="refresh" size={14} className="spin" />
            ) : (
              <Icon name="lock" size={14} strokeWidth={1.9} />
            )}
            {inProgress ? 'Deploying…' : 'Deploy / Get HTTPS'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
