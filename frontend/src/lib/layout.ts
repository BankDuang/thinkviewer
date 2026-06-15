import type { Rect } from '@/types'

export const MENUBAR_H = 28
export const DOCK_RESERVED = 96 // bottom space the dock floats over
export const MIN_W = 360
export const MIN_H = 240

/** Usable desktop rect below the menu bar (the dock floats, so not subtracted). */
export function getWorkArea(): Rect {
  return {
    x: 0,
    y: MENUBAR_H,
    w: window.innerWidth,
    h: window.innerHeight - MENUBAR_H,
  }
}

export function maximizedRect(): Rect {
  const wa = getWorkArea()
  return { ...wa, h: wa.h - 12 } // tiny gap above the floating dock
}

export function clampRectToViewport(rect: Rect): Rect {
  const maxX = window.innerWidth - 80
  const maxY = window.innerHeight - 80
  return {
    w: Math.max(MIN_W, rect.w),
    h: Math.max(MIN_H, rect.h),
    x: Math.min(Math.max(rect.x, -rect.w + 120), maxX),
    y: Math.min(Math.max(rect.y, MENUBAR_H), maxY),
  }
}

let _z = 0
export function nextId(prefix = 'w'): string {
  _z += 1
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.floor(Math.random() * 1e9).toString(36)
  return `${prefix}-${_z}-${rand}`
}
