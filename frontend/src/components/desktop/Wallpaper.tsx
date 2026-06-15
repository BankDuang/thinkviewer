import { AnimatePresence, motion } from 'framer-motion'
import { useDesktopStore } from '@/store/desktopStore'

export function Wallpaper() {
  const url = useDesktopStore((s) => s.wallpaperUrl)
  return (
    <div className="wallpaper">
      <AnimatePresence initial={false}>
        <motion.img
          key={url}
          className="wallpaper-img"
          src={url}
          alt=""
          draggable={false}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: 'easeInOut' }}
        />
      </AnimatePresence>
    </div>
  )
}
