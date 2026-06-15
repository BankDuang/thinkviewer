// Colorful rounded-squircle app icons (macOS Big Sur style): gradient tile +
// top light highlight + inner stroke + centered white glyph. Crisp at any size.
import type { AppKind } from '@/types'

interface TileDef {
  from: string
  to: string
  glyph: JSX.Element
}

const TILES: Record<AppKind, TileDef> = {
  remote: {
    from: '#54a8ff',
    to: '#0a5cff',
    glyph: (
      <g fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <rect x="13" y="17" width="30" height="20" rx="3.5" />
        <path d="M23 43h10M28 37v6" />
        <path d="M37 12.5a9 9 0 0 1 6.4 6.4M37 17.6a4 4 0 0 1 2.9 2.9" />
      </g>
    ),
  },
  terminal: {
    from: '#3a3a42',
    to: '#101015',
    glyph: (
      <g fill="none" stroke="#e8ffe8" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 20l9 8-9 8" />
        <path d="M30 38h12" stroke="#46d369" />
      </g>
    ),
  },
  files: {
    from: '#4aa6ff',
    to: '#1f6dff',
    glyph: (
      <g>
        <path
          d="M14 21a3 3 0 0 1 3-3h7.2a3 3 0 0 1 2.1.9l2.4 2.4H39a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H17a3 3 0 0 1-3-3z"
          fill="#fff"
          opacity="0.96"
        />
        <rect x="20" y="15" width="14" height="10" rx="1.6" fill="#fff" opacity="0.55" />
      </g>
    ),
  },
  settings: {
    from: '#9a9ca3',
    to: '#56585f',
    glyph: (
      <g fill="none" stroke="#fff" strokeWidth="3" strokeLinejoin="round">
        <circle cx="28" cy="28" r="6" />
        <path d="M28 13.5l3 4.6 5.4-1 .9 5.4 4.6 3-2.3 5 2.3 5-4.6 3-.9 5.4-5.4-1-3 4.6-3-4.6-5.4 1-.9-5.4-4.6-3 2.3-5-2.3-5 4.6-3 .9-5.4 5.4 1z" />
      </g>
    ),
  },
  servers: {
    from: '#3ad6a0',
    to: '#0e9171',
    glyph: (
      <g fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="14" y="15" width="28" height="11" rx="2.6" />
        <rect x="14" y="30" width="28" height="11" rx="2.6" />
        <path d="M34 20.5h3M34 35.5h3" />
        <circle cx="21" cy="20.5" r="1.5" fill="#fff" stroke="none" />
        <circle cx="21" cy="35.5" r="1.5" fill="#fff" stroke="none" />
      </g>
    ),
  },
  clientproject: {
    from: '#b07cff',
    to: '#6d28d9',
    glyph: (
      <g fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="14" y="22" width="28" height="19" rx="3" />
        <path d="M22 22v-3a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v3M14 31h28" />
        <circle cx="28" cy="31" r="1.6" fill="#fff" stroke="none" />
      </g>
    ),
  },
}

export function AppTile({ app, size = 56 }: { app: AppKind; size?: number | string }) {
  const def = TILES[app]
  const gid = `tile-${app}`
  return (
    <svg
      viewBox="0 0 56 56"
      style={{
        display: 'block',
        width: size,
        height: size,
        filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.32))',
      }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={def.from} />
          <stop offset="1" stopColor={def.to} />
        </linearGradient>
        <linearGradient id={`${gid}-hl`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.34" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.05" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="50" height="50" rx="13.5" fill={`url(#${gid})`} />
      <rect x="3" y="3" width="50" height="26" rx="13.5" fill={`url(#${gid}-hl)`} />
      <rect
        x="3.5"
        y="3.5"
        width="49"
        height="49"
        rx="13"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.18"
      />
      {def.glyph}
    </svg>
  )
}
