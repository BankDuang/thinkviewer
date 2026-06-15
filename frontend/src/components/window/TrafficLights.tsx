import { Icon } from '@/components/common/Icon'
import './window.css'

interface Props {
  onClose: () => void
  onMinimize: () => void
  onMaximize: () => void
}

export function TrafficLights({ onClose, onMinimize, onMaximize }: Props) {
  return (
    <div className="tl" onPointerDown={(e) => e.stopPropagation()}>
      <button className="tl-dot tl-close" onClick={onClose} aria-label="Close">
        <Icon name="close" size={9} strokeWidth={2} />
      </button>
      <button className="tl-dot tl-min" onClick={onMinimize} aria-label="Minimize">
        <Icon name="minus" size={9} strokeWidth={2} />
      </button>
      <button className="tl-dot tl-max" onClick={onMaximize} aria-label="Zoom">
        <Icon name="fullscreen" size={8} strokeWidth={2} />
      </button>
    </div>
  )
}
