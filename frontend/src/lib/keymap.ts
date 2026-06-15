// Browser KeyboardEvent -> pyautogui key names. Kept byte-for-byte compatible
// with the previous client (static/js/app.js) so remote-control parity holds:
// single printable chars are lowercased and shift is sent as a separate modifier;
// Meta maps to 'command' (the host is treated as macOS-style); 'fn' is never sent.

import type { ModKey } from '@/types'

export const KEY_MAP: Record<string, string> = {
  Enter: 'enter',
  Backspace: 'backspace',
  Tab: 'tab',
  Escape: 'escape',
  Delete: 'delete',
  Insert: 'insert',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  ' ': 'space',
  F1: 'f1', F2: 'f2', F3: 'f3', F4: 'f4',
  F5: 'f5', F6: 'f6', F7: 'f7', F8: 'f8',
  F9: 'f9', F10: 'f10', F11: 'f11', F12: 'f12',
}

export const MODIFIER_MAP: Record<string, ModKey> = {
  Control: 'ctrl',
  Alt: 'alt',
  Shift: 'shift',
  Meta: 'command',
}

// Keys that are never actionable on the host and must be dropped (incl. fn).
// Lock keys are filtered (matching the old client): forwarding them would toggle
// the HOST's lock state and they fire asymmetrically across browsers/OSes.
export const IGNORE_KEYS = new Set([
  'Dead',
  'Unidentified',
  'Fn',
  'FnLock',
  'Process',
  'Compose',
  'CapsLock',
  'NumLock',
  'ScrollLock',
])

/** The ModKey for a modifier event, or null if e.key isn't a modifier. */
export function modifierOf(key: string): ModKey | null {
  return MODIFIER_MAP[key] ?? null
}

/** The pyautogui name for a non-modifier key. */
export function keyName(key: string): string {
  return KEY_MAP[key] || key.toLowerCase()
}
