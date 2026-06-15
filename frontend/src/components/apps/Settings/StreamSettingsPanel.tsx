import { useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties } from 'react'
import { useStreamStore } from '@/store/streamStore'
import { useDesktopStore } from '@/store/desktopStore'
import { Icon } from '@/components/common/Icon'

interface SliderProps {
  name: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}

/** Native-feeling range slider with accent fill. Visual is driven by local
 *  state (smooth at 60fps) while the store/WS commit is throttled. */
function SetSlider({ name, value, min, max, step, format, onChange }: SliderProps) {
  const [drag, setDrag] = useState<number | null>(null)
  const lastSent = useRef(0)
  const display = drag ?? value
  const pct = ((display - min) / (max - min)) * 100

  function handleInput(e: ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value)
    setDrag(v)
    const now = performance.now()
    if (now - lastSent.current >= 80) {
      lastSent.current = now
      onChange(v)
    }
  }

  function commit() {
    if (drag != null) {
      onChange(drag)
      setDrag(null)
    }
  }

  return (
    <div className="set-slider-row">
      <div className="set-slider-head">
        <span className="set-slider-name">{name}</span>
        <span className="set-slider-badge">{format(display)}</span>
      </div>
      <input
        className="set-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={display}
        style={{ '--set-pct': `${pct}%` } as CSSProperties}
        onChange={handleInput}
        onPointerUp={commit}
        onMouseUp={commit}
        onTouchEnd={commit}
        onKeyUp={commit}
        onBlur={commit}
        aria-label={name}
      />
      <div className="set-slider-foot">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
    </div>
  )
}

export function StreamSettingsPanel() {
  const quality = useStreamStore((s) => s.quality)
  const fps = useStreamStore((s) => s.fps)
  const scale = useStreamStore((s) => s.scale)
  const setSettings = useStreamStore((s) => s.setSettings)
  const showMenuStats = useDesktopStore((s) => s.showMenuStats)
  const setMenuStats = useDesktopStore((s) => s.setMenuStats)

  return (
    <>
      <div className="set-banner">
        <Icon name="info" size={17} />
        <span>
          <b>Shared settings.</b> Changes apply live to the stream and affect{' '}
          <b>all connected clients</b>.
        </span>
      </div>

      <div className="set-section">
        <div className="set-label">Stream</div>
        <div className="set-group">
          <SetSlider
            name="Quality"
            value={quality}
            min={10}
            max={100}
            step={1}
            format={(v) => `${Math.round(v)}`}
            onChange={(v) => setSettings({ quality: Math.round(v) })}
          />
          <SetSlider
            name="Frame Rate"
            value={fps}
            min={1}
            max={30}
            step={1}
            format={(v) => `${Math.round(v)} fps`}
            onChange={(v) => setSettings({ fps: Math.round(v) })}
          />
          <SetSlider
            name="Scale"
            value={scale}
            min={0.25}
            max={2}
            step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(v) => setSettings({ scale: Number(v.toFixed(2)) })}
          />
        </div>
        <p className="set-note">
          Higher quality and frame rate look smoother but use more bandwidth. Scale sets the
          streamed resolution relative to the host display.
        </p>
      </div>

      <div className="set-section">
        <div className="set-label">Menu bar</div>
        <div className="set-group">
          <div className="set-toggle-row">
            <span className="set-toggle-text">
              <span className="set-toggle-name">Show CPU / RAM</span>
              <span className="set-toggle-sub">Live host CPU and memory meters in the top menu bar</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={showMenuStats}
              aria-label="Show CPU / RAM in menu bar"
              className={`set-switch${showMenuStats ? ' is-on' : ''}`}
              onClick={() => setMenuStats(!showMenuStats)}
            >
              <span className="set-switch-knob" />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
