import { create } from 'zustand'
import type { DeviceInfo } from '@/types'
import * as api from '@/lib/restClient'
import { storage, TOKEN_KEY } from '@/lib/storage'

type Status = 'idle' | 'connecting' | 'authed' | 'error'

interface SessionState {
  token: string | null
  status: Status
  info: DeviceInfo | null
  error: string | null
  login: (password: string) => Promise<void>
  logout: () => Promise<void>
  resume: () => Promise<boolean>
  refreshInfo: () => Promise<void>
}

export const useSessionStore = create<SessionState>((set, get) => ({
  token: null,
  status: 'idle',
  info: null,
  error: null,

  async login(password) {
    set({ status: 'connecting', error: null })
    try {
      const { token } = await api.login(password)
      api.setAuthToken(token)
      storage.set(TOKEN_KEY, token)
      const info = await api.getInfo()
      set({ token, info, status: 'authed', error: null })
    } catch (e) {
      api.setAuthToken(null)
      set({ status: 'error', error: e instanceof Error ? e.message : 'Login failed' })
      throw e
    }
  },

  async logout() {
    try {
      await api.logout()
    } catch {
      /* best effort */
    }
    api.setAuthToken(null)
    storage.remove(TOKEN_KEY)
    set({ token: null, info: null, status: 'idle', error: null })
  },

  async resume() {
    const token = storage.get<string | null>(TOKEN_KEY, null)
    if (!token) return false
    api.setAuthToken(token)
    try {
      const info = await api.getInfo()
      set({ token, info, status: 'authed' })
      return true
    } catch {
      api.setAuthToken(null)
      storage.remove(TOKEN_KEY)
      set({ token: null, info: null, status: 'idle' })
      return false
    }
  },

  async refreshInfo() {
    if (!get().token) return
    try {
      set({ info: await api.getInfo() })
    } catch {
      /* ignore */
    }
  },
}))
