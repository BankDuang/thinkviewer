import { useRef, useState } from 'react'
import clsx from 'clsx'
import { useSessionStore } from '@/store/sessionStore'
import { ApiError } from '@/lib/restClient'
import { Icon } from './Icon'
import './login.css'

export function Login() {
  const login = useSessionStore((s) => s.login)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [shake, setShake] = useState(false)
  const pwRef = useRef<HTMLInputElement>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !username || !password) return
    setBusy(true)
    setError('')
    try {
      await login(username, password)
    } catch (e) {
      // Surface the server's message (e.g. the brute-force block notice).
      setError(e instanceof ApiError ? e.message : 'Invalid username or password')
      setShake(true)
      setPassword('')
      setTimeout(() => setShake(false), 450)
      pwRef.current?.focus()
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
        <div className="login-sub">Sign in to continue</div>
        <form className="login-form" onSubmit={submit}>
          <input
            className="login-input"
            type="text"
            placeholder="Username"
            value={username}
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            ref={pwRef}
            className="login-input"
            type="password"
            placeholder="Password"
            value={password}
            disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="login-btn" type="submit" disabled={busy}>
            {busy ? <Icon name="refresh" size={16} className="spin" /> : <Icon name="chevron-right" size={16} />}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="login-error">{error}</div>
      </div>
    </div>
  )
}
