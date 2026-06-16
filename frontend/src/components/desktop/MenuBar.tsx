import { useEffect, useState } from 'react'
import { Icon } from '@/components/common/Icon'
import { MenuBarStats } from './MenuBarStats'
import * as api from '@/lib/restClient'
import { notify } from '@/store/notificationStore'
import { useWindowStore } from '@/store/windowStore'
import { useConnectionStore } from '@/store/connectionStore'
import { useSessionStore } from '@/store/sessionStore'
import type { ConnectionStatus } from '@/types'

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  open: '#34c759',
  connecting: '#ffd60a',
  reconnecting: '#ff9f0a',
  closed: '#ff453a',
}
const STATUS_LABEL: Record<ConnectionStatus, string> = {
  open: 'Connected',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  closed: 'Offline',
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000 * 20)
    return () => clearInterval(id)
  }, [])
  return now
}

// This machine's public IP — fetched once connected, refreshed every 10 min.
function usePublicIp(status: ConnectionStatus): string | null {
  const [ip, setIp] = useState<string | null>(null)
  useEffect(() => {
    if (status !== 'open') return
    let alive = true
    const tick = () =>
      api
        .getPublicIp()
        .then((r) => alive && setIp(r.ip))
        .catch(() => {})
    tick()
    const id = window.setInterval(tick, 10 * 60 * 1000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [status])
  return ip
}

export function MenuBar() {
  const focusedId = useWindowStore((s) => s.focusedId)
  const focusedTitle = useWindowStore((s) => (s.focusedId ? s.windows[s.focusedId]?.title : null))
  const status = useConnectionStore((s) => s.status)
  const logout = useSessionStore((s) => s.logout)
  const now = useClock()
  const publicIp = usePublicIp(status)

  const copyIp = () => {
    if (!publicIp) return
    navigator.clipboard?.writeText(publicIp).then(
      () => notify('ok', `Copied ${publicIp}`),
      () => {},
    )
  }

  const day = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

  return (
    <div className="menubar">
      <div className="menubar-brand">
        <Icon name="aperture" size={15} strokeWidth={1.8} />
        ThinkViewer
      </div>
      <div className="menubar-menus">
        <span>{focusedId ? focusedTitle : 'Desktop'}</span>
        <span>File</span>
        <span>View</span>
        <span>Window</span>
      </div>

      <div className="menubar-right">
        {publicIp && (
          <button className="menubar-ip" title="Public IP of this machine — click to copy" onClick={copyIp}>
            <Icon name="signal" size={13} />
            <span className="menubar-ip-addr">{publicIp}</span>
          </button>
        )}
        <MenuBarStats />
        <div className="menubar-status" title={STATUS_LABEL[status]}>
          <span className="menubar-dot" style={{ background: STATUS_COLOR[status], color: STATUS_COLOR[status] }} />
          <Icon name="signal" size={15} />
        </div>
        <button className="menubar-icon-btn" title="Log out" onClick={() => void logout()}>
          <Icon name="logout" size={15} />
        </button>
        <span>{day}</span>
        <span style={{ fontWeight: 600 }}>{time}</span>
      </div>
    </div>
  )
}
