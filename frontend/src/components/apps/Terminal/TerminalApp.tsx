import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppProps } from '@/types'
import { ws } from '@/lib/wsClient'
import { useTerminalStore } from '@/store/terminalStore'
import { useConnectionStore } from '@/store/connectionStore'
import { confirmDialog } from '@/store/dialogStore'
import { notify } from '@/store/notificationStore'
import { Icon } from '@/components/common/Icon'
import { TerminalTabs } from './TerminalTabs'
import { TerminalPane } from './TerminalPane'
import { ImagePastePreview, type PastePreview } from './ImagePastePreview'
import { readClipboardImage } from './imagePaste'
import './terminal.css'

// Ensures exactly one terminal is auto-created on a truly empty server, even
// across StrictMode double-mounts. Module scope so the latch is process-global.
let bootstrapped = false

export function TerminalApp({ focused }: AppProps) {
  const order = useTerminalStore((s) => s.order)
  const sessions = useTerminalStore((s) => s.sessions)
  const activeId = useTerminalStore((s) => s.activeId)
  const setActive = useTerminalStore((s) => s.setActive)
  const status = useConnectionStore((s) => s.status)

  const [preview, setPreview] = useState<PastePreview | null>(null)
  const inFlightRef = useRef(false)
  const previewTimerRef = useRef<number | undefined>(undefined)

  const schedulePreviewClear = useCallback((ms: number) => {
    window.clearTimeout(previewTimerRef.current)
    previewTimerRef.current = window.setTimeout(() => setPreview(null), ms)
  }, [])

  const dismissPreview = useCallback(() => {
    window.clearTimeout(previewTimerRef.current)
    setPreview(null)
  }, [])

  // ── Bootstrap: refresh the shared list and create one terminal if empty ──
  useEffect(() => {
    ws.send({ type: 'term_list' })
    if (bootstrapped) return
    let done = false
    const off = ws.onMessage((m) => {
      if (m.type === 'term_list' && !done) {
        done = true
        bootstrapped = true
        off()
        if (m.sessions.length === 0) ws.send({ type: 'term_create' })
      }
    })
    return () => {
      if (!done) off()
    }
  }, [])

  // ── Image paste lifecycle (success/failure toast is also raised centrally) ──
  useEffect(() => {
    const off = ws.onMessage((m) => {
      if (m.type !== 'term_image_pasted') return
      inFlightRef.current = false
      if (m.error) {
        dismissPreview()
        return
      }
      setPreview((p) => ({
        dataUrl: p?.dataUrl,
        status: m.clipboard_ok ? 'Image attached to terminal' : 'Path typed into terminal',
        path: m.path,
      }))
      schedulePreviewClear(3400)
    })
    return () => {
      off()
      window.clearTimeout(previewTimerRef.current)
    }
  }, [dismissPreview, schedulePreviewClear])

  const sendImage = useCallback(
    (sessionId: string, blob: Blob) => {
      if (inFlightRef.current) return
      inFlightRef.current = true
      window.setTimeout(() => {
        inFlightRef.current = false
      }, 4000)

      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : ''
        const comma = dataUrl.indexOf(',')
        const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : ''
        if (!b64) {
          inFlightRef.current = false
          notify('error', 'Could not read image data')
          return
        }
        setPreview({ dataUrl, status: 'Setting remote clipboard…' })
        schedulePreviewClear(12000) // safety net if the server never replies
        ws.send({
          type: 'term_paste_image',
          session_id: sessionId,
          mime: blob.type || 'image/png',
          data: b64,
        })
      }
      reader.onerror = () => {
        inFlightRef.current = false
        notify('error', 'Failed to read image')
      }
      reader.readAsDataURL(blob)
    },
    [schedulePreviewClear],
  )

  // ── Tab actions ──
  const createTab = useCallback(() => ws.send({ type: 'term_create' }), [])

  const closeTab = useCallback(async (id: string) => {
    const meta = useTerminalStore.getState().sessions[id]
    const label = meta?.name?.trim() || 'this terminal'
    const ok = await confirmDialog({
      title: 'Close terminal',
      message: `Close ${label}? Any running processes will be terminated.`,
      confirmLabel: 'Close',
      danger: true,
    })
    if (ok) ws.send({ type: 'term_close', session_id: id })
  }, [])

  const renameTab = useCallback((id: string, name: string) => {
    ws.send({ type: 'term_rename', session_id: id, name })
  }, [])

  const pasteImageFromToolbar = useCallback(async () => {
    const id = useTerminalStore.getState().activeId
    if (!id) {
      notify('info', 'Open a terminal first')
      return
    }
    if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
      notify('warn', 'Clipboard access needs HTTPS or localhost — use Ctrl+V inside the terminal')
      return
    }
    const { blob, permDenied } = await readClipboardImage()
    if (blob) sendImage(id, blob)
    else if (permDenied) notify('warn', 'Clipboard blocked — allow access, then try again')
    else notify('info', 'No image in clipboard — copy a screenshot first')
  }, [sendImage])

  const empty = order.length === 0

  return (
    <div className="term-root">
      <TerminalTabs
        order={order}
        sessions={sessions}
        activeId={activeId}
        onSelect={setActive}
        onCreate={createTab}
        onClose={closeTab}
        onRename={renameTab}
        onPasteImage={pasteImageFromToolbar}
      />

      <div className="term-stage">
        {empty ? (
          <div className="term-empty">
            {status === 'open' ? (
              <>
                <Icon name="terminal" size={42} strokeWidth={1.4} />
                <p>No terminal sessions</p>
                <button className="tv-btn tv-btn--primary" onClick={createTab}>
                  <Icon name="plus" size={15} strokeWidth={2} />
                  New Terminal
                </button>
              </>
            ) : (
              <>
                <span className="spin term-empty-spin">
                  <Icon name="refresh" size={24} />
                </span>
                <p>{status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</p>
              </>
            )}
          </div>
        ) : (
          order.map((id) => (
            <TerminalPane
              key={id}
              id={id}
              active={id === activeId}
              windowFocused={focused}
              onImage={sendImage}
            />
          ))
        )}
      </div>

      <ImagePastePreview preview={preview} onClose={dismissPreview} />
    </div>
  )
}
