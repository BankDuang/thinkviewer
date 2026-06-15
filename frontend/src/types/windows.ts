// Window-manager + app-registry types.

export type AppKind = 'remote' | 'terminal' | 'files' | 'settings' | 'servers' | 'clientproject'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type SnapZone = 'left' | 'right' | 'top' | 'maximize' | null

export interface WindowState {
  id: string
  app: AppKind
  title: string
  rect: Rect
  prevRect: Rect | null
  minimized: boolean
  maximized: boolean
  props?: Record<string, unknown>
}

/** Props every app component receives from the window manager. */
export interface AppProps {
  windowId: string
  focused: boolean
  props?: Record<string, unknown>
}
