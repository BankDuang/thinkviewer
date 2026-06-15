import { useRef, useState } from 'react'
import clsx from 'clsx'
import { useSessionStore } from '@/store/sessionStore'
import { ApiError } from '@/lib/restClient'
import { Icon } from './Icon'
import './login.css'

export function Login() {
  const login = useSessionStore((s) => s.login)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [shake, setShake] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !password) return
    setBusy(true)
    setError('')
    try {
      await login(password)
    } catch (e) {
      // Surface the server's message (e.g. the brute-force block notice).
      setError(e instanceof ApiError ? e.message : 'Incorrect password')
      setShake(true)
      setPassword('')
      setTimeout(() => setShake(false), 450)
      inputRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login" style={{ backgroundImage: 'url(/static/wallpapers/login-bg.png)' }}>
      <div className={clsx('login-card', shake && 'shake')}>
        <div className="login-logo">
          <img src="/static/brand/logo.png" alt="ThinkViewer" draggable={false} />
        </div>
        <div className="login-title">ThinkViewer</div>
        <div className="login-sub">Enter password to connect</div>
        <form className="login-row" onSubmit={submit}>
          <input
            ref={inputRef}
            className="login-input"
            type="password"
            placeholder="Password"
            value={password}
            autoFocus
            disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="login-go" type="submit" disabled={busy} aria-label="Sign in">
            <Icon name={busy ? 'refresh' : 'chevron-right'} size={20} className={busy ? 'spin' : undefined} />
          </button>
        </form>
        <div className="login-error">{error}</div>
      </div>
    </div>
  )
}
