import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { ws } from '@/lib/wsClient'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useWindowStore } from '@/store/windowStore'
import { useSessionStore } from '@/store/sessionStore'
import { useDesktopStore } from '@/store/desktopStore'
import { visibleApps } from '@/registry/appRegistry'
import type { AppKind } from '@/types'
import { Wallpaper } from './Wallpaper'
import { MenuBar } from './MenuBar'
import { Dock } from './Dock'
import { DesktopIcon } from './DesktopIcon'
import { Window } from '@/components/window/Window'
import { Notifications } from '@/components/common/Notification'
import { Dialog } from '@/components/common/Dialog'
import './desktop.css'

export function Desktop() {
  const token = useSessionStore((s) => s.token)
  const windows = useWindowStore((s) => s.windows)
  const order = useWindowStore((s) => s.order)
  const focusedId = useWindowStore((s) => s.focusedId)
  const loadWallpapers = useDesktopStore((s) => s.loadWallpapers)
  const user = useSessionStore((s) => s.user)
  const apps = visibleApps(user)
  const [selectedIcon, setSelectedIcon] = useState<AppKind | null>(null)

  useWebSocket()

  useEffect(() => {
    if (token) ws.connect(token)
    void loadWallpapers()
    return () => ws.disconnect()
  }, [token, loadWallpapers])

  return (
    <div className="desktop" onPointerDown={() => setSelectedIcon(null)}>
      <Wallpaper />
      <MenuBar />

      <div className="desktop-icons" onPointerDown={(e) => e.stopPropagation()}>
        {apps.map((app) => (
          <DesktopIcon
            key={app}
            app={app}
            selected={selectedIcon === app}
            onSelect={() => setSelectedIcon(app)}
          />
        ))}
      </div>

      <AnimatePresence>
        {order.map((id, i) => {
          const win = windows[id]
          if (!win) return null
          return <Window key={id} win={win} focused={focusedId === id} zIndex={100 + i} />
        })}
      </AnimatePresence>

      <Dock />
      <Notifications />
      <Dialog />
    </div>
  )
}
