// Imperative remote-control input bridge. Pointer + keyboard events are wired
// straight to ws.send and NEVER touch React/Zustand state (hot path). Behaviour is
// kept in parity with the legacy client (static/js/app.js):
//   - coords are normalised 0..1 against the *displayed* image rect (object-fit:
//     contain letterboxing is accounted for; presses in the black margins are ignored)
//   - a click is mouse_down + mouse_up (the host turns that pair into one click);
//     the second press of a quick double becomes a single mouse_dblclick (Quartz)
//   - wheel delta is sign(deltaY) * -3, throttled
//   - modifiers are tracked for safety: server releases after 2s, client re-releases
//     stuck modifiers after 3s, and blur / tab-hide / control-off / unmount release all
//   - the `fn` key is never forwarded
import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { Button } from '@/types'
import { ws } from '@/lib/wsClient'
import { frameSink } from '@/lib/frameSink'
import { IGNORE_KEYS, keyName, modifierOf } from '@/lib/keymap'

const BUTTONS: Button[] = ['left', 'middle', 'right']
const MOVE_THROTTLE_MS = 30
const WHEEL_THROTTLE_MS = 30
const DBLCLICK_MS = 300
const DBLCLICK_DIST = 6
const MOD_STUCK_MS = 3000

interface ActivePress {
  button: Button
  pointerId: number
  dblPending: boolean
}

interface NormPoint {
  x: number
  y: number
  inside: boolean
}

/** Map a viewport point to a normalised 0..1 coord on the contained image, or null. */
function toNorm(canvas: HTMLCanvasElement, clientX: number, clientY: number): NormPoint | null {
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null

  let dispW = rect.width
  let dispH = rect.height
  let offX = rect.left
  let offY = rect.top

  // Re-create the object-fit:contain box from the native frame aspect ratio.
  const dims = frameSink.getDims()
  if (dims.width > 0 && dims.height > 0) {
    const scale = Math.min(rect.width / dims.width, rect.height / dims.height)
    dispW = dims.width * scale
    dispH = dims.height * scale
    offX = rect.left + (rect.width - dispW) / 2
    offY = rect.top + (rect.height - dispH) / 2
  }

  const rawX = (clientX - offX) / dispW
  const rawY = (clientY - offY) / dispH
  return {
    x: Math.min(1, Math.max(0, rawX)),
    y: Math.min(1, Math.max(0, rawY)),
    inside: rawX >= 0 && rawX <= 1 && rawY >= 0 && rawY <= 1,
  }
}

function isEditableTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable
  )
}

/**
 * Attach remote-control input to a canvas.
 * @param controlling pointer + key events are forwarded only while true
 * @param focused     keyboard is only captured while this window is the focused one
 */
