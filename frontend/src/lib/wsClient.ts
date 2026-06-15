// Single application-wide WebSocket. The engine streams JPEG frames to every
// connected client and broadcasts term_* to all clients, so one shared socket is
// correct — per-component sockets would multiply streams and race terminal state.
//
// Responsibilities: auth handshake + gate (queue sends until auth_ok), reconnect
// with exponential backoff + jitter, STOP reconnecting on Unauthorized (route to
// login), and split the binary frame path (-> onFrame) from JSON (-> onMessage).

import type { ClientMsg, ConnectionStatus, ServerMsg } from '@/types'

type MsgListener = (msg: ServerMsg) => void
type FrameListener = (frame: Blob) => void
type StatusListener = (status: ConnectionStatus) => void

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws`
}

class WSClient {
  private ws: WebSocket | null = null
  private token: string | null = null
  private authed = false
  private intentionalClose = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private preAuthQueue: string[] = []

  private msgListeners = new Set<MsgListener>()
  private frameListeners = new Set<FrameListener>()
  private statusListeners = new Set<StatusListener>()
  private unauthorizedHandler: (() => void) | null = null

  status: ConnectionStatus = 'closed'

  onMessage(fn: MsgListener): () => void {
    this.msgListeners.add(fn)
    return () => this.msgListeners.delete(fn)
  }
  onFrame(fn: FrameListener): () => void {
    this.frameListeners.add(fn)
    return () => this.frameListeners.delete(fn)
  }
  onStatus(fn: StatusListener): () => void {
    this.statusListeners.add(fn)
    return () => this.statusListeners.delete(fn)
  }
  onUnauthorized(fn: () => void) {
    this.unauthorizedHandler = fn
  }

  private setStatus(s: ConnectionStatus) {
    this.status = s
    this.statusListeners.forEach((fn) => fn(s))
  }

  connect(token: string) {
    this.token = token
    this.intentionalClose = false
    this.openSocket()
  }

  private openSocket() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }
    this.authed = false
    this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting')
    const ws = new WebSocket(wsUrl())
    ws.binaryType = 'blob'
    this.ws = ws

    ws.onopen = () => {
      // Auth must be the very first message; everything else waits for auth_ok.
      ws.send(JSON.stringify({ type: 'auth', token: this.token }))
    }

    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data !== 'string') {
        // Binary JPEG frame — hot path, never touches React/JSON.
        this.frameListeners.forEach((fn) => fn(ev.data as Blob))
        return
      }
      let msg: ServerMsg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if (msg.type === 'auth_ok') {
        this.authed = true
        this.reconnectAttempts = 0
        this.setStatus('open')
        // Flush anything queued before auth completed.
        const q = this.preAuthQueue
        this.preAuthQueue = []
        q.forEach((raw) => ws.send(raw))
      } else if (msg.type === 'error' && /unauthor/i.test(msg.message)) {
        // Bad/expired token: do NOT reconnect-storm — clear and route to login.
        this.intentionalClose = true
        this.token = null
        this.unauthorizedHandler?.()
      }
      this.msgListeners.forEach((fn) => fn(msg))
    }

    ws.onclose = () => {
      // Ignore a late close from a socket we've already replaced (StrictMode
      // remount / rapid reconnect) — otherwise it clobbers the live socket
      // reference and spawns a duplicate via scheduleReconnect.
      if (this.ws !== ws) return
      this.ws = null
      this.authed = false
      if (this.intentionalClose || !this.token) {
        this.setStatus('closed')
        return
      }
      this.scheduleReconnect()
    }

    ws.onerror = () => {
      // onclose will follow and handle reconnect.
    }
  }

  private scheduleReconnect() {
    this.setStatus('reconnecting')
    this.reconnectAttempts++
    const base = Math.min(15000, 500 * 2 ** Math.min(this.reconnectAttempts, 5))
    const jitter = base * 0.3 * Math.random()
    const delay = base + jitter
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay)
  }

  // High-frequency / transient messages must NOT be buffered across an outage —
  // replaying stale input (old cursor positions, keystrokes) on reconnect is worse
  // than dropping it. Only durable control messages are queued, and the queue is capped.
  private static TRANSIENT = new Set<ClientMsg['type']>([
    'mouse_move', 'mouse_down', 'mouse_up', 'mouse_click', 'mouse_dblclick', 'mouse_scroll',
    'key_down', 'key_up', 'key_press', 'key_combo', 'type_text', 'release_modifiers', 'term_input',
  ])

  send(msg: ClientMsg) {
    const raw = JSON.stringify(msg)
    if (this.ws && this.ws.readyState === WebSocket.OPEN && (this.authed || msg.type === 'auth')) {
      this.ws.send(raw)
      return
    }
    if (msg.type === 'auth') return
    if (WSClient.TRANSIENT.has(msg.type)) return // drop stale input rather than replay
    if (this.preAuthQueue.length < 64) this.preAuthQueue.push(raw)
  }

  disconnect() {
    this.intentionalClose = true
    this.token = null
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.preAuthQueue = []
    this.reconnectAttempts = 0
    try {
      this.ws?.close()
    } catch {
      /* ignore */
    }
    this.ws = null
    this.setStatus('closed')
  }

  isAuthed() {
    return this.authed
  }
}

export const ws = new WSClient()
