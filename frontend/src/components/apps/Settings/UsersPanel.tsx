import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import type { AppKind, ManagedUser, Role } from '@/types'
import * as api from '@/lib/restClient'
import { notify } from '@/store/notificationStore'
import { confirmDialog } from '@/store/dialogStore'
import { APP_REGISTRY } from '@/registry/appRegistry'
import { Icon } from '@/components/common/Icon'

type Editing = ManagedUser | 'new' | null

export function UsersPanel() {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [appKinds, setAppKinds] = useState<AppKind[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Editing>(null)

  // editor fields
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('user')
  const [apps, setApps] = useState<Set<AppKind>>(new Set())
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    api
      .listUsers()
      .then((r) => {
        setUsers(r.users)
        setAppKinds(r.app_kinds)
      })
      .catch((e) => notify('error', e instanceof api.ApiError ? e.message : 'Could not load users'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => load(), [load])

  function openNew() {
    setUsername('')
    setPassword('')
    setRole('user')
    setApps(new Set())
    setEditing('new')
  }
  function openEdit(u: ManagedUser) {
    setUsername(u.username)
    setPassword('')
    setRole(u.role)
    setApps(new Set(u.apps))
    setEditing(u)
  }
  function toggleApp(a: AppKind) {
    setApps((prev) => {
      const next = new Set(prev)
      next.has(a) ? next.delete(a) : next.add(a)
      return next
    })
  }

  async function save() {
    const u = username.trim()
    if (!u) return notify('warn', 'Enter a username')
    if (editing === 'new' && password.length < 4) return notify('warn', 'Password must be at least 4 characters')
    setBusy(true)
    try {
      const appsArr = Array.from(apps)
      if (editing === 'new') {
        await api.createUser({ username: u, password, role, apps: appsArr })
        notify('ok', `Created “${u}”`)
      } else if (editing) {
        await api.updateUser(editing.id, {
          username: u,
          role,
          apps: appsArr,
          ...(password ? { password } : {}),
        })
        notify('ok', `Updated “${u}”`)
      }
      setEditing(null)
      load()
    } catch (e) {
      notify('error', e instanceof api.ApiError ? e.message : 'Could not save user')
    } finally {
      setBusy(false)
    }
  }

  async function del(u: ManagedUser) {
    const ok = await confirmDialog({
      title: `Delete “${u.username}”?`,
      message: 'This user and their active sessions will be removed.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    try {
      await api.deleteUser(u.id)
      notify('ok', `Deleted “${u.username}”`)
      load()
    } catch (e) {
      notify('error', e instanceof api.ApiError ? e.message : 'Could not delete user')
    }
  }

  return (
    <>
      <div className="set-banner">
        <Icon name="users" size={17} />
        <span>
          Create users and choose which apps each can see. <b>Admins</b> see every app and can manage users.
        </span>
      </div>

      <div className="set-section">
        <div className="set-userhead">
          <div className="set-label">Accounts</div>
          <button className="tv-btn tv-btn--primary" onClick={openNew}>
            <Icon name="plus" size={14} /> New user
          </button>
        </div>

        {loading ? (
          <div className="set-group" style={{ padding: 18, textAlign: 'center' }}>
            <Icon name="refresh" size={20} className="spin" />
          </div>
        ) : (
          <div className="set-group">
            {users.map((u) => (
              <div className="set-user-row" key={u.id}>
                <div className="set-user-info">
                  <span className="set-user-name">{u.username}</span>
                  <span className={clsx('set-role', u.role === 'admin' && 'is-admin')}>{u.role}</span>
                </div>
                <span className="set-user-apps">
                  {u.role === 'admin' ? 'all apps' : `${u.apps.length} app${u.apps.length === 1 ? '' : 's'}`}
                </span>
                <div className="set-user-actions">
                  <button className="set-iconbtn" onClick={() => openEdit(u)} aria-label="Edit">
                    <Icon name="pencil" size={14} />
                  </button>
                  <button className="set-iconbtn is-danger" onClick={() => void del(u)} aria-label="Delete">
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <div className="set-section">
          <div className="set-label">{editing === 'new' ? 'New user' : `Edit “${editing.username}”`}</div>
          <div className="set-group set-user-editor">
            <div className="set-edit-field">
              <label>Username</label>
              <input
                className="tv-field"
                value={username}
                spellCheck={false}
                autoCapitalize="none"
                disabled={busy}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="set-edit-field">
              <label>Password</label>
              <input
                className="tv-field"
                type="password"
                value={password}
                placeholder={editing === 'new' ? 'Set a password' : 'Leave blank to keep current'}
                disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="set-edit-field">
              <label>Role</label>
              <select
                className="tv-field"
                value={role}
                disabled={busy}
                onChange={(e) => setRole(e.target.value as Role)}
              >
                <option value="user">User</option>
                <option value="admin">Admin (full access)</option>
              </select>
            </div>
            {role !== 'admin' && (
              <div className="set-edit-field">
                <label>Visible apps</label>
                <div className="set-app-checks">
                  {appKinds.map((a) => (
                    <label key={a} className={clsx('set-appcheck', apps.has(a) && 'is-on')}>
                      <input type="checkbox" checked={apps.has(a)} disabled={busy} onChange={() => toggleApp(a)} />
                      {APP_REGISTRY[a].title}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="set-edit-actions">
              <button className="tv-btn" onClick={() => setEditing(null)} disabled={busy}>
                Cancel
              </button>
              <button className="tv-btn tv-btn--primary" onClick={() => void save()} disabled={busy}>
                {busy && <Icon name="refresh" size={14} className="spin" />}
                {editing === 'new' ? 'Create user' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
