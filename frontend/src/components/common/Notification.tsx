import { AnimatePresence, motion } from 'framer-motion'
import { useNotificationStore } from '@/store/notificationStore'
import { Icon, type IconName } from './Icon'
import type { ToastKind } from '@/types'
import './common.css'

const ICONS: Record<ToastKind, IconName> = {
  ok: 'check',
  error: 'x-circle',
  warn: 'alert',
  info: 'info',
}

export function Notifications() {
  const toasts = useNotificationStore((s) => s.toasts)
  const dismiss = useNotificationStore((s) => s.dismiss)
  return (
    <div className="toasts">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className={`toast toast--${t.kind}`}
            initial={{ opacity: 0, x: 40, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
            onClick={() => dismiss(t.id)}
          >
            <span className="toast-icon">
              <Icon name={ICONS[t.kind]} size={18} />
            </span>
            <span className="toast-text">{t.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
