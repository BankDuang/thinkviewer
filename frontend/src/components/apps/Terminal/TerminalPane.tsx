import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { ws } from '@/lib/wsClient'
import * as registry from '@/lib/terminalRegistry'
import { strToB64 } from '@/lib/base64'
import { Icon } from '@/components/common/Icon'
import { imageFromDataTransferItems, imageFromFileList, readClipboardImage } from './imagePaste'

// xterm.onData is wired exactly once per session for the lifetime of the
// instance (the listener dies with the term on dispose). Module scope survives
// StrictMode double-mounts and window close/reopen.
const wiredInput = new Set<string>()

interface TerminalPaneProps {
  id: string
  active: boolean
  windowFocused: boolean
  onImage: (sessionId: string, blob: Blob) => void
}

export function TerminalPane({ id, active, windowFocused, onImage }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef(active)
  const focusedRef = useRef(windowFocused)
  const onImageRef = useRef(onImage)
  onImageRef.current = onImage

  const [dragging, setDragging] = useState(false)

  const fitAndResize = useCallback(() => {
    const inst = registry.get(id)
    const host = hostRef.current
    if (!inst || !host || !activeRef.current) return
    if (host.clientWidth < 2 || host.clientHeight < 2) return
    try {
      inst.fit.fit()
    } catch {
      return
    }
    const { rows, cols } = inst.term
    if (rows > 0 && cols > 0) ws.send({ type: 'term_resize', session_id: id, rows, cols })
  }, [id])

  // Open / re-attach the xterm DOM, wire input, paste, drag-drop and a resize
  // observer. Runs once per session id; safe across StrictMode + reopen.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const inst = registry.getOrCreate(id)

    if (!inst.opened) {
      inst.term.open(host)
      inst.opened = true
    } else if (inst.term.element && inst.term.element.parentElement !== host) {
      // App window was closed and reopened — re-home the persistent xterm DOM.
      host.appendChild(inst.term.element)
    }

    if (!wiredInput.has(id)) {
      inst.term.onData((d) => ws.send({ type: 'term_input', session_id: id, data: strToB64(d) }))
      wiredInput.add(id)
    }

    // Ctrl/Cmd+V: xterm calls preventDefault before any paste event fires, so we
    // read the clipboard image directly here. Returning false lets the browser's
    // default paste through to the helper-textarea listener for text/fallback.
    inst.term.attachCustomKeyEventHandler((ev) => {
      if (
        ev.type === 'keydown' &&
        (ev.ctrlKey || ev.metaKey) &&
        !ev.altKey &&
        ev.key.toLowerCase() === 'v'
      ) {
        readClipboardImage().then(({ blob }) => {
          if (blob) onImageRef.current(id, blob)
        })
        return false
      }
      return true
    })

    const textarea = host.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')
    const onPaste = (e: ClipboardEvent) => {
      const img = imageFromDataTransferItems(e.clipboardData?.items)
      if (img) {
        e.preventDefault()
        onImageRef.current(id, img)
      }
      // Text paste is intentionally NOT handled here: xterm's own helper-textarea
      // paste listener already sends it via onData -> term_input. Handling it here
      // too would send (and possibly auto-run) the pasted text twice.
    }
    textarea?.addEventListener('paste', onPaste)

    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault()
        setDragging(true)
      }
    }
    const onDragLeave = (e: DragEvent) => {
      if (!host.contains(e.relatedTarget as Node | null)) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      // Always prevent default: dropping a NON-image file would otherwise make the
      // browser navigate to it, destroying every terminal session + app state.
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
      setDragging(false)
      const img = imageFromFileList(e.dataTransfer?.files)
      if (img) onImageRef.current(id, img)
    }
    host.addEventListener('dragover', onDragOver)
    host.addEventListener('dragleave', onDragLeave)
    host.addEventListener('drop', onDrop)

    const ro = new ResizeObserver(() => fitAndResize())
    ro.observe(host)

    if (activeRef.current) requestAnimationFrame(fitAndResize)

    return () => {
      textarea?.removeEventListener('paste', onPaste)
      host.removeEventListener('dragover', onDragOver)
      host.removeEventListener('dragleave', onDragLeave)
      host.removeEventListener('drop', onDrop)
      ro.disconnect()
    }
  }, [id, fitAndResize])

  // Activation: subscribe for the first hydration, then fit + focus.
  useEffect(() => {
    activeRef.current = active
    if (!active) return
    const inst = registry.getOrCreate(id)
    if (!inst.hydrated) ws.send({ type: 'term_subscribe', session_id: id })
    const raf = requestAnimationFrame(() => {
      fitAndResize()
      if (focusedRef.current) {
        try {
          inst.term.focus()
        } catch {
          /* term may be mid-dispose */
        }
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [active, id, fitAndResize])

  // Focus the active terminal whenever the window gains focus.
  useEffect(() => {
    focusedRef.current = windowFocused
    if (!active || !windowFocused) return
    const inst = registry.get(id)
    if (!inst) return
    const raf = requestAnimationFrame(() => {
      try {
        inst.term.focus()
      } catch {
        /* ignore */
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [windowFocused, active, id])

  // Reconnect: the server drops all subscriptions on a fresh socket, so resume
  // output (hydrated panes only — no buffer rewrite) and refit the active one.
  useEffect(() => {
    let prev = ws.status
    const off = ws.onStatus((s) => {
      if (s === 'open' && prev !== 'open') {
        const inst = registry.get(id)
        if (inst && inst.hydrated) ws.send({ type: 'term_subscribe', session_id: id })
        if (activeRef.current) requestAnimationFrame(fitAndResize)
      }
      prev = s
    })
    return off
  }, [id, fitAndResize])

  return (
    <div
      className={clsx('term-pane', active && 'term-pane--active')}
      style={{ display: active ? 'block' : 'none' }}
      aria-hidden={!active}
    >
      <div ref={hostRef} className="term-pane-host" />
      {dragging && (
        <div className="term-dropzone">
          <Icon name="image" size={30} strokeWidth={1.5} />
          <span>Drop image to paste</span>
        </div>
      )}
    </div>
  )
}
