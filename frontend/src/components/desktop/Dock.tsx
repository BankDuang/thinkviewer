import { useRef } from 'react'
import { AppTile } from '@/components/common/AppTile'
import { APP_REGISTRY, APP_ORDER } from '@/registry/appRegistry'
import { useWindowStore } from '@/store/windowStore'
import { openApp } from '@/lib/openApp'

const BASE = 50 // resting tile size (px)
const MAX_BOOST = 30 // extra px at the cursor
const RANGE = 110 // px of influence on each side

export function Dock() {
  const windows = useWindowStore((s) => s.windows)
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const rafRef = useRef<number | null>(null)

  const running = new Set(Object.values(windows).map((w) => w.app))

  const onMove = (e: React.PointerEvent) => {
    const mouseX = e.clientX
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      for (const app of APP_ORDER) {
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
    for (const app of APP_ORDER) {
      itemRefs.current[app]?.style.setProperty('--tile', `${BASE}px`)
    }
  }

  return (
    <div className="dock-wrap">
      <div className="dock" onPointerMove={onMove} onPointerLeave={reset}>
        {APP_ORDER.map((app) => (
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
      </div>
    </div>
  )
}
