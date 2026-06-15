import type { AppKind } from './windows'

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface DesktopIcon {
  id: string
  app: AppKind
  label: string
  x: number
  y: number
}

export type ToastKind = 'info' | 'ok' | 'warn' | 'error'

export interface Toast {
  id: string
  kind: ToastKind
  text: string
}
