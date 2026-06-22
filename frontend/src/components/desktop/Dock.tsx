import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { AppTile } from '@/components/common/AppTile'
import { Icon } from '@/components/common/Icon'
import { APP_REGISTRY, visibleApps } from '@/registry/appRegistry'
import { useWindowStore } from '@/store/windowStore'
import { useSessionStore } from '@/store/sessionStore'
import { useDesktopStore } from '@/store/desktopStore'
import { openApp } from '@/lib/openApp'

const BASE = 50 // resting tile size (px)
const MAX_BOOST = 30 // extra px at the cursor
const RANGE = 110 // px of influence on each side

export function Dock() {
  const windows = useWindowStore((s) => s.windows)
  const user = useSessionStore((s) => s.user)
  const hidden = useDesktopStore((s) => s.dockHidden)
  const setHidden = useDesktopStore((s) => s.setDockHidden)
  const [peek, setPeek] = useState(false)
  const apps = visibleApps(user)
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const rafRef = useRef<number | null>(null)
  const peekTimer = useRef<number | null>(null)

  const running = new Set(Object.values(windows).map((w) => w.app))
  const visible = !hidden || peek

  // Peek the hidden dock up on edge hover; a short close delay survives the
  // gap between the bottom hover-strip and the dock itself.
  const peekOn = () => {
    if (peekTimer.current) window.clearTimeout(peekTimer.current)
    setPeek(true)
  }
  const peekOff = () => {
    if (peekTimer.current) window.clearTimeout(peekTimer.current)
    peekTimer.current = window.setTimeout(() => setPeek(false), 180)
  }
  useEffect(() => () => { if (peekTimer.current) window.clearTimeout(peekTimer.current) }, [])

  const onMove = (e: React.PointerEvent) => {
    const mouseX = e.clientX
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      for (const app of apps) {
        const el = itemRefs.current[app]
        if (!el) continue
        const r = el.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const d = Math.abs(mouseX - cx)
        const t = Math.max(0, 1 - (d / RANGE) ** 2)
        el.style.setProperty('--tile', `${BASE + MAX_BOOST * t}px`)
      }
    })
  }

  const reset = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    for (const app of apps) {
      itemRefs.current[app]?.style.setProperty('--tile', `${BASE}px`)
    }
  }

  return (
    <>
      {/* bottom-edge hover strip: peeks the dock up while it is hidden */}
      {hidden && <div className="dock-reveal" onMouseEnter={peekOn} onMouseLeave={peekOff} />}

      <div
        className={clsx('dock-wrap', hidden && 'is-hidden', visible && 'is-visible')}
        onMouseEnter={hidden ? peekOn : undefined}
        onMouseLeave={hidden ? peekOff : undefined}
      >
        <div className="dock" onPointerMove={onMove} onPointerLeave={reset}>
          {apps.map((app) => (
            <div
              key={app}
              ref={(el) => {
                itemRefs.current[app] = el
              }}
              className="dock-item"
              style={{ ['--tile' as string]: `${BASE}px`, transition: 'transform 0.18s var(--ease-out)' }}
              onClick={() => openApp(app)}
            >
              <span className="dock-tooltip">{APP_REGISTRY[app].title}</span>
              <AppTile app={app} size={'var(--tile, 50px)'} />
              {running.has(app) && <span className="dock-dot" />}
            </div>
          ))}
          <span className="dock-sep" />
          <button
            className="dock-hide"
            title="Hide dock"
            onClick={() => {
              setHidden(true)
              setPeek(false)
            }}
          >
            <Icon name="chevron-down" size={16} />
          </button>
        </div>
      </div>

      {/* hidden → an up-chevron pill brings the dock back (hover peeks, click pins it) */}
      {hidden && (
        <button
          className="dock-show"
          title="Show dock"
          onMouseEnter={peekOn}
          onMouseLeave={peekOff}
          onClick={() => setHidden(false)}
        >
          <Icon name="chevron-down" size={16} className="dock-chev-up" />
        </button>
      )}
    </>
  )
}
