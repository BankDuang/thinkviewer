// Image-paste helpers shared by the Terminal panes and toolbar.
// Terminal images are sent to the server (term_paste_image), which primes the
// host OS clipboard so Claude Code's own Ctrl-V handler can attach them.

export interface ClipboardImageResult {
  blob: Blob | null
  /** True when the Clipboard API is unavailable or permission was denied. */
  permDenied: boolean
}

/** Read the first image on the OS clipboard via the async Clipboard API. */
export async function readClipboardImage(): Promise<ClipboardImageResult> {
  const clip = navigator.clipboard
  if (!clip || typeof clip.read !== 'function') return { blob: null, permDenied: true }
  try {
    const items = await clip.read()
    for (const item of items) {
      const imgType = item.types.find((t) => t.startsWith('image/'))
      if (imgType) return { blob: await item.getType(imgType), permDenied: false }
    }
    return { blob: null, permDenied: false }
  } catch (e) {
    const permDenied =
      !(e instanceof DOMException) || e.name === 'NotAllowedError' || e.name === 'SecurityError'
    return { blob: null, permDenied }
  }
}

/** Pull an image File out of a paste event's DataTransferItemList (index-safe). */
export function imageFromDataTransferItems(items: DataTransferItemList | null | undefined): File | null {
  if (!items) return null
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const file = it.getAsFile()
      if (file) return file
    }
  }
  return null
}

/** Pull an image File out of a drop event's FileList (index-safe). */
export function imageFromFileList(files: FileList | null | undefined): File | null {
  if (!files) return null
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    if (file.type.startsWith('image/')) return file
  }
  return null
}
