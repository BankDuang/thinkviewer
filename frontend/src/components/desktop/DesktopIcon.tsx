import clsx from 'clsx'
import type { AppKind } from '@/types'
import { AppTile } from '@/components/common/AppTile'
import { APP_REGISTRY } from '@/registry/appRegistry'
import { openApp } from '@/lib/openApp'

interface Props {
  app: AppKind
  selected: boolean
  onSelect: () => void
}

export function DesktopIcon({ app, selected, onSelect }: Props) {
  return (
    <div
      className={clsx('desk-icon', selected && 'is-selected')}
      onClick={onSelect}
      onDoubleClick={() => openApp(app)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') openApp(app)
      }}
    >
      <AppTile app={app} size={52} />
      <span className="desk-icon-label">{APP_REGISTRY[app].title}</span>
    </div>
  )
}
