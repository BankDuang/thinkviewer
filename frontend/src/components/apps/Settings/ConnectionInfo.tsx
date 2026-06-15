import { useEffect, useState } from 'react'
import type { ConnectionStatus } from '@/types'
import { useSessionStore } from '@/store/sessionStore'
import { useConnectionStore } from '@/store/connectionStore'
import { confirmDialog } from '@/store/dialogStore'
import { Icon } from '@/components/common/Icon'

const STATUS_META: Record<ConnectionStatus, { dot: string; label: string }> = {
  open: { dot: 'set-dot--ok', label: 'Connected' },
  connecting: { dot: 'set-dot--warn', label: 'Connecting…' },
  reconnecting: { dot: 'set-dot--warn', label: 'Reconnecting…' },
  closed: { dot: 'set-dot--bad', label: 'Disconnected' },
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="set-row">
      <div className="set-row-key">
        <div className="set-row-label">{label}</div>
      </div>
      <div className={`set-row-value${mono ? ' mono' : ''}`}>{value}</div>
    </div>
  )
}

export function ConnectionInfo() {
  const info = useSessionStore((s) => s.info)
  const refreshInfo = useSessionStore((s) => s.refreshInfo)
  const logout = useSessionStore((s) => s.logout)
  const status = useConnectionStore((s) => s.status)

  const [reveal, setReveal] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    void refreshInfo()
  }, [refreshInfo])

  async function doRefresh() {
    if (refreshing) return
    setRefreshing(true)
    try {
      await refreshInfo()
    } finally {
      setRefreshing(false)
    }
  }

  async function doLogout() {
    const ok = await confirmDialog({
      title: 'Log out?',
      message: 'You will need the password to reconnect.',
      confirmLabel: 'Log Out',
      danger: true,
    })
    if (ok) await logout()
  }

  const meta = STATUS_META[status]

  if (!info) {
    return (
      <div className="set-loading">
        <Icon name="refresh" size={24} className="spin" />
        Loading device info…
      </div>
    )
  }

  return (
    <>
      <div className="set-status">
        <span className={`set-dot ${meta.dot}`} />
        {meta.label}
      </div>

      <div className="set-section">
        <div className="set-label">Device</div>
        <div className="set-group">
          <Row label="Hostname" value={info.hostname} />
          <Row label="Platform" value={info.platform} />
          <Row label="Display" value={`${info.screen_width} × ${info.screen_height}`} />
          <Row label="Connected clients" value={String(info.connected_clients)} />
          <Row label="Device ID" value={info.device_id} mono />
        </div>
      </div>

      <div className="set-section">
        <div className="set-label">Current Stream</div>
        <div className="set-group">
          <Row label="Quality" value={String(info.quality)} />
          <Row label="Frame rate" value={`${info.fps} fps`} />
          <Row label="Scale" value={`${info.scale}×`} />
        </div>
      </div>

      <div className="set-section">
        <div className="set-label">Access</div>
        <div className="set-group">
          <div className="set-row">
            <div className="set-row-key">
              <div className="set-row-label">Password</div>
              <div className="set-row-sub">Used to sign in to this device</div>
            </div>
            <div className="set-row-value mono">
              {reveal ? info.password : '••••••••'}
              <button
                type="button"
                className="set-icon-btn"
                style={{ display: 'inline-grid', marginLeft: 6, verticalAlign: 'middle' }}
                onClick={() => setReveal((v) => !v)}
                aria-label={reveal ? 'Hide password' : 'Show password'}
              >
                <Icon name={reveal ? 'eye-off' : 'eye'} size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="set-actions">
        <button type="button" className="tv-btn" onClick={doRefresh} disabled={refreshing}>
          <Icon name="refresh" size={15} className={refreshing ? 'spin' : undefined} />
          Refresh
        </button>
        <button type="button" className="tv-btn tv-btn--danger" onClick={doLogout}>
          <Icon name="logout" size={15} />
          Log Out
        </button>
      </div>
    </>
  )
}