export function useRemoteInput(
  canvasRef: RefObject<HTMLCanvasElement>,
  controlling: boolean,
  focused: boolean,
) {
  const controllingRef = useRef(controlling)
  controllingRef.current = controlling

  // Shared, render-stable input state (refs so every effect/handler sees it).
  const pressRef = useRef<ActivePress | null>(null)
  const lastUpRef = useRef({ time: 0, x: 0, y: 0 })
  const lastNormRef = useRef({ x: 0, y: 0 })
  const heldKeysRef = useRef<Set<string>>(new Set())
  const modTimesRef = useRef<Map<string, number>>(new Map())

  // Release everything the host currently believes is held down.
  const releaseAll = useCallback(() => {
    heldKeysRef.current.forEach((key) => ws.send({ type: 'key_up', key }))
    heldKeysRef.current.clear()
    modTimesRef.current.clear()
    ws.send({ type: 'release_modifiers' })
  }, [])

  // ---- Pointer (mouse / touch / pen) — bound once to the canvas element ----
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let moveTimer: number | null = null
    let pendingMove: { x: number; y: number } | null = null
    let lastMoveAt = 0
    const flushMove = () => {
      if (moveTimer !== null) {
        clearTimeout(moveTimer)
        moveTimer = null
      }
      if (!pendingMove) return
      lastMoveAt = performance.now()
      ws.send({ type: 'mouse_move', x: pendingMove.x, y: pendingMove.y })
      pendingMove = null
    }
    const queueMove = (x: number, y: number) => {
      pendingMove = { x, y }
      const elapsed = performance.now() - lastMoveAt
      if (elapsed >= MOVE_THROTTLE_MS) flushMove()
      else if (moveTimer === null) moveTimer = window.setTimeout(flushMove, MOVE_THROTTLE_MS - elapsed)
    }

    let wheelTimer: number | null = null
    let pendingWheel: { x: number; y: number; delta: number } | null = null
    let lastWheelAt = 0
    const flushWheel = () => {
      if (wheelTimer !== null) {
        clearTimeout(wheelTimer)
        wheelTimer = null
      }
      if (!pendingWheel) return
      lastWheelAt = performance.now()
      ws.send({ type: 'mouse_scroll', ...pendingWheel })
      pendingWheel = null
    }

    const onPointerDown = (e: PointerEvent) => {
      if (!controllingRef.current) return
      const button = BUTTONS[e.button]
      if (!button) return
      const pos = toNorm(canvas, e.clientX, e.clientY)
      if (!pos || !pos.inside) return // ignore the letterbox margins
      e.preventDefault()
      lastNormRef.current = { x: pos.x, y: pos.y }
      canvas.focus({ preventScroll: true })
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        /* capture unsupported — ignore */
      }
      const up = lastUpRef.current
      const dblPending =
        button === 'left' &&
        e.timeStamp - up.time < DBLCLICK_MS &&
        Math.abs(e.clientX - up.x) < DBLCLICK_DIST &&
        Math.abs(e.clientY - up.y) < DBLCLICK_DIST
      pressRef.current = { button, pointerId: e.pointerId, dblPending }
      if (!dblPending) ws.send({ type: 'mouse_down', x: pos.x, y: pos.y, button })
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!controllingRef.current) return
      const pos = toNorm(canvas, e.clientX, e.clientY)
      if (!pos) return
      lastNormRef.current = { x: pos.x, y: pos.y }
      queueMove(pos.x, pos.y)
    }

    const onPointerUp = (e: PointerEvent) => {
      const press = pressRef.current
      try {
        canvas.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      if (!press || press.pointerId !== e.pointerId) return
      pressRef.current = null
      if (!controllingRef.current) return
      e.preventDefault()
      flushMove() // make sure the final position lands before the release
      const pos = toNorm(canvas, e.clientX, e.clientY)
      const x = pos ? pos.x : lastNormRef.current.x
      const y = pos ? pos.y : lastNormRef.current.y
      if (press.dblPending) {
        ws.send({ type: 'mouse_dblclick', x, y })
        lastUpRef.current = { time: 0, x: 0, y: 0 }
      } else {
        ws.send({ type: 'mouse_up', x, y, button: press.button })
        if (press.button === 'left') lastUpRef.current = { time: e.timeStamp, x: e.clientX, y: e.clientY }
      }
    }

    const onWheel = (e: WheelEvent) => {
      if (!controllingRef.current) return
      const pos = toNorm(canvas, e.clientX, e.clientY)
      if (!pos) return
      e.preventDefault()
      const delta = Math.sign(e.deltaY) * -3
      if (delta === 0) return
      pendingWheel = { x: pos.x, y: pos.y, delta }
      const elapsed = performance.now() - lastWheelAt
      if (elapsed >= WHEEL_THROTTLE_MS) flushWheel()
      else if (wheelTimer === null) wheelTimer = window.setTimeout(flushWheel, WHEEL_THROTTLE_MS - elapsed)
    }

    const onContextMenu = (e: MouseEvent) => {
      // The right button is delivered via pointerdown/up; only suppress the browser menu.
      if (controllingRef.current) e.preventDefault()
    }

    const onDragStart = (e: DragEvent) => e.preventDefault()

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', onContextMenu)
    canvas.addEventListener('dragstart', onDragStart)

    return () => {
      if (moveTimer !== null) clearTimeout(moveTimer)
      if (wheelTimer !== null) clearTimeout(wheelTimer)
      // Unmounting mid-drag (closing/switching the window) must not strand a
      // pressed mouse button on the host.
      const press = pressRef.current
      if (press) {
        ws.send({
          type: 'mouse_up',
          x: lastNormRef.current.x,
          y: lastNormRef.current.y,
          button: press.button,
        })
        pressRef.current = null
      }
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('contextmenu', onContextMenu)
      canvas.removeEventListener('dragstart', onDragStart)
    }
  }, [canvasRef])

  // ---- Keyboard — only while controlling AND this window is focused ----
  useEffect(() => {
    if (!controlling || !focused) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(document.activeElement)) return
      if (IGNORE_KEYS.has(e.key)) return
      // Local -> remote clipboard paste: Cmd/Ctrl+V reads the LOCAL clipboard and
      // types it on the host (instead of forwarding the shortcut, which would paste
      // the host's own clipboard). Mirrors the legacy client's clipboard bridge.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault()
        e.stopPropagation()
        navigator.clipboard
          ?.readText?.()
          .then((text) => {
            if (!text) return
            releaseAll() // drop the held Cmd/Ctrl so it can't combine with typed chars
            ws.send({ type: 'type_text', text })
          })
          .catch(() => {
            /* no clipboard permission / not a secure context — ignore */
          })
        return
      }
      e.preventDefault()
      e.stopPropagation()
      const mod = modifierOf(e.key)
      if (mod) {
        if (!e.repeat) {
          modTimesRef.current.set(mod, performance.now())
          heldKeysRef.current.add(mod)
          ws.send({ type: 'key_down', key: mod })
        }
        return
      }
      const key = keyName(e.key)
      if (key === 'fn') return // never forward fn
      heldKeysRef.current.add(key)
      ws.send({ type: 'key_down', key }) // resend on repeat — host owns key-repeat
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (isEditableTarget(document.activeElement)) return
      if (IGNORE_KEYS.has(e.key)) return
      e.preventDefault()
      e.stopPropagation()
      const mod = modifierOf(e.key)
      if (mod) {
        modTimesRef.current.delete(mod)
        heldKeysRef.current.delete(mod)
        ws.send({ type: 'key_up', key: mod })
        return
      }
      const key = keyName(e.key)
      if (key === 'fn') return
      heldKeysRef.current.delete(key)
      ws.send({ type: 'key_up', key })
    }

    const onBlur = () => releaseAll()
    const onVisibility = () => {
      if (document.hidden) releaseAll()
    }

    // Capture phase so remote control intercepts keys before any app handler.
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      // Detach == lost focus / released control / unmounted -> never leave keys stuck.
      releaseAll()
    }
  }, [controlling, focused, releaseAll])

  // ---- Safety: release modifiers stuck for >3s, and clean up when control ends ----
  useEffect(() => {
    if (!controlling) {
      // Releasing control mid-drag must not strand a pressed mouse button.
      const press = pressRef.current
      if (press) {
        ws.send({ type: 'mouse_up', x: lastNormRef.current.x, y: lastNormRef.current.y, button: press.button })
        pressRef.current = null
      }
      return
    }
    const id = window.setInterval(() => {
      const now = performance.now()
      modTimesRef.current.forEach((t, mod) => {
        if (now - t > MOD_STUCK_MS) {
          modTimesRef.current.delete(mod)
          heldKeysRef.current.delete(mod)
          ws.send({ type: 'key_up', key: mod })
        }
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [controlling])
}
