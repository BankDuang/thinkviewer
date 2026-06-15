// Typed REST client. The FastAPI backend accepts the auth token in DIFFERENT
// slots depending on the endpoint (Bearer header / ?token= query / form field),
// so this module centralizes that so callers never have to think about it.

import type {
  AppKind,
  CpDashboard,
  CpRecord,
  DeployInfo,
  DeployLog,
  DeviceInfo,
  DiscoverResp,
  GitPullResp,
  Interpreter,
  ListFilesResp,
  PyenvInfo,
  LoginResp,
  ManagedService,
  ManagedUser,
  ReachabilityResp,
  Role,
  ServersResp,
  ServiceInput,
  SetupLog,
  StreamSettings,
  SystemStats,
  User,
  WallpapersResp,
} from '@/types'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

let _token: string | null = null
export function setAuthToken(token: string | null) {
  _token = token
}
export function getAuthToken(): string | null {
  return _token
}

// Callbacks fired on 401 so the app can route back to login (set by sessionStore).
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    onUnauthorized?.()
    throw new ApiError(401, 'Unauthorized')
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body.detail || body.message || detail
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const bearer = () => ({ Authorization: `Bearer ${_token ?? ''}` })

// --- Bearer (JSON body) ----------------------------------------------------
function bearerJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  return fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...bearer() },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => parse<T>(r))
}

// --- Auth (no token) -------------------------------------------------------
export async function login(username: string, password: string): Promise<LoginResp> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (res.ok) return (await res.json()) as LoginResp
  // Surface the server's message (wrong password / brute-force block) verbatim,
  // and do NOT run parse()'s global 401 → onUnauthorized routing: a failed login
  // is expected here and we're already on the login screen.
  let detail = res.statusText
  try {
    const body = await res.json()
    detail = body.detail || body.message || detail
  } catch {
    /* non-JSON error body */
  }
  throw new ApiError(res.status, detail)
}

export function logout(): Promise<{ success: boolean }> {
  return fetch('/api/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: _token ?? '' }),
  }).then((r) => parse<{ success: boolean }>(r))
}

// --- Device / settings (Bearer) -------------------------------------------
export const getInfo = () => bearerJson<DeviceInfo>('GET', '/api/info')
export const getStats = () => bearerJson<SystemStats>('GET', '/api/stats')
export const getMe = () => bearerJson<User>('GET', '/api/me')

// --- Users (admin-only management; Bearer) ---------------------------------
export const listUsers = () =>
  bearerJson<{ users: ManagedUser[]; app_kinds: AppKind[] }>('GET', '/api/users')
export const createUser = (u: { username: string; password: string; role: Role; apps: AppKind[] }) =>
  bearerJson<ManagedUser>('POST', '/api/users', u)
export const updateUser = (
  id: string,
  u: Partial<{ username: string; password: string; role: Role; apps: AppKind[] }>,
) => bearerJson<ManagedUser>('PUT', `/api/users/${id}`, u)
export const deleteUser = (id: string) =>
  bearerJson<{ success: boolean }>('DELETE', `/api/users/${id}`)
export const setStream = (s: Partial<StreamSettings>) =>
  bearerJson<{ success: boolean } & StreamSettings>('POST', '/api/settings/stream', s)
export const setPassword = (password: string) =>
  bearerJson<{ success: boolean }>('POST', '/api/settings/password', { password })

// --- Files -----------------------------------------------------------------
export function listFiles(path: string): Promise<ListFilesResp> {
  const qs = new URLSearchParams({ path, token: _token ?? '' })
  return fetch(`/api/files/list?${qs}`).then((r) => parse<ListFilesResp>(r))
}

export const mkdir = (path: string) =>
  bearerJson<{ success: boolean; path: string }>('POST', '/api/files/mkdir', { path })
export const deleteFile = (path: string) =>
  bearerJson<{ success: boolean }>('DELETE', '/api/files/delete', { path })
export const renameFile = (path: string, name: string) =>
  bearerJson<{ success: boolean; path: string; name: string }>('POST', '/api/files/rename', { path, name })
export const zipFile = (path: string) =>
  bearerJson<{ success: boolean; path: string; name: string }>('POST', '/api/files/zip', { path })

/** Build an authenticated download URL (token in query — usable as <a href download>). */
export function downloadUrl(path: string): string {
  const qs = new URLSearchParams({ path, token: _token ?? '' })
  return `/api/files/download?${qs}`
}

/** Upload a file with progress. Resolves on success, rejects with ApiError. */
export function uploadFile(
  dir: string,
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<{ success: boolean; path: string; size: number }> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)
    form.append('path', dir)
    form.append('token', _token ?? '')
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/files/upload')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total)
    }
    xhr.onload = () => {
      if (xhr.status === 401) {
        onUnauthorized?.()
        reject(new ApiError(401, 'Unauthorized'))
      } else if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText))
        } catch {
          reject(new ApiError(xhr.status, 'Bad response'))
        }
      } else {
        let detail = xhr.statusText
        try {
          detail = JSON.parse(xhr.responseText).detail || detail
        } catch {
          /* ignore */
        }
        reject(new ApiError(xhr.status, detail))
      }
    }
    xhr.onerror = () => reject(new ApiError(0, 'Network error'))
    xhr.send(form)
  })
}

