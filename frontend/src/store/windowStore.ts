import { create } from 'zustand'
import type { AppKind, Rect, SnapZone, WindowState } from '@/types'
import { clampRectToViewport, maximizedRect, MENUBAR_H, nextId } from '@/lib/layout'

interface OpenOpts {
  title: string
  rect: Rect
  singleton?: boolean
  props?: Record<string, unknown>
}

interface WindowStoreState {
  windows: Record<string, WindowState>
  order: string[] // z-order, last = topmost
  focusedId: string | null
  open: (app: AppKind, opts: OpenOpts) => string
  close: (id: string) => void
  focus: (id: string) => void
  setRect: (id: string, rect: Rect) => void
  minimize: (id: string) => void
  restore: (id: string) => void
  toggleMinimize: (id: string) => void
  toggleMaximize: (id: string) => void
  snap: (id: string, zone: SnapZone) => void
}

export const useWindowStore = create<WindowStoreState>((set, get) => ({
  windows: {},
  order: [],
  focusedId: null,

  open(app, opts) {
    const { windows, order } = get()
    if (opts.singleton) {
      const existing = Object.values(windows).find((w) => w.app === app)
      if (existing) {
        // Bring to front + un-minimize instead of opening a duplicate.
        set({
          order: [...order.filter((i) => i !== existing.id), existing.id],
          focusedId: existing.id,
          windows: { ...windows, [existing.id]: { ...existing, minimized: false } },
        })
        return existing.id
      }
    }
    const id = nextId(app)
    const win: WindowState = {
      id,
      app,
      title: opts.title,
      rect: clampRectToViewport(opts.rect),
      prevRect: null,
      minimized: false,
      maximized: false,
      props: opts.props,
    }
    set({
      windows: { ...windows, [id]: win },
      order: [...order, id],
      focusedId: id,
    })
    return id
  },

  close(id) {
    const { windows, order, focusedId } = get()
    const next = { ...windows }
    delete next[id]
    const newOrder = order.filter((i) => i !== id)
    set({
      windows: next,
      order: newOrder,
      focusedId: focusedId === id ? newOrder[newOrder.length - 1] ?? null : focusedId,
    })
  },

  focus(id) {
    const { order, windows } = get()
    if (!windows[id]) return
    if (order[order.length - 1] === id && !windows[id].minimized) {
      set({ focusedId: id })
      return
    }
    set({
      order: [...order.filter((i) => i !== id), id],
      focusedId: id,
      windows: { ...windows, [id]: { ...windows[id], minimized: false } },
    })
  },

  setRect(id, rect) {
    const { windows } = get()
    const w = windows[id]
    if (!w) return
    set({ windows: { ...windows, [id]: { ...w, rect, maximized: false } } })
  },

  minimize(id) {
    const { windows, order, focusedId } = get()
    const w = windows[id]
    if (!w) return
    const rest = order.filter((i) => i !== id && !windows[i].minimized)
    set({
      windows: { ...windows, [id]: { ...w, minimized: true } },
      focusedId: focusedId === id ? rest[rest.length - 1] ?? null : focusedId,
    })
  },

  restore(id) {
    get().focus(id)
  },

  toggleMinimize(id) {
    const w = get().windows[id]
    if (!w) return
    if (w.minimized) get().focus(id)
    else get().minimize(id)
  },

  toggleMaximize(id) {
    const { windows } = get()
    const w = windows[id]
    if (!w) return
    if (w.maximized) {
      set({
        windows: {
          ...windows,
          [id]: { ...w, rect: w.prevRect ?? w.rect, maximized: false, prevRect: null },
        },
      })
    } else {
      set({
        windows: {
          ...windows,
          [id]: { ...w, prevRect: w.rect, rect: maximizedRect(), maximized: true },
        },
      })
    }
    get().focus(id)
  },

  snap(id, zone) {
    const { windows } = get()
    const w = windows[id]
    if (!w || !zone) return
    const W = window.innerWidth
    const H = window.innerHeight - MENUBAR_H
    let rect: Rect
    if (zone === 'left') rect = { x: 0, y: MENUBAR_H, w: W / 2, h: H }
    else if (zone === 'right') rect = { x: W / 2, y: MENUBAR_H, w: W / 2, h: H }
    else rect = maximizedRect() // 'top' | 'maximize'
    set({
      windows: {
        ...windows,
        [id]: { ...w, prevRect: w.maximized ? w.prevRect : w.rect, rect, maximized: zone === 'maximize' || zone === 'top' },
      },
    })
  },
}))
