import { useEffect, useRef, useState } from 'react'
import type { Wallpaper } from '@/types'
import { useDesktopStore } from '@/store/desktopStore'
import * as api from '@/lib/restClient'
import { notify } from '@/store/notificationStore'
import { confirmDialog } from '@/store/dialogStore'
import { Icon } from '@/components/common/Icon'

export function WallpaperPicker() {
  const wallpapers = useDesktopStore((s) => s.wallpapers)
  const wallpaperId = useDesktopStore((s) => s.wallpaperId)
  const loading = useDesktopStore((s) => s.loading)
  const loadWallpapers = useDesktopStore((s) => s.loadWallpapers)
  const setWallpaper = useDesktopStore((s) => s.setWallpaper)
  const addUploaded = useDesktopStore((s) => s.addUploaded)
  const removeWallpaper = useDesktopStore((s) => s.removeWallpaper)

  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    void loadWallpapers()
  }, [loadWallpapers])

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const { id, url } = await api.uploadWallpaper(file)
      const name = file.name.replace(/\.[^.]+$/, '') || id
      addUploaded({ id, name, url, builtin: false })
      await setWallpaper(id)
      notify('ok', 'Wallpaper added')
    } catch (err) {
      notify('error', err instanceof api.ApiError ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function onDelete(e: React.SyntheticEvent, wp: Wallpaper) {
    e.stopPropagation()
    const ok = await confirmDialog({
      title: `Delete "${wp.name}"?`,
      message: 'This wallpaper will be removed permanently.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (ok) await removeWallpaper(wp.id)
  }

  if (loading && wallpapers.length === 0) {
    return (
      <div className="set-loading">
        <Icon name="refresh" size={24} className="spin" />
        Loading wallpapers…
      </div>
    )
  }

  return (
    <div className="set-section">
      <div className="set-label">Desktop Wallpaper</div>
      <div className="set-wp-grid">
        {wallpapers.map((wp) => {
          const selected = wp.id === wallpaperId
          return (
            <div
              key={wp.id}
              className={`set-wp${selected ? ' is-selected' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={`Use ${wp.name}`}
              aria-pressed={selected}
              onClick={() => setWallpaper(wp.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  void setWallpaper(wp.id)
                }
              }}
            >
              <img src={wp.url} alt={wp.name} loading="lazy" draggable={false} />
              {!wp.builtin && (
                <button
                  type="button"
                  className="set-wp-del"
                  aria-label={`Delete ${wp.name}`}
                  onClick={(e) => onDelete(e, wp)}
                >
                  <Icon name="trash" size={14} />
                </button>
              )}
              {selected && (
                <span className="set-wp-check" aria-hidden="true">
                  <Icon name="check" size={14} strokeWidth={2.4} />
                </span>
              )}
            </div>
          )
        })}

        <button
          type="button"
          className="set-wp-up"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          <Icon name={uploading ? 'refresh' : 'upload'} size={22} className={uploading ? 'spin' : undefined} />
          {uploading ? 'Uploading…' : 'Upload…'}
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={onPick}
      />

      <p className="set-note">Wallpaper is shared across every connected client.</p>
    </div>
  )
}
