import { AnimatePresence, motion } from 'framer-motion'
import clsx from 'clsx'
import { useDialogStore } from '@/store/dialogStore'
import './common.css'

export function Dialog() {
  const { open, title, message, confirmLabel, cancelLabel, danger, respond } = useDialogStore()
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="dialog-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => respond(false)}
        >
          <motion.div
            className="dialog"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 460, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-title">{title}</div>
            {message && <div className="dialog-message">{message}</div>}
            <div className="dialog-actions">
              <button
                className={clsx('tv-btn', danger ? 'tv-btn--danger' : 'tv-btn--primary')}
                onClick={() => respond(true)}
                autoFocus
              >
                {confirmLabel}
              </button>
              <button className="tv-btn" onClick={() => respond(false)}>
                {cancelLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
