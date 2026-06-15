import { useEffect, useState } from 'react'
import { useSessionStore } from '@/store/sessionStore'
import { setUnauthorizedHandler } from '@/lib/restClient'
import { ws } from '@/lib/wsClient'
import { Login } from '@/components/common/Login'
import { Desktop } from '@/components/desktop/Desktop'

export function App() {
  const status = useSessionStore((s) => s.status)
  const [booting, setBooting] = useState(true)

  useEffect(() => {
    // On any 401 (REST or WS), drop the session and return to login — no storm.
    const onUnauthorized = () => {
      ws.disconnect()
      void useSessionStore.getState().logout()
    }
    setUnauthorizedHandler(onUnauthorized)
    ws.onUnauthorized(onUnauthorized)

    void useSessionStore
      .getState()
      .resume()
      .finally(() => setBooting(false))
  }, [])

  if (booting) {
    return <div style={{ position: 'fixed', inset: 0, background: '#0a0a0f' }} />
  }
  return status === 'authed' ? <Desktop /> : <Login />
}
