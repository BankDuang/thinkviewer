// HOT PATH — runs at up to 30 fps and MUST stay out of React/Zustand entirely.
// Decodes raw-binary JPEG frames off-thread (createImageBitmap) and draws them to
// an uncontrolled <canvas>. Newest-wins frame dropping prevents a decode backlog;
// every bitmap is closed after draw to avoid leaking GPU/decoder memory.

type DimsListener = (w: number, h: number) => void

class FrameSink {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private pending: Blob | null = null
  private decoding = false
  private width = 0
  private height = 0
  private dimsListeners = new Set<DimsListener>()

  /** Bind the live canvas. Call from the RemoteCanvas ref callback / effect. */
  register(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })
    if (this.width && this.height) {
      canvas.width = this.width
      canvas.height = this.height
    }
  }

  /** Unbind a canvas (unmount). Only clears if it's still the active one. */
  unregister(canvas: HTMLCanvasElement) {
    if (this.canvas === canvas) {
      this.canvas = null
      this.ctx = null
      this.pending = null
    }
  }

  onDims(fn: DimsListener): () => void {
    this.dimsListeners.add(fn)
    if (this.width && this.height) fn(this.width, this.height)
    return () => this.dimsListeners.delete(fn)
  }

  getDims() {
    return { width: this.width, height: this.height }
  }

  /** Receive a frame. Drops any frame still waiting (newest wins). */
  push = (frame: Blob) => {
    this.pending = frame
    if (!this.decoding) void this.drain()
  }

  private async drain() {
    this.decoding = true
    try {
      while (this.pending) {
        const frame = this.pending
        this.pending = null
        let bmp: ImageBitmap
        try {
          bmp = await createImageBitmap(frame)
        } catch {
          continue
        }
        const canvas = this.canvas
        const ctx = this.ctx
        if (!canvas || !ctx) {
          bmp.close()
          continue
        }
        try {
          if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
            canvas.width = bmp.width
            canvas.height = bmp.height
          }
          if (this.width !== bmp.width || this.height !== bmp.height) {
            this.width = bmp.width
            this.height = bmp.height
            this.dimsListeners.forEach((fn) => fn(bmp.width, bmp.height))
          }
          ctx.drawImage(bmp, 0, 0)
        } finally {
          bmp.close() // always free the decoded bitmap, even if a listener throws
        }
      }
    } finally {
      this.decoding = false
    }
  }
}

export const frameSink = new FrameSink()
