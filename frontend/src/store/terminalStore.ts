import { create } from 'zustand'
import type { TermSessionMeta } from '@/types'

// Shared, multi-client session metadata (the tab list). The actual xterm
// instances live in lib/terminalRegistry, NOT here.

interface TerminalState {
  sessions: Record<string, TermSessionMeta>
  order: string[]
  activeId: string | null
  // A one-shot request (from the Servers app) to open a project in the Terminal:
  // focus the tab named `name` if it exists, else create one cd'd into `cwd`.
  pendingOpen: { name: string; cwd: string } | null
  upsert: (m: TermSessionMeta) => void
  remove: (id: string) => void
  rename: (id: string, name: string) => void
  setActive: (id: string | null) => void
  replaceAll: (list: TermSessionMeta[]) => void
  requestOpen: (name: string, cwd: string) => void
  consumeOpen: () => void
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: {},
  order: [],
  activeId: null,
  pendingOpen: null,

  upsert(m) {
    const { sessions, order, activeId } = get()
    const exists = !!sessions[m.session_id]
    set({
      sessions: { ...sessions, [m.session_id]: { ...sessions[m.session_id], ...m } },
      order: exists ? order : [...order, m.session_id],
      activeId: activeId ?? m.session_id,
    })
  },

  remove(id) {
    const { sessions, order, activeId } = get()
    const next = { ...sessions }
    delete next[id]
    const newOrder = order.filter((i) => i !== id)
    set({
      sessions: next,
      order: newOrder,
      activeId: activeId === id ? newOrder[newOrder.length - 1] ?? null : activeId,
    })
  },

  rename(id, name) {
    const { sessions } = get()
    if (!sessions[id]) return
    set({ sessions: { ...sessions, [id]: { ...sessions[id], name } } })
  },

  setActive(id) {
    set({ activeId: id })
  },

  replaceAll(list) {
    const sessions: Record<string, TermSessionMeta> = {}
    const order: string[] = []
    for (const m of list) {
      sessions[m.session_id] = m
      order.push(m.session_id)
    }
    const { activeId } = get()
    set({
      sessions,
      order,
      activeId: activeId && sessions[activeId] ? activeId : order[0] ?? null,
    })
  },

  requestOpen(name, cwd) {
    set({ pendingOpen: { name, cwd } })
  },

  consumeOpen() {
    set({ pendingOpen: null })
  },
}))
