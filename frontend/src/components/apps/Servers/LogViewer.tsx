import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import clsx from 'clsx'
import type { ManagedService } from '@/types'
import * as api from '@/lib/restClient'
import { notify } from '@/store/notificationStore'
import { Icon } from '@/components/common/Icon'

interface LogViewerProps {
  service: ManagedService
  onClose: () => void
}

const REFRESH_MS = 2000
const LOG_LINES = 500

export function LogViewer({ service, onClose }: LogViewerProps) {
  const [logs, setLogs] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [follow, setFollow] = useState(true)

  const preRef = useRef<HTMLPreElement>(null)
  const inFlight = useRef(false)
  const firstLoad = useRef(true)
  const id = service.id

  const fetchLogs = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const resp = await api.serverLogs(id, LOG_LINES)
      setLogs(resp.logs)
      setError(null)
    } catch (e) {
      if (firstLoad.current) setError(e instanceof api.ApiError ? e.message : 'Could not load logs')
    } finally {
      inFlight.current = false
      firstLoad.current = false
      setLoading(false)
    }
  }, [id])

  // Initial load + auto-refresh while open.
  useEffect(() => {
    void fetchLogs()
    const timer = window.setInterval(() => void fetchLogs(), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [fetchLogs])

  // Escape to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Auto-scroll to bottom when following.
  useLayoutEffect(() => {
    if (follow && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight
  }, [logs, follow])

  async function copy() {
    try {
      await navigator.clipboard.writeText(logs)
      notify('ok', 'Logs copied to clipboard')
    } catch {
      notify('error', 'Could not copy logs')
    }
  }

  const hasLogs = logs.trim().length > 0

  return (
    <motion.div
      className="srv-overlay is-drawer"
      onMouseDown={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <motion.div
        className="srv-drawer"
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="srv-drawer-head">
          <div className="srv-drawer-titlewrap">
            <div className="srv-drawer-title">{service.name} · logs</div>
            <div className="srv-drawer-sub">{service.cwd}</div>
          </div>
          <div className="srv-drawer-tools">
            <button
              className={clsx('srv-toggle', follow && 'is-on')}
              onClick={() => setFollow((f) => !f)}
              title="Auto-scroll to newest output"
            >
              <Icon name="chevron-down" size={13} />
              Follow
            </button>
            <button className="srv-iconbtn" onClick={() => void fetchLogs()} title="Refresh" aria-label="Refresh">
              <Icon name="refresh" size={16} />
            </button>
            <button
              className="srv-iconbtn"
              onClick={() => void copy()}
              disabled={!hasLogs}
              title="Copy"
              aria-label="Copy logs"
            >
              <Icon name="clipboard" size={16} />
            </button>
            <button className="srv-close" onClick={onClose} aria-label="Close">
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="srv-log-empty">
            <Icon name="refresh" size={20} className="spin" />
            Loading logs…
          </div>
        ) : error ? (
          <div className="srv-log-empty">
            <Icon name="alert" size={20} />
            {error}
          </div>
        ) : hasLogs ? (
          <pre className="srv-log-pre" ref={preRef}>
            {logs}
          </pre>
        ) : (
          <div className="srv-log-empty">
            <Icon name="file" size={22} />
            {service.log_exists ? 'Log file is empty.' : 'No log output yet.'}
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
