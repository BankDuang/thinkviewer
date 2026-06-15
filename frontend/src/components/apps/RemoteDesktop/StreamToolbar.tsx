import { Icon } from '@/components/common/Icon'
import { useStreamStore } from '@/store/streamStore'

interface StreamToolbarProps {
  isFullscreen: boolean
  onToggleFullscreen: () => void
}

/** Thin glass control bar: take/release control, fit + resolution readout, fullscreen. */
export function StreamToolbar({ isFullscreen, onToggleFullscreen }: StreamToolbarProps) {
  const controlling = useStreamStore((s) => s.controlling)
  const toggleControl = useStreamStore((s) => s.toggleControl)
  const screenWidth = useStreamStore((s) => s.screenWidth)
  const screenHeight = useStreamStore((s) => s.screenHeight)
  const hasRes = screenWidth > 0 && screenHeight > 0

  return (
    <div className="rd-toolbar">
      <div className="rd-toolbar__group">
        <button
          type="button"
          className={`rd-control${controlling ? ' rd-control--on' : ''}`}
          onClick={toggleControl}
          aria-pressed={controlling}
          title={controlling ? 'Release control of the remote' : 'Take control of the remote'}
        >
          <span className="rd-control__dot" aria-hidden="true" />
          <Icon name="cursor" size={14} strokeWidth={1.9} />
          <span>{controlling ? 'Controlling' : 'Control'}</span>
        </button>
        <span className="rd-hint" data-on={controlling}>
          {controlling ? 'Your keyboard & mouse drive the host' : 'View only — take control to interact'}
        </span>
      </div>

      <div className="rd-toolbar__group rd-toolbar__group--end">
        <span className="rd-stat" title="The stream is scaled to fit the window">
          <Icon name="expand" size={13} strokeWidth={1.7} />
          Fit
        </span>
        <span className="rd-stat" title="Remote display resolution">
          <Icon name="monitor" size={13} strokeWidth={1.7} />
          {hasRes ? `${screenWidth} × ${screenHeight}` : '—'}
        </span>
        <button
          type="button"
          className="rd-iconbtn"
          onClick={onToggleFullscreen}
          aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
          title={isFullscreen ? 'Exit full screen' : 'Full screen'}
        >
          <Icon name="fullscreen" size={15} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  )
}
