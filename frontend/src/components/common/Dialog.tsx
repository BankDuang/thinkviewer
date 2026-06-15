import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import clsx from 'clsx'
import { useDialogStore } from '@/store/dialogStore'
import './common.css'

export function Dialog() {
  const { open, mode, title, message, confirmLabel, cancelLabel, danger, defaultValue, placeholder, respond } =
    useDialogStore()
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Seed + focus the input each time a prompt opens.
  useEffect(() => {
    if (open && mode === 'prompt') {
      setValue(defaultValue)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [open, mode, defaultValue])

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
            {mode === 'prompt' && (
              <input
                ref={inputRef}
                className="tv-field"
                style={{ width: '100%', marginTop: 6 }}
                value={value}
                placeholder={placeholder}
                spellCheck={false}
                autoCapitalize="none"
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    respond(true, value)
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    respond(false)
                  }
                }}
              />
            )}
            <div className="dialog-actions">
              <button
                className={clsx('tv-btn', danger ? 'tv-btn--danger' : 'tv-btn--primary')}
                onClick={() => respond(true, value)}
                autoFocus={mode === 'confirm'}
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
