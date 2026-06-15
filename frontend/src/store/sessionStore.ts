import { create } from 'zustand'
import type { DeviceInfo, User } from '@/types'
import * as api from '@/lib/restClient'
import { storage, TOKEN_KEY } from '@/lib/storage'

type Status = 'idle' | 'connecting' | 'authed' | 'error'

interface SessionState {
  token: string | null
  status: Status
  info: DeviceInfo | null
  user: User | null
  error: string | null
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  resume: () => Promise<boolean>
  refreshInfo: () => Promise<void>
}

export const useSessionStore = create<SessionState>((set, get) => ({
  token: null,
  status: 'idle',
  info: null,
  user: null,
  error: null,

  async login(username, password) {
    set({ status: 'connecting', error: null })
    try {
      const { token, user } = await api.login(username, password)
      api.setAuthToken(token)
      storage.set(TOKEN_KEY, token)
      const info = await api.getInfo()
      set({ token, info, user, status: 'authed', error: null })
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
    set({ token: null, info: null, user: null, status: 'idle', error: null })
  },

  async resume() {
    const token = storage.get<string | null>(TOKEN_KEY, null)
    if (!token) return false
    api.setAuthToken(token)
    try {
      const [info, user] = await Promise.all([api.getInfo(), api.getMe()])
      set({ token, info, user, status: 'authed' })
      return true
    } catch {
      api.setAuthToken(null)
      storage.remove(TOKEN_KEY)
      set({ token: null, info: null, user: null, status: 'idle' })
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
