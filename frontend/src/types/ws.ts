// WebSocket message contract. Mirrors the FastAPI /ws endpoint in main.py.
// NOTE: binary JPEG screen frames bypass these types entirely — they arrive as
// Blob/ArrayBuffer on ws.onmessage and are routed straight to frameSink.

export type Button = 'left' | 'middle' | 'right'
export type ModKey = 'ctrl' | 'alt' | 'shift' | 'command'

export type ClientMsg =
  | { type: 'auth'; token: string }
  | { type: 'stream_settings'; quality?: number; fps?: number; scale?: number }
  | { type: 'mouse_move'; x: number; y: number }
  | { type: 'mouse_down'; x: number; y: number; button: Button }
  | { type: 'mouse_up'; x: number; y: number; button: Button }
  | { type: 'mouse_click'; x: number; y: number; button: Button }
  | { type: 'mouse_dblclick'; x: number; y: number }
  | { type: 'mouse_scroll'; x: number; y: number; delta: number }
  | { type: 'key_down'; key: string }
  | { type: 'key_up'; key: string }
  | { type: 'key_press'; key: string }
  | { type: 'key_combo'; keys: string[] }
  | { type: 'type_text'; text: string }
  | { type: 'release_modifiers' }
  | { type: 'term_create' }
  | { type: 'term_input'; session_id: string; data: string } // base64 (UTF-8 safe)
  | { type: 'term_resize'; session_id: string; rows: number; cols: number }
  | { type: 'term_close'; session_id: string }
  | { type: 'term_rename'; session_id: string; name: string }
  | { type: 'term_list' }
  | { type: 'term_subscribe'; session_id: string }
  | { type: 'term_paste_image'; session_id: string; mime: string; data: string }

export interface TermSessionMeta {
  session_id: string
  alive: boolean
  name: string
}

export type ServerMsg =
  | { type: 'auth_ok'; screen_width: number; screen_height: number }
  | { type: 'error'; message: string }
  | { type: 'term_created'; session_id: string; buffer: string }
  | { type: 'term_output'; session_id: string; data: string } // base64
  | { type: 'term_closed'; session_id: string }
  | { type: 'term_list'; sessions: TermSessionMeta[] }
  | { type: 'term_subscribed'; session_id: string; name: string; buffer: string }
  | { type: 'term_new'; session_id: string }
  | { type: 'term_renamed'; session_id: string; name: string }
  | {
      type: 'term_image_pasted'
      session_id?: string
      path?: string
      clipboard_ok?: boolean
      size?: number
      error?: string
    }

export type ServerMsgType = ServerMsg['type']
