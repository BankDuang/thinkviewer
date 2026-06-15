import { create } from 'zustand'

interface DialogOpts {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface PromptOpts extends DialogOpts {
  defaultValue?: string
  placeholder?: string
}

interface DialogState {
  open: boolean
  mode: 'confirm' | 'prompt'
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  danger: boolean
  defaultValue: string
  placeholder: string
  _resolve: ((value: boolean | string | null) => void) | null
  confirm: (opts: DialogOpts) => Promise<boolean>
  prompt: (opts: PromptOpts) => Promise<string | null>
  respond: (ok: boolean, value?: string) => void
}

export const useDialogStore = create<DialogState>((set, get) => ({
  open: false,
  mode: 'confirm',
  title: '',
  message: '',
  confirmLabel: 'OK',
  cancelLabel: 'Cancel',
  danger: false,
  defaultValue: '',
  placeholder: '',
  _resolve: null,
  confirm(opts) {
    return new Promise<boolean>((resolve) => {
      set({
        open: true,
        mode: 'confirm',
        title: opts.title,
        message: opts.message ?? '',
        confirmLabel: opts.confirmLabel ?? 'OK',
        cancelLabel: opts.cancelLabel ?? 'Cancel',
        danger: opts.danger ?? false,
        _resolve: resolve as (v: boolean | string | null) => void,
      })
    })
  },
  prompt(opts) {
    return new Promise<string | null>((resolve) => {
      set({
        open: true,
        mode: 'prompt',
        title: opts.title,
        message: opts.message ?? '',
        confirmLabel: opts.confirmLabel ?? 'OK',
        cancelLabel: opts.cancelLabel ?? 'Cancel',
        danger: opts.danger ?? false,
        defaultValue: opts.defaultValue ?? '',
        placeholder: opts.placeholder ?? '',
        _resolve: resolve as (v: boolean | string | null) => void,
      })
    })
  },
  respond(ok, value) {
    const { _resolve, mode } = get()
    if (_resolve) _resolve(mode === 'prompt' ? (ok ? value ?? '' : null) : ok)
    set({ open: false, _resolve: null })
  },
}))

/** Imperative confirm() usable anywhere. Resolves true on confirm. */
export const confirmDialog = (opts: DialogOpts) => useDialogStore.getState().confirm(opts)

/** Imperative prompt() — resolves the entered string, or null if cancelled. */
export const promptDialog = (opts: PromptOpts) => useDialogStore.getState().prompt(opts)
