import { useEffect, type RefObject } from 'react'
import { frameSink } from '@/lib/frameSink'

interface RemoteCanvasProps {
  canvasRef: RefObject<HTMLCanvasElement>
  controlling: boolean
}

/**
 * The remote screen surface. We only bind/unbind it with the frameSink — frames are
 * decoded and drawn centrally (useWebSocket -> frameSink). The bitmap resolution is
 * driven by the host frame, and object-fit:contain handles letterboxing.
 */
export function RemoteCanvas({ canvasRef, controlling }: RemoteCanvasProps) {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    frameSink.register(canvas)
    return () => frameSink.unregister(canvas)
  }, [canvasRef])

  return (
    <canvas
      ref={canvasRef}
      tabIndex={-1}
      aria-label="Remote screen"
      className={`rd-canvas${controlling ? ' rd-canvas--controlling' : ''}`}
    />
  )
}
