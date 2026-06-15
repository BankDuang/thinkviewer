import type { ComponentType } from 'react'
import type { AppKind, AppProps } from '@/types'
import { RemoteDesktop } from '@/components/apps/RemoteDesktop/RemoteDesktop'
import { TerminalApp } from '@/components/apps/Terminal/TerminalApp'
import { FilesApp } from '@/components/apps/Files/FilesApp'
import { SettingsApp } from '@/components/apps/Settings/SettingsApp'
import { ServersApp } from '@/components/apps/Servers/ServersApp'

export interface AppDef {
  kind: AppKind
  title: string
  defaultSize: { w: number; h: number }
  singleton: boolean
  Component: ComponentType<AppProps>
}

export const APP_REGISTRY: Record<AppKind, AppDef> = {
  remote: {
    kind: 'remote',
    title: 'Remote Desktop',
    defaultSize: { w: 1000, h: 680 },
    singleton: true,
    Component: RemoteDesktop,
  },
  terminal: {
    kind: 'terminal',
    title: 'Terminal',
    defaultSize: { w: 820, h: 520 },
    singleton: true,
    Component: TerminalApp,
  },
  files: {
    kind: 'files',
    title: 'Files',
    defaultSize: { w: 880, h: 600 },
    singleton: true,
    Component: FilesApp,
  },
  settings: {
    kind: 'settings',
    title: 'Settings',
    defaultSize: { w: 740, h: 540 },
    singleton: true,
    Component: SettingsApp,
  },
  servers: {
    kind: 'servers',
    title: 'Servers',
    defaultSize: { w: 920, h: 620 },
    singleton: true,
    Component: ServersApp,
  },
}

// Order shown on the desktop grid and in the dock.
export const APP_ORDER: AppKind[] = ['remote', 'terminal', 'files', 'settings', 'servers']
