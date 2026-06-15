import { useEffect, useState } from 'react'
import { downloadUrl } from '@/lib/restClient'
import { Icon } from '@/components/common/Icon'

/** Fullscreen image viewer with prev/next + keyboard nav. `images` are file paths. */
export function Lightbox({
  images,
  start = 0,
  onClose,
}: {
  images: string[]
  start?: number
  onClose: () => void
}) {
  const [i, setI] = useState(start)
  const n = images.length
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') setI((v) => (v + 1) % n)
      else if (e.key === 'ArrowLeft') setI((v) => (v - 1 + n) % n)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [n, onClose])
  if (!n) return null
  return (
    <div className="cp-lightbox" onClick={onClose}>
      <button className="cp-lb-btn cp-lb-close" onClick={onClose} aria-label="Close">
        <Icon name="close" size={22} />
      </button>
      {n > 1 && (
        <button
          className="cp-lb-btn cp-lb-prev"
          onClick={(e) => {
            e.stopPropagation()
            setI((v) => (v - 1 + n) % n)
          }}
          aria-label="Previous"
        >
          <Icon name="chevron-left" size={28} />
        </button>
      )}
      <img className="cp-lb-img" src={downloadUrl(images[i])} alt="" onClick={(e) => e.stopPropagation()} />
      {n > 1 && (
        <button
          className="cp-lb-btn cp-lb-next"
          onClick={(e) => {
            e.stopPropagation()
            setI((v) => (v + 1) % n)
          }}
          aria-label="Next"
        >
          <Icon name="chevron-right" size={28} />
        </button>
      )}
      {n > 1 && (
        <div className="cp-lb-count">
          {i + 1} / {n}
        </div>
      )}
    </div>
  )
}