// --- Wallpapers ------------------------------------------------------------
export function getWallpapers(): Promise<WallpapersResp> {
  const qs = new URLSearchParams({ token: _token ?? '' })
  return fetch(`/api/wallpapers?${qs}`).then((r) => parse<WallpapersResp>(r))
}
export const selectWallpaper = (id: string) =>
  bearerJson<{ success: boolean; selected: string; url: string }>(
    'POST',
    '/api/wallpapers/select',
    { id },
  )
export const deleteWallpaper = (id: string) =>
  bearerJson<{ success: boolean }>('DELETE', '/api/wallpapers', { id })

export function uploadWallpaper(
  file: File,
): Promise<{ success: boolean; id: string; url: string }> {
  const form = new FormData()
  form.append('file', file)
  form.append('token', _token ?? '')
  return fetch('/api/wallpapers/upload', { method: 'POST', body: form }).then((r) =>
    parse<{ success: boolean; id: string; url: string }>(r),
  )
}

// --- Servers (process manager; all Bearer) ----------------------------------
export const getServers = () => bearerJson<ServersResp>('GET', '/api/servers')
export const discoverServers = () => bearerJson<DiscoverResp>('GET', '/api/servers/discover')
export const serverInterpreters = (cwd: string) =>
  bearerJson<{ interpreters: Interpreter[] }>(
    'GET',
    `/api/servers/interpreters?cwd=${encodeURIComponent(cwd)}`,
  )
export const suggestPort = (cwd: string, entry: string) =>
  bearerJson<{ port: number }>(
    'GET',
    `/api/servers/suggest-port?cwd=${encodeURIComponent(cwd)}&entry=${encodeURIComponent(entry)}`,
  )
export const pyenvInfo = () => bearerJson<PyenvInfo>('GET', '/api/servers/pyenv')
export const createPyenvVenv = (base: string, name: string) =>
  bearerJson<{ ok: boolean; name: string; path: string; label: string }>('POST', '/api/servers/pyenv', {
    base,
    name,
  })
export const setupEnv = (id: string, base_python: string) =>
  bearerJson<{ started: boolean }>('POST', `/api/servers/${id}/setup-env`, { base_python })
export const getSetupLog = (id: string) =>
  bearerJson<SetupLog>('GET', `/api/servers/${id}/setup-env/log`)
export const setServersBaseDir = (path: string) =>
  bearerJson<{ base_dir: string }>('POST', '/api/servers/base-dir', { path })
export const createServer = (s: ServiceInput) =>
  bearerJson<ManagedService>('POST', '/api/servers', s)
export const updateServer = (id: string, s: Partial<ServiceInput>) =>
  bearerJson<ManagedService>('PUT', `/api/servers/${id}`, s)
export const deleteServer = (id: string) =>
  bearerJson<{ success: boolean }>('DELETE', `/api/servers/${id}`)
export const startServer = (id: string) =>
  bearerJson<ManagedService>('POST', `/api/servers/${id}/start`)
export const stopServer = (id: string) =>
  bearerJson<ManagedService>('POST', `/api/servers/${id}/stop`)
export const restartServer = (id: string) =>
  bearerJson<ManagedService>('POST', `/api/servers/${id}/restart`)
export const gitPull = (id: string) =>
  bearerJson<GitPullResp>('POST', `/api/servers/${id}/git-pull`)
export const serverLogs = (id: string, lines = 300) =>
  bearerJson<{ logs: string }>('GET', `/api/servers/${id}/logs?lines=${lines}`)

// --- Deploy / HTTPS ---------------------------------------------------------
export const getDeployInfo = () => bearerJson<DeployInfo>('GET', '/api/deploy/info')
export const checkReachability = (id: string, domain: string, port = 80) =>
  bearerJson<ReachabilityResp>('POST', `/api/servers/${id}/reachability`, { domain, port })
export const deployService = (
  id: string,
  opts: { domain: string; email?: string; staging?: boolean },
) => bearerJson<{ started: boolean; domain: string; port: number }>(
  'POST',
  `/api/servers/${id}/deploy`,
  opts,
)
export const getDeployLog = (id: string) =>
  bearerJson<DeployLog>('GET', `/api/servers/${id}/deploy/log`)

// --- Client Project (CRM; all Bearer) --------------------------------------
function cpQs(filters?: Record<string, string>): string {
  const e = Object.entries(filters ?? {}).filter(([, v]) => v != null && v !== '')
  return e.length ? '?' + e.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') : ''
}
export const cpList = (entity: string, filters?: Record<string, string>) =>
  bearerJson<{ items: CpRecord[] }>('GET', `/api/cp/${entity}${cpQs(filters)}`)
export const cpCreate = (entity: string, data: CpRecord) =>
  bearerJson<CpRecord>('POST', `/api/cp/${entity}`, data)
export const cpUpdate = (entity: string, id: string, data: CpRecord) =>
  bearerJson<CpRecord>('PUT', `/api/cp/${entity}/${id}`, data)
export const cpDelete = (entity: string, id: string) =>
  bearerJson<{ success: boolean }>('DELETE', `/api/cp/${entity}/${id}`)
export const cpDashboard = () => bearerJson<CpDashboard>('GET', '/api/cp/dashboard')
export function cpUpload(
  file: File,
  meta: { project_id?: string; client_id?: string; issue_id?: string; category?: string },
): Promise<CpRecord> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('token', _token ?? '')
  for (const [k, v] of Object.entries(meta)) if (v) fd.append(k, v)
  return fetch('/api/cp/upload', { method: 'POST', body: fd }).then((r) => parse<CpRecord>(r))
}
