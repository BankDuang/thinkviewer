import { useCallback } from 'react'
import type { RefObject } from 'react'
import type { Rect, SnapZone } from '@/types'
import { MENUBAR_H, MIN_H, MIN_W } from '@/lib/layout'

// Window move/resize via Pointer Events. During the gesture we mutate the DOM
// element's geometry directly (no React/store writes) for 60fps drag, then commit
// the final rect to the store on pointer-up.

interface DragOpts {
  winRef: RefObject<HTMLElement | null>
  getRect: () => Rect
  onCommit: (rect: Rect) => void
  /** Live hint while dragging (e.g. show a snap-zone overlay). null = no zone. */
  onSnapHint?: (zone: SnapZone) => void
  /** Apply a snap on release (store.snap). If absent, the dragged rect commits. */
  onSnapZone?: (zone: SnapZone) => void
  onStart?: () => void
  disabled?: boolean
}

export function useWindowDrag(opts: DragOpts) {
  const { winRef, getRect, onCommit, onSnapHint, onSnapZone, onStart, disabled } = opts
  return useCallback(
    (e: React.PointerEvent) => {
      if (disabled || e.button !== 0) return
      const el = winRef.current
      if (!el) return
      onStart?.()
      const start = getRect()
      const ox = e.clientX
      const oy = e.clientY
      const handle = e.currentTarget as HTMLElement
      handle.setPointerCapture(e.pointerId)
      el.style.willChange = 'left, top'
      let rect = start
      let zone: SnapZone = null

      const move = (ev: PointerEvent) => {
        const nx = start.x + (ev.clientX - ox)
        const ny = Math.max(MENUBAR_H, start.y + (ev.clientY - oy))
        rect = { ...start, x: nx, y: ny }
        el.style.left = `${nx}px`
        el.style.top = `${ny}px`
        if (ev.clientY <= MENUBAR_H + 6) zone = 'maximize'
        else if (ev.clientX <= 4) zone = 'left'
        else if (ev.clientX >= window.innerWidth - 4) zone = 'right'
        else zone = null
        onSnapHint?.(zone)
      }
      const up = (ev: PointerEvent) => {
        handle.releasePointerCapture?.(ev.pointerId)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        el.style.willChange = ''
        onSnapHint?.(null)
        if (zone && onSnapZone) onSnapZone(zone)
        else onCommit(rect)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [winRef, getRect, onCommit, onSnapHint, onSnapZone, onStart, disabled],
  )
}

type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

interface ResizeOpts {
  winRef: RefObject<HTMLElement | null>
  getRect: () => Rect
  onCommit: (rect: Rect) => void
  onStart?: () => void
}

export function useWindowResize(opts: ResizeOpts) {
  const { winRef, getRect, onCommit, onStart } = opts
  return useCallback(
    (dir: Dir) => (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.stopPropagation()
      const el = winRef.current
      if (!el) return
      onStart?.()
      const start = getRect()
      const ox = e.clientX
      const oy = e.clientY
      const handle = e.currentTarget as HTMLElement
      handle.setPointerCapture(e.pointerId)
      el.style.willChange = 'width, height, left, top'
      let rect = start

      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - ox
        const dy = ev.clientY - oy
        let { x, y, w, h } = start
        if (dir.includes('e')) w = Math.max(MIN_W, start.w + dx)
        if (dir.includes('s')) h = Math.max(MIN_H, start.h + dy)
        if (dir.includes('w')) {
          const nw = Math.max(MIN_W, start.w - dx)
          x = start.x + (start.w - nw)
          w = nw
        }
        if (dir.includes('n')) {
          const nh = Math.max(MIN_H, start.h - dy)
          y = Math.max(MENUBAR_H, start.y + (start.h - nh))
          h = nh
        }
        rect = { x, y, w, h }
        el.style.left = `${x}px`
        el.style.top = `${y}px`
        el.style.width = `${w}px`
        el.style.height = `${h}px`
      }
      const up = (ev: PointerEvent) => {
        handle.releasePointerCapture?.(ev.pointerId)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        el.style.willChange = ''
        onCommit(rect)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [winRef, getRect, onCommit, onStart],
  )
}
