// REST DTOs. Mirrors the FastAPI JSON responses in main.py.

export interface FileEntry {
  name: string
  path: string
  is_dir: boolean
  size: number
  modified: string
  error?: string
}

export interface ListFilesResp {
  path: string
  parent: string
  items: FileEntry[]
}

export interface DeviceInfo {
  device_id: string
  password: string
  hostname: string
  platform: string
  screen_width: number
  screen_height: number
  connected_clients: number
  fps: number
  quality: number
  scale: number
  wallpaper: string | null
}

export interface StreamSettings {
  quality: number
  fps: number
  scale: number
}

export interface LoginResp {
  success: boolean
  token: string
}

export interface PasteImageResp {
  path: string
  size: number
}

export interface Wallpaper {
  id: string
  name: string
  url: string
  builtin: boolean
}

export interface WallpapersResp {
  selected: string | null
  wallpapers: Wallpaper[]
}

// --- Servers (process manager) ---
export interface ManagedService {
  id: string
  name: string
  cwd: string
  entry: string
  python: string
  port: number | null
  pid: number | null
  started_at: string | null
  args: string[]
  env: Record<string, string>
  running: boolean
  port_open: boolean | null
  uptime: number | null
  exit_code: number | null
  log_exists: boolean
  domain: string | null
  email: string | null
  https: boolean
}

export interface ServersResp {
  base_dir: string
  services: ManagedService[]
}

export interface DiscoveredFolder {
  name: string
  path: string
  entries: string[]
  suggested_entry: string | null
  has_venv: boolean
}

export interface DiscoverResp {
  base_dir: string
  folders: DiscoveredFolder[]
}

export interface Interpreter {
  label: string
  path: string
  kind: 'venv' | 'pyenv' | 'system'
}

export interface ServiceInput {
  name?: string
  cwd: string
  entry: string
  python?: string
  port?: number | null
  args?: string[]
  env?: Record<string, string>
  domain?: string
  email?: string
}

export interface DeployInfo {
  kit_dir: string
  kit_found: boolean
  nginx: string | null
  certbot: string | null
  public_ip: string | null
}

export interface ReachabilityResp {
  output: string
  code: number
}

export interface DeployLog {
  running: boolean
  success: boolean | null
  exit: number | null
  domain: string | null
  log: string
}
