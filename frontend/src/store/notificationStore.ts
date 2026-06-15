import { create } from 'zustand'
import type { Toast, ToastKind } from '@/types'
import { nextId } from '@/lib/layout'

interface NotificationState {
  toasts: Toast[]
  push: (kind: ToastKind, text: string) => void
  dismiss: (id: string) => void
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  toasts: [],
  push(kind, text) {
    const id = nextId('toast')
    set({ toasts: [...get().toasts, { id, kind, text }] })
    setTimeout(() => get().dismiss(id), 4200)
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },
}))

/** Convenience for non-React modules. */
export const notify = (kind: ToastKind, text: string) =>
  useNotificationStore.getState().push(kind, text)
