import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppProps } from '@/types'
import * as api from '@/lib/restClient'
import { Icon } from '@/components/common/Icon'
import './finance.css'

type Phase = 'checking' | 'starting' | 'ready' | 'error'

/** Embeds the real FinanceHub (Think Finance) app — the backend runs it on a
 *  loopback port; we frame it so it behaves exactly like the site, with real
 *  data + PDF/document export. */
export function FinanceApp(_props: AppProps) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [port, setPort] = useState<number | null>(null)
  const [token, setToken] = useState('')
  const [err, setErr] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const cancelled = useRef(false)

  // route through /tv-autologin so the embed signs in automatically (no FinanceHub
  // login screen); fall back to the normal login page if no SSO token is available
  const origin = port ? `${location.protocol}//${location.hostname}:${port}` : ''
  const url = origin ? `${origin}${token ? `/tv-autologin?token=${encodeURIComponent(token)}` : '/'}` : ''

  const boot = useCallback(async () => {
    cancelled.current = false
    setPhase('checking')
    setErr('')
    try {
      let st = await api.financeStatus()
      setPort(st.port)
      setToken(st.autologin_token || '')
      if (st.running) {
        setPhase('ready')
        return
      }
      if (!st.available) {
        setErr('The financial service is not set up on the server (FinanceHub/.venv missing).')
        setPhase('error')
        return
      }
      setPhase('starting')
      const started = await api.financeStart()
      setPort(started.port)
      if (started.error) {
        setErr(started.error)
        setPhase('error')
        return
      }
      // poll until the Flask app answers
      for (let i = 0; i < 30 && !cancelled.current; i++) {
        await new Promise((r) => setTimeout(r, 700))
        st = await api.financeStatus().catch(() => ({ running: false, port: started.port, available: true }))
        if (st.running) {
          if (!cancelled.current) setPhase('ready')
          return
        }
      }
      if (!cancelled.current) {
        setErr('The financial service did not come up in time. Check server_logs/finance.log.')
        setPhase('error')
      }
    } catch (e) {
      setErr(e instanceof api.ApiError ? e.message : 'Could not reach the financial service.')
      setPhase('error')
    }
  }, [])

  useEffect(() => {
    boot()
    return () => {
      cancelled.current = true
    }
  }, [boot])

  return (
    <div className="fin-app">
      <header className="fin-bar">
        <div className="fin-brand">
          <span className="fin-logo">
            <Icon name="chart-bar" size={15} />
          </span>
          <span className="fin-title">Financial</span>
          <span className="fin-sub">Think Finance</span>
          {phase === 'ready' && <span className="fin-dot" title="Connected" />}
        </div>
        <div className="fin-actions">
          <button
            className="fin-btn"
            onClick={() => setReloadKey((k) => k + 1)}
            title="Reload"
            disabled={phase !== 'ready'}
          >
            <Icon name="refresh" size={15} />
          </button>
          {url && (
            <a className="fin-btn" href={url} target="_blank" rel="noreferrer" title="Open in browser">
              <Icon name="expand" size={15} />
            </a>
          )}
        </div>
      </header>

      <div className="fin-body">
        {phase === 'ready' && url ? (
          <iframe
            key={reloadKey}
            className="fin-frame"
            src={url}
            title="Financial"
            allow="clipboard-read; clipboard-write"
          />
        ) : phase === 'error' ? (
          <div className="fin-state">
            <Icon name="alert" size={34} strokeWidth={1.4} />
            <p className="fin-state-title">Couldn’t open Financial</p>
            <p className="fin-state-msg">{err}</p>
            <button className="fin-retry" onClick={() => void boot()}>
              <Icon name="refresh" size={14} /> Retry
            </button>
          </div>
        ) : (
          <div className="fin-state">
            <Icon name="refresh" size={30} className="spin" />
            <p className="fin-state-title">{phase === 'starting' ? 'Starting financial service…' : 'Connecting…'}</p>
            <p className="fin-state-msg">Loading Think Finance with your real data.</p>
          </div>
        )}
      </div>
    </div>
  )
}
