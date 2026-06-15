import { useRef } from 'react'
import { motion } from 'framer-motion'
import clsx from 'clsx'
import type { Rect, WindowState } from '@/types'
import { useWindowStore } from '@/store/windowStore'
import { useWindowDrag, useWindowResize } from '@/hooks/useWindowGestures'
import { APP_REGISTRY } from '@/registry/appRegistry'
import { TrafficLights } from './TrafficLights'
import './window.css'

const DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const

export function Window({
  win,
  focused,
  zIndex,
}: {
  win: WindowState
  focused: boolean
  zIndex: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const def = APP_REGISTRY[win.app]
  const { focus, close, minimize, toggleMaximize, setRect, snap } = useWindowStore.getState()

  const getRect = (): Rect => useWindowStore.getState().windows[win.id]?.rect ?? win.rect

  const onDrag = useWindowDrag({
    winRef: ref,
    getRect,
    onCommit: (rect) => setRect(win.id, rect),
    onSnapZone: (zone) => snap(win.id, zone),
    onStart: () => focus(win.id),
    disabled: win.maximized,
  })
  const makeResize = useWindowResize({
    winRef: ref,
    getRect,
    onCommit: (rect) => setRect(win.id, rect),
    onStart: () => focus(win.id),
  })

  const Component = def.Component

  return (
    <motion.div
      ref={ref}
      className={clsx('win', focused ? 'is-focused' : 'is-blurred')}
      style={{
        left: win.rect.x,
        top: win.rect.y,
        width: win.rect.w,
        height: win.rect.h,
        zIndex,
        pointerEvents: win.minimized ? 'none' : 'auto',
      }}
      initial={{ opacity: 0, scale: 0.92, y: 8 }}
      animate={
        win.minimized
          ? { opacity: 0, scale: 0.06, y: window.innerHeight, transformOrigin: 'bottom center' }
          : { opacity: 1, scale: 1, y: 0 }
      }
      exit={{ opacity: 0, scale: 0.92, y: 8 }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      onPointerDownCapture={() => {
        if (!focused) focus(win.id)
      }}
    >
      <div
        className="win-titlebar"
        onPointerDown={onDrag}
        onDoubleClick={() => toggleMaximize(win.id)}
      >
        <TrafficLights
          onClose={() => close(win.id)}
          onMinimize={() => minimize(win.id)}
          onMaximize={() => toggleMaximize(win.id)}
        />
        <div className="win-title">{win.title}</div>
        <div className="win-titlebar-spacer" />
      </div>

      <div className="win-content">
        <Component windowId={win.id} focused={focused} props={win.props} />
      </div>

      {!win.maximized &&
        DIRS.map((dir) => (
          <div
            key={dir}
            className={`win-resize rz-${dir}`}
            onPointerDown={makeResize(dir)}
          />
        ))}
    </motion.div>
  )
}
