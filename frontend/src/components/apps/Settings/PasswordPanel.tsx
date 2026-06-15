import { useState } from 'react'
import * as api from '@/lib/restClient'
import { notify } from '@/store/notificationStore'
import { Icon } from '@/components/common/Icon'

export function PasswordPanel() {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)

  const tooShort = pw.length > 0 && pw.length < 4
  const mismatch = confirm.length > 0 && confirm !== pw
  const valid = pw.length >= 4 && pw === confirm

  let hint = 'Use at least 4 characters.'
  let hintClass = ''
  if (tooShort) {
    hint = 'Password must be at least 4 characters.'
    hintClass = ' is-err'
  } else if (mismatch) {
    hint = 'Passwords do not match.'
    hintClass = ' is-err'
  } else if (valid) {
    hint = 'Looks good.'
    hintClass = ' is-ok'
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    try {
      await api.setPassword(pw)
      notify('ok', 'Password updated')
      setPw('')
      setConfirm('')
      setShow(false)
    } catch (err) {
      notify('error', err instanceof api.ApiError ? err.message : 'Could not update password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="set-section">
      <div className="set-label">Change Password</div>
      <form className="set-form" onSubmit={submit}>
        <div className="set-field-group">
          <label className="set-field-label" htmlFor="set-pw-new">
            New password
          </label>
          <div className="set-input-wrap">
            <input
              id="set-pw-new"
              className="tv-field set-input"
              type={show ? 'text' : 'password'}
              value={pw}
              autoComplete="new-password"
              placeholder="New password"
              disabled={busy}
              onChange={(e) => setPw(e.target.value)}
            />
            <button
              type="button"
              className="set-reveal"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? 'Hide password' : 'Show password'}
            >
              <Icon name={show ? 'eye-off' : 'eye'} size={17} />
            </button>
          </div>
        </div>

        <div className="set-field-group">
          <label className="set-field-label" htmlFor="set-pw-confirm">
            Confirm password
          </label>
          <div className="set-input-wrap">
            <input
              id="set-pw-confirm"
              className="tv-field set-input"
              type={show ? 'text' : 'password'}
              value={confirm}
              autoComplete="new-password"
              placeholder="Re-enter password"
              disabled={busy}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        </div>

        <div className={`set-hint${hintClass}`}>{hint}</div>

        <div>
          <button type="submit" className="tv-btn tv-btn--primary" disabled={!valid || busy}>
            {busy && <Icon name="refresh" size={15} className="spin" />}
            {busy ? 'Updating…' : 'Change Password'}
          </button>
        </div>
      </form>
      <p className="set-note">
        The new password applies to all future logins. Existing sessions stay signed in.
      </p>
    </div>
  )
}
