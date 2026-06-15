import { create } from 'zustand'

interface DialogOpts {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface DialogState extends DialogOpts {
  open: boolean
  _resolve: ((ok: boolean) => void) | null
  confirm: (opts: DialogOpts) => Promise<boolean>
  respond: (ok: boolean) => void
}

export const useDialogStore = create<DialogState>((set, get) => ({
  open: false,
  title: '',
  message: '',
  confirmLabel: 'OK',
  cancelLabel: 'Cancel',
  danger: false,
  _resolve: null,
  confirm(opts) {
    return new Promise<boolean>((resolve) => {
      set({
        open: true,
        title: opts.title,
        message: opts.message ?? '',
        confirmLabel: opts.confirmLabel ?? 'OK',
        cancelLabel: opts.cancelLabel ?? 'Cancel',
        danger: opts.danger ?? false,
        _resolve: resolve,
      })
    })
  },
  respond(ok) {
    get()._resolve?.(ok)
    set({ open: false, _resolve: null })
  },
}))

/** Imperative confirm() usable anywhere. Resolves true on confirm. */
export const confirmDialog = (opts: DialogOpts) => useDialogStore.getState().confirm(opts)
