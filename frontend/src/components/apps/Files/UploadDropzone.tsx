import { motion } from 'framer-motion'
import { Icon } from '@/components/common/Icon'

interface UploadDropzoneProps {
  folderName: string
}

/** Full-pane overlay shown while files are dragged over the window. */
export function UploadDropzone({ folderName }: UploadDropzoneProps) {
  return (
    <motion.div
      className="fm-dropzone"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
    >
      <motion.div
        className="fm-dropzone-inner"
        initial={{ scale: 0.95 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.95 }}
      >
        <Icon name="upload" size={38} strokeWidth={1.6} />
        <div className="fm-dropzone-title">Drop to upload</div>
        <div className="fm-dropzone-sub">to {folderName}</div>
      </motion.div>
    </motion.div>
  )
}
