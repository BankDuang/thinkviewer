import { create } from 'zustand'
import type { ConnectionStatus } from '@/types'

interface ConnectionState {
  status: ConnectionStatus
  set: (status: ConnectionStatus) => void
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: 'closed',
  set: (status) => set({ status }),
}))
