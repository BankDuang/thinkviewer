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

export interface SystemStats {
  cpu: number | null // 0..100
  mem_used: number | null // bytes
  mem_total: number | null // bytes
  mem_percent: number | null // 0..100
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
  root: string // project top-level dir (cwd may be a subfolder like <root>/server)
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

export interface GitPullResp {
  ok: boolean
  code: number
  output: string
  restarted: boolean
  restart_error: string | null
  service: ManagedService
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

export interface PyenvInfo {
  installed: boolean
  has_virtualenv: boolean
  versions: string[] // installed base versions (excludes virtualenvs)
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

export interface SetupLog {
  running: boolean
  success: boolean | null
  venv_python: string | null
  log: string
}

// --- Client Project (CRM) — generic records keyed by the entity's columns ---
export type CpRecord = Record<string, any>

export interface CpDashboard {
  clients_total: number
  clients_active: number
  projects_total: number
  projects_active: number
  projects_delivered: number
  issues_open: number
  issues_critical: number
  tasks_open: number
  tasks_overdue: number
  cr_open: number
  total_budget: number
  outstanding: number
  deadlines: CpRecord[]
  critical_issues: CpRecord[]
  recent_activity: CpRecord[]
}
