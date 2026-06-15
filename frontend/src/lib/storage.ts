// Thin localStorage wrapper with namespacing + JSON. Stores only non-secret
// UI state plus the session token (same trust model as the previous app).

const NS = 'thinkviewer:'

export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(NS + key)
      return raw === null ? fallback : (JSON.parse(raw) as T)
    } catch {
      return fallback
    }
  },
  set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(NS + key, JSON.stringify(value))
    } catch {
      /* quota / private mode — ignore */
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(NS + key)
    } catch {
      /* ignore */
    }
  },
}

export const TOKEN_KEY = 'token'
export const THEME_KEY = 'theme'
export const ICON_POS_KEY = 'iconPositions'
