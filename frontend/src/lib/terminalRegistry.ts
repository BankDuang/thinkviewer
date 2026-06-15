// xterm.js instances live OUTSIDE React, keyed by session_id, so switching tabs
// or re-rendering never destroys terminal state. Instances are disposed only on a
// real term_close / term_closed — never on unmount.

import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'

export interface TermInstance {
  term: Terminal
  fit: FitAddon
  /** True once .open(el) has been called for the first time. */
  opened: boolean
  /** True once initial scrollback replay has been written. */
  hydrated: boolean
}

const THEME = {
  background: '#1b1b1f',
  foreground: '#e6e6ea',
  cursor: '#7fd1ff',
  cursorAccent: '#1b1b1f',
  selectionBackground: 'rgba(127,209,255,0.30)',
  black: '#1b1b1f',
  red: '#ff6b6b',
  green: '#46d369',
  yellow: '#ffcf5c',
  blue: '#5b9dff',
  magenta: '#c792ea',
  cyan: '#5ad4d4',
  white: '#d6d6dc',
  brightBlack: '#6b6b76',
  brightRed: '#ff8585',
  brightGreen: '#6ce38a',
  brightYellow: '#ffe08a',
  brightBlue: '#82b5ff',
  brightMagenta: '#dcb4f5',
  brightCyan: '#86e6e6',
  brightWhite: '#ffffff',
}

const FONT_FAMILY =
  '"SF Mono", "JetBrains Mono", "Fira Code", Menlo, Monaco, "Cascadia Code", "Courier New", monospace'

const instances = new Map<string, TermInstance>()

export function getOrCreate(sessionId: string): TermInstance {
  let inst = instances.get(sessionId)
  if (!inst) {
    const term = new Terminal({
      fontFamily: FONT_FAMILY,
      fontSize: 13,
      lineHeight: 1.15,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 8000,
      allowProposedApi: true,
      macOptionIsMeta: true,
      theme: THEME,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    try {
      term.loadAddon(new WebLinksAddon())
    } catch {
      /* optional */
    }
    inst = { term, fit, opened: false, hydrated: false }
    instances.set(sessionId, inst)
  }
  return inst
}

export function get(sessionId: string): TermInstance | undefined {
  return instances.get(sessionId)
}

export function has(sessionId: string): boolean {
  return instances.has(sessionId)
}

export function dispose(sessionId: string) {
  const inst = instances.get(sessionId)
  if (inst) {
    try {
      inst.term.dispose()
    } catch {
      /* ignore */
    }
    instances.delete(sessionId)
  }
}

export function disposeAll() {
  for (const id of Array.from(instances.keys())) dispose(id)
}

/** Dispose any instance whose session no longer exists (e.g. after a server restart). */
export function reconcile(keepIds: string[]) {
  const keep = new Set(keepIds)
  for (const id of Array.from(instances.keys())) {
    if (!keep.has(id)) dispose(id)
  }
}
