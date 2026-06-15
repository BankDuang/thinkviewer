import type { AppKind } from '@/types'
import { APP_REGISTRY } from '@/registry/appRegistry'
import { useWindowStore } from '@/store/windowStore'
import { MENUBAR_H } from './layout'

/** Open (or focus, if singleton) an app window, centered with a slight cascade. */
export function openApp(app: AppKind): string {
  const def = APP_REGISTRY[app]
  const store = useWindowStore.getState()
  const count = store.order.length
  const w = Math.min(def.defaultSize.w, window.innerWidth - 60)
  const h = Math.min(def.defaultSize.h, window.innerHeight - MENUBAR_H - 80)
  const cascade = (count % 6) * 28
  const x = Math.max(20, (window.innerWidth - w) / 2 - 40 + cascade)
  const y = MENUBAR_H + 32 + cascade
  return store.open(app, {
    title: def.title,
    rect: { x, y, w, h },
    singleton: def.singleton,
  })
}
