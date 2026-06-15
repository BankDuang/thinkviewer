import type { FileEntry } from '@/types'

type CatKey = 'image' | 'code' | 'archive' | 'audio' | 'video' | 'pdf' | 'generic'

const EXT_CAT: Record<string, CatKey> = {
  // images
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
  bmp: 'image', ico: 'image', heic: 'image', tiff: 'image', avif: 'image',
  // code / text
  js: 'code', mjs: 'code', cjs: 'code', ts: 'code', tsx: 'code', jsx: 'code', py: 'code',
  rb: 'code', go: 'code', rs: 'code', c: 'code', h: 'code', cpp: 'code', cc: 'code',
  java: 'code', kt: 'code', swift: 'code', php: 'code', html: 'code', css: 'code',
  scss: 'code', json: 'code', yaml: 'code', yml: 'code', toml: 'code', xml: 'code',
  sh: 'code', bash: 'code', zsh: 'code', sql: 'code', vue: 'code', md: 'code', txt: 'code',
  // archives
  zip: 'archive', tar: 'archive', gz: 'archive', tgz: 'archive', rar: 'archive',
  '7z': 'archive', bz2: 'archive', xz: 'archive', dmg: 'archive',
  // audio
  mp3: 'audio', wav: 'audio', flac: 'audio', aac: 'audio', ogg: 'audio', m4a: 'audio',
  // video
  mp4: 'video', mov: 'video', avi: 'video', mkv: 'video', webm: 'video', m4v: 'video',
  // pdf
  pdf: 'pdf',
}

const CAT_COLOR: Record<CatKey, string> = {
  image: '#30c46b',
  code: '#0a84ff',
  archive: '#d39a3a',
  audio: '#ff3b6b',
  video: '#bf5af2',
  pdf: '#ff453a',
  generic: '#8b93a1',
}

function fileMeta(name: string): { color: string; label: string } {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  const cat = EXT_CAT[ext] ?? 'generic'
  const label = ext ? ext.toUpperCase() : 'FILE'
  return { color: CAT_COLOR[cat], label }
}

interface FileIconProps {
  entry: FileEntry
  size?: number
}

/** Finder-style icon: filled folder, or a document page tinted by file category. */
export function FileIcon({ entry, size = 56 }: FileIconProps) {
  if (entry.is_dir) {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" style={{ display: 'block' }} aria-hidden="true">
        <path
          d="M6 13a3 3 0 0 1 3-3h9l3.2 3.4a2 2 0 0 0 1.5 0.6H39a3 3 0 0 1 3 3v3H6z"
          fill="#2f86e0"
        />
        <path
          d="M4 18a3 3 0 0 1 3-3h34a3 3 0 0 1 3 3v16a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z"
          fill="#54a6ff"
        />
      </svg>
    )
  }

  const { color, label } = fileMeta(entry.name)
  const disp = label.length > 4 ? label.slice(0, 4) : label
  const fs = disp.length <= 2 ? 9 : disp.length === 3 ? 7.6 : 6.4

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" style={{ display: 'block' }} aria-hidden="true">
      <path
        d="M12 5h15l8 8v27a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z"
        fill="#f7f9fc"
        stroke="rgba(0,0,0,0.10)"
        strokeWidth={1}
      />
      <path d="M27 5l8 8h-5a3 3 0 0 1-3-3z" fill="#cfd8e6" />
      <rect x="12" y="27" width="22" height="11" rx="2.5" fill={color} />
      <text
        x="23"
        y="34.7"
        textAnchor="middle"
        fontSize={fs}
        fontWeight={700}
        fill="#fff"
        letterSpacing="0.3"
      >
        {disp}
      </text>
    </svg>
  )
}
