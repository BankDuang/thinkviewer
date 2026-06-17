import { useEffect, useRef } from 'react'

/** Calls `fn` on an interval and when the window regains focus, but only while
 *  the tab is visible — used for flicker-free background sync (multi-user). The
 *  callback should fetch silently (no loading spinner) and only setState when
 *  the data actually changed, so unchanged polls cause zero re-render. */
export function usePoll(fn: () => void, ms = 6000) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') ref.current()
    }
    const id = window.setInterval(tick, ms)
    window.addEventListener('focus', tick)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', tick)
    }
  }, [ms])
}
