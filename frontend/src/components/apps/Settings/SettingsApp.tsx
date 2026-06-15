import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { AppProps } from '@/types'
import { Icon } from '@/components/common/Icon'
import type { IconName } from '@/components/common/Icon'
import { StreamSettingsPanel } from './StreamSettingsPanel'
import { WallpaperPicker } from './WallpaperPicker'
import { PasswordPanel } from './PasswordPanel'
import { ConnectionInfo } from './ConnectionInfo'
import './settings.css'

type Section = 'display' | 'wallpaper' | 'security' | 'about'

interface NavDef {
  id: Section
  label: string
  title: string
  icon: IconName
  chip: string
}

const NAV: NavDef[] = [
  {
    id: 'display',
    label: 'Display & Stream',
    title: 'Display & Stream',
    icon: 'monitor',
    chip: 'linear-gradient(135deg, #2f9bff, #0a5cff)',
  },
  {
    id: 'wallpaper',
    label: 'Wallpaper',
    title: 'Wallpaper',
    icon: 'image',
    chip: 'linear-gradient(135deg, #b46bff, #6d4bff)',
  },
  {
    id: 'security',
    label: 'Security',
    title: 'Security',
    icon: 'lock',
    chip: 'linear-gradient(135deg, #ffae3c, #ff7a18)',
  },
  {
    id: 'about',
    label: 'About',
    title: 'About & Connection',
    icon: 'info',
    chip: 'linear-gradient(135deg, #9aa0aa, #5a606b)',
  },
]

function isSection(v: unknown): v is Section {
  return v === 'display' || v === 'wallpaper' || v === 'security' || v === 'about'
}

export function SettingsApp(props: AppProps) {
  const requested = props.props?.section
  const [active, setActive] = useState<Section>(isSection(requested) ? requested : 'display')
  const current = NAV.find((n) => n.id === active) ?? NAV[0]

  return (
    <div className="set-root">
      <aside className="set-sidebar">
        <div className="set-sidebar-title">Settings</div>
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`set-nav-item${item.id === active ? ' is-active' : ''}`}
            onClick={() => setActive(item.id)}
            aria-current={item.id === active}
          >
            <span className="set-chip" style={{ background: item.chip }}>
              <Icon name={item.icon} size={15} strokeWidth={1.9} />
            </span>
            <span className="set-nav-label">{item.label}</span>
          </button>
        ))}
      </aside>

      <section className="set-detail">
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            className="set-panel"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <h1 className="set-h1">{current.title}</h1>
            {active === 'display' && <StreamSettingsPanel />}
            {active === 'wallpaper' && <WallpaperPicker />}
            {active === 'security' && <PasswordPanel />}
            {active === 'about' && <ConnectionInfo />}
          </motion.div>
        </AnimatePresence>
      </section>
    </div>
  )
}
