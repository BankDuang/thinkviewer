// Named 24x24 stroke glyphs (stroke=currentColor). Add new glyphs to GLYPHS.
import type { CSSProperties } from 'react'

export type IconName =
  | 'close'
  | 'minus'
  | 'fullscreen'
  | 'plus'
  | 'search'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'grid'
  | 'list'
  | 'new-folder'
  | 'upload'
  | 'download'
  | 'refresh'
  | 'trash'
  | 'monitor'
  | 'keyboard'
  | 'cursor'
  | 'clipboard'
  | 'expand'
  | 'zoom-in'
  | 'zoom-out'
  | 'power'
  | 'sliders'
  | 'gear'
  | 'lock'
  | 'eye'
  | 'eye-off'
  | 'info'
  | 'signal'
  | 'home'
  | 'folder'
  | 'file'
  | 'image'
  | 'aperture'
  | 'check'
  | 'x-circle'
  | 'alert'
  | 'terminal'
  | 'paintbrush'
  | 'logout'

const GLYPHS: Record<IconName, JSX.Element> = {
  close: <path d="M6 6l12 12M18 6L6 18" />,
  minus: <path d="M5 12h14" />,
  fullscreen: <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  'chevron-left': <path d="M15 6l-6 6 6 6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="3.5" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="18" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  'new-folder': (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6L11.5 7H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M12 11v5M9.5 13.5h5" />
    </>
  ),
  upload: <path d="M12 16V4m0 0L7 9m5-5l5 5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />,
  download: <path d="M12 4v12m0 0l-5-5m5 5l5-5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />,
  refresh: <path d="M21 12a9 9 0 1 1-2.64-6.36M21 4v4h-4" />,
  trash: <path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m2 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </>
  ),
  cursor: <path d="M5 3l6 18 2.5-7L20 11.5z" />,
  clipboard: (
    <>
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <path d="M9 4a3 3 0 0 1 6 0" />
    </>
  ),
  expand: <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4m11-5v4a1 1 0 0 1-1 1h-4" />,
  'zoom-in': (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3M11 8v6M8 11h6" />
    </>
  ),
  'zoom-out': (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3M8 11h6" />
    </>
  ),
  power: <path d="M12 3v9M7 6a8 8 0 1 0 10 0" />,
  sliders: <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4M14 4v4M6 10v4M12 16v4" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5l1.4 2.2 2.6-.5.5 2.6 2.2 1.4-1.1 2.3 1.1 2.3-2.2 1.4-.5 2.6-2.6-.5L12 21.5l-1.4-2.2-2.6.5-.5-2.6-2.2-1.4 1.1-2.3-1.1-2.3 2.2-1.4.5-2.6 2.6.5z" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'eye-off': <path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.4 5.2A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.4 4.3M6.2 6.2A17.4 17.4 0 0 0 2 12s3.5 7 10 7a10.7 10.7 0 0 0 3.4-.5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <circle cx="12" cy="7.8" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  signal: <path d="M4 18v-3M9 18v-7M14 18v-11M19 18V5" />,
  home: <path d="M3 11l9-8 9 8M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6L11.5 7H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  file: <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5" />,
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.8" />
      <path d="M21 16l-5-5L5 20" />
    </>
  ),
  aperture: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v6M21 9l-5.2 3M18.5 19l-3.2-5.5M5.5 19l5.7-3M3 9l5.2 3" />
    </>
  ),
  check: <path d="M5 13l4 4L19 7" />,
  'x-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  alert: <path d="M12 3l9 16H3zM12 10v4M12 17h.01" />,
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3M13 15h4" />
    </>
  ),
  paintbrush: <path d="M3 21c2-1 2.5-3 3.5-4S9 15 10 16s1 3-1 4-6 1-6 1zM9 14l8.5-8.5a2.1 2.1 0 0 1 3 3L12 17" />,
  logout: <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h12" />,
}

interface IconProps {
  name: IconName
  size?: number
  strokeWidth?: number
  className?: string
  style?: CSSProperties
}

export function Icon({ name, size = 18, strokeWidth = 1.7, className, style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {GLYPHS[name]}
    </svg>
  )
}
