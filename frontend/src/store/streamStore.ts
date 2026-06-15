import { create } from 'zustand'
import type { StreamSettings } from '@/types'
import { ws } from '@/lib/wsClient'
import * as api from '@/lib/restClient'

interface StreamState {
  quality: number
  fps: number
  scale: number
  controlling: boolean
  screenWidth: number
  screenHeight: number
  hydrate: (s: Partial<StreamSettings & { screenWidth: number; screenHeight: number }>) => void
  setSettings: (s: Partial<StreamSettings>) => void
  setControlling: (v: boolean) => void
  toggleControl: () => void
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

export const useStreamStore = create<StreamState>((set, get) => ({
  quality: 75,
  fps: 12,
  scale: 1.0,
  controlling: false,
  screenWidth: 0,
  screenHeight: 0,

  hydrate(s) {
    set((prev) => ({
      quality: s.quality ?? prev.quality,
      fps: s.fps ?? prev.fps,
      scale: s.scale ?? prev.scale,
      screenWidth: s.screenWidth ?? prev.screenWidth,
      screenHeight: s.screenHeight ?? prev.screenHeight,
    }))
  },

  setSettings(s) {
    set((prev) => ({
      quality: s.quality ?? prev.quality,
      fps: s.fps ?? prev.fps,
      scale: s.scale ?? prev.scale,
    }))
    // Apply live to the stream immediately (affects all clients)...
    ws.send({ type: 'stream_settings', ...s })
    // ...and persist (debounced) so it survives reconnects.
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      const { quality, fps, scale } = get()
      void api.setStream({ quality, fps, scale }).catch(() => {})
    }, 400)
  },

  setControlling(v) {
    set({ controlling: v })
    if (!v) ws.send({ type: 'release_modifiers' })
  },

  toggleControl() {
    get().setControlling(!get().controlling)
  },
}))
