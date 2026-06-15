import { AnimatePresence, motion } from 'framer-motion'
import { Icon } from '@/components/common/Icon'

export interface PastePreview {
  /** Data URL for the thumbnail (omitted until the image has been read). */
  dataUrl?: string
  /** Short human status, e.g. "Setting remote clipboard…". */
  status: string
  /** Saved path on the host, surfaced after term_image_pasted. */
  path?: string
}

export function ImagePastePreview({
  preview,
  onClose,
}: {
  preview: PastePreview | null
  onClose: () => void
}) {
  return (
    <AnimatePresence>
      {preview && (
        <motion.div
          className="term-paste-toast"
          initial={{ opacity: 0, y: 14, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 14, scale: 0.96 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          {preview.dataUrl ? (
            <img className="term-paste-thumb" src={preview.dataUrl} alt="Pasted" />
          ) : (
            <div className="term-paste-thumb term-paste-thumb--empty">
              <Icon name="image" size={20} />
            </div>
          )}
          <div className="term-paste-body">
            <div className="term-paste-status">{preview.status}</div>
            {preview.path && (
              <div className="term-paste-path" title={preview.path}>
                {preview.path}
              </div>
            )}
          </div>
          <button className="term-paste-close" onClick={onClose} aria-label="Dismiss">
            <Icon name="close" size={14} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
