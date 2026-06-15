import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppProps } from '@/types'
import { Icon } from '@/components/common/Icon'
import { frameSink } from '@/lib/frameSink'
import { useStreamStore } from '@/store/streamStore'
import { useConnectionStore } from '@/store/connectionStore'
import { RemoteCanvas } from './RemoteCanvas'
import { StreamToolbar } from './StreamToolbar'
import { useRemoteInput } from './useRemoteInput'
import './remote.css'

export function RemoteDesktop({ focused }: AppProps) {
  const controlling = useStreamStore((s) => s.controlling)
  const status = useConnectionStore((s) => s.status)

  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isFullscreen, setFullscreen] = useState(false)
  const [hasFrame, setHasFrame] = useState(() => frameSink.getDims().width > 0)

  useRemoteInput(canvasRef, controlling, focused)

  // First decoded frame flips the "waiting for video" state off.
  useEffect(() => frameSink.onDims((w, h) => setHasFrame(w > 0 && h > 0)), [])

  // Keep the fullscreen toggle label/state in sync with the document.
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void el.requestFullscreen().catch(() => {})
  }, [])

  const connected = status === 'open'
  const overlay = !connected
    ? status === 'reconnecting'
      ? { title: 'Reconnecting…', sub: 'Restoring the connection to the host.', live: true }
      : status === 'closed'
        ? { title: 'Disconnected', sub: 'The session to the host has ended.', live: false }
        : { title: 'Connecting to host…', sub: 'Establishing the live screen session.', live: true }
    : !hasFrame
      ? { title: 'Waiting for video…', sub: 'The remote display will appear in a moment.', live: true }
      : null

  return (
    <div ref={rootRef} className="rd-root">
      <StreamToolbar isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen} />

      <div className="rd-stage">
        <RemoteCanvas canvasRef={canvasRef} controlling={controlling} />

        {overlay && (
          <div className="rd-overlay" role="status" aria-live="polite">
            <div className="rd-overlay__card">
              {overlay.live ? (
                <span className="rd-spinner" aria-hidden="true" />
              ) : (
                <span className="rd-overlay__icon" aria-hidden="true">
                  <Icon name="monitor" size={26} strokeWidth={1.6} />
                </span>
              )}
              <div className="rd-overlay__text">
                <div className="rd-overlay__title">{overlay.title}</div>
                <div className="rd-overlay__sub">{overlay.sub}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
