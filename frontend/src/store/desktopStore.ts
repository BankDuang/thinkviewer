import { create } from 'zustand'
import type { Wallpaper } from '@/types'
import * as api from '@/lib/restClient'
import { storage } from '@/lib/storage'
import { notify } from './notificationStore'

const DEFAULT_WALLPAPER = 'wp-aurora-blue.png'
const urlFor = (id: string) => `/static/wallpapers/${id}`
const MENU_STATS_KEY = 'menubarStats'
const MENU_NET_KEY = 'menubarNet'

interface DesktopState {
  wallpaperId: string | null
  wallpaperUrl: string
  wallpapers: Wallpaper[]
  loading: boolean
  showMenuStats: boolean
  setMenuStats: (v: boolean) => void
  showMenuNet: boolean
  setMenuNet: (v: boolean) => void
  loadWallpapers: () => Promise<void>
  setWallpaper: (id: string) => Promise<void>
  addUploaded: (wp: Wallpaper) => void
  removeWallpaper: (id: string) => Promise<void>
}

export const useDesktopStore = create<DesktopState>((set, get) => ({
  wallpaperId: null,
  wallpaperUrl: urlFor(DEFAULT_WALLPAPER),
  wallpapers: [],
  loading: false,
  showMenuStats: storage.get<boolean>(MENU_STATS_KEY, true),

  setMenuStats(v) {
    storage.set(MENU_STATS_KEY, v)
    set({ showMenuStats: v })
  },

  showMenuNet: storage.get<boolean>(MENU_NET_KEY, true),

  setMenuNet(v) {
    storage.set(MENU_NET_KEY, v)
    set({ showMenuNet: v })
  },

  async loadWallpapers() {
    set({ loading: true })
    try {
      const { selected, wallpapers } = await api.getWallpapers()
      const id = selected || DEFAULT_WALLPAPER
      set({
        wallpapers: wallpapers.filter((w) => w.id !== 'login-bg.png'),
        wallpaperId: id,
        wallpaperUrl: urlFor(id),
      })
    } catch {
      /* keep default */
    } finally {
      set({ loading: false })
    }
  },

  async setWallpaper(id) {
    const prev = get().wallpaperId
    set({ wallpaperId: id, wallpaperUrl: urlFor(id) }) // optimistic crossfade
    try {
      await api.selectWallpaper(id)
    } catch {
      set({ wallpaperId: prev, wallpaperUrl: urlFor(prev || DEFAULT_WALLPAPER) })
      notify('error', 'Could not change wallpaper')
    }
  },

  addUploaded(wp) {
    set({ wallpapers: [...get().wallpapers, wp] })
  },

  async removeWallpaper(id) {
    try {
      await api.deleteWallpaper(id)
      set({ wallpapers: get().wallpapers.filter((w) => w.id !== id) })
      if (get().wallpaperId === id) await get().setWallpaper(DEFAULT_WALLPAPER)
    } catch {
      notify('error', 'Could not delete wallpaper')
    }
  },
}))
