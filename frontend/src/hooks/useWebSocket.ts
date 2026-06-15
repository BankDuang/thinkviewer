import { useEffect } from 'react'
import { ws } from '@/lib/wsClient'
import { frameSink } from '@/lib/frameSink'
import { b64ToBytes } from '@/lib/base64'
import * as registry from '@/lib/terminalRegistry'
import { useConnectionStore } from '@/store/connectionStore'
import { useStreamStore } from '@/store/streamStore'
import { useTerminalStore } from '@/store/terminalStore'
import { useNotificationStore } from '@/store/notificationStore'
import type { ServerMsg } from '@/types'

/**
 * Wires the single app WebSocket to the stores, frame sink and xterm registry.
 * Mount EXACTLY ONCE (in Desktop). Idempotent + StrictMode-safe via cleanups.
 */
export function useWebSocket() {
  useEffect(() => {
    const term = useTerminalStore.getState
    const stream = useStreamStore.getState
    const push = useNotificationStore.getState().push

    const offFrame = ws.onFrame(frameSink.push)
    const offStatus = ws.onStatus((s) => useConnectionStore.getState().set(s))

    const offMsg = ws.onMessage((msg: ServerMsg) => {
      switch (msg.type) {
        case 'auth_ok':
          stream().hydrate({ screenWidth: msg.screen_width, screenHeight: msg.screen_height })
          ws.send({ type: 'term_list' }) // refresh tab list (also after reconnect)
          break
        case 'term_list':
          term().replaceAll(msg.sessions)
          // Drop xterm instances for sessions that no longer exist (e.g. after a
          // server restart) so they don't leak across reconnects.
          registry.reconcile(msg.sessions.map((s) => s.session_id))
          break
        case 'term_created': {
          term().upsert({ session_id: msg.session_id, alive: true, name: msg.name ?? '' })
          term().setActive(msg.session_id)
          // The creating client is already a server-side subscriber, so mark the
          // instance hydrated to skip a redundant term_subscribe round-trip.
          const inst = registry.getOrCreate(msg.session_id)
          if (msg.buffer) inst.term.write(b64ToBytes(msg.buffer))
          inst.hydrated = true
          break
        }
        case 'term_new':
          term().upsert({ session_id: msg.session_id, alive: true, name: '' })
          break
        case 'term_subscribed': {
          const inst = registry.getOrCreate(msg.session_id)
          if (msg.buffer && !inst.hydrated) {
            inst.term.write(b64ToBytes(msg.buffer))
            inst.hydrated = true
          }
          term().upsert({ session_id: msg.session_id, alive: true, name: msg.name })
          break
        }
        case 'term_output':
          if (registry.has(msg.session_id)) {
            registry.get(msg.session_id)!.term.write(b64ToBytes(msg.data))
          }
          break
        case 'term_closed':
          term().remove(msg.session_id)
          registry.dispose(msg.session_id)
          break
        case 'term_renamed':
          term().rename(msg.session_id, msg.name)
          break
        case 'term_image_pasted':
          if (msg.error) push('error', `Paste failed: ${msg.error}`)
          else if (msg.clipboard_ok) push('ok', 'Image pasted into terminal')
          else push('warn', 'Clipboard unavailable — path typed instead')
          break
        case 'error':
          if (!/unauthor/i.test(msg.message)) push('error', msg.message)
          break
      }
    })

    return () => {
      offFrame()
      offStatus()
      offMsg()
    }
  }, [])
}
