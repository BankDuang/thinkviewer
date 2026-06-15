import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type {
  DiscoveredFolder,
  Interpreter,
  ManagedService,
  ServiceInput,
} from '@/types'
import * as api from '@/lib/restClient'
import { notify } from '@/store/notificationStore'
import { Icon } from '@/components/common/Icon'

interface AddServerDialogProps {
  mode: 'add' | 'edit'
  service?: ManagedService
  onClose: () => void
  onSaved: () => void
}

const CUSTOM = '__custom__'
const KIND_LABELS: Record<Interpreter['kind'], string> = {
  venv: 'Virtual environments',
  pyenv: 'pyenv',
  system: 'System',
}

function basename(p: string): string {
  return p.split('/').filter(Boolean).pop() ?? p
}

// An entry may be a path inside the project (e.g. "server/run.py"); the runnable
// directory is the project folder + that subdir, and the entry is the filename.
function splitEntry(rel: string): { dir: string; file: string } {
  const parts = rel.split('/').filter(Boolean)
  const file = parts.pop() ?? rel
  return { dir: parts.join('/'), file }
}

function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const key = t.slice(0, eq).trim()
    if (key) env[key] = t.slice(eq + 1).trim()
  }
  return env
}

export function AddServerDialog({ mode, service, onClose, onSaved }: AddServerDialogProps) {
  const isAdd = mode === 'add'

  // Folder discovery (add only)
  const [folders, setFolders] = useState<DiscoveredFolder[]>([])
  const [discovering, setDiscovering] = useState(isAdd)
  const [phase, setPhase] = useState<'pick' | 'form'>(isAdd ? 'pick' : 'form')

  // Selected target + form fields
  const [cwd, setCwd] = useState(service?.cwd ?? '')
  const [entries, setEntries] = useState<string[]>([])
  const [name, setName] = useState(service?.name ?? '')
  const [entry, setEntry] = useState(service?.entry ?? '')
  const [portText, setPortText] = useState(service?.port != null ? String(service.port) : '')
  const [portTouched, setPortTouched] = useState(!isAdd && service?.port != null)
  const [argsText, setArgsText] = useState(service?.args.join(' ') ?? '')
  const [envText, setEnvText] = useState(
    service ? Object.entries(service.env).map(([k, v]) => `${k}=${v}`).join('\n') : '',
  )
  const [domain, setDomain] = useState(service?.domain ?? '')
  const [email, setEmail] = useState(service?.email ?? '')

  // Interpreter selection
  const [interpreters, setInterpreters] = useState<Interpreter[]>([])
  const [interpLoading, setInterpLoading] = useState(false)
  const [python, setPython] = useState(service?.python ?? '')
  const [pythonMode, setPythonMode] = useState<'select' | 'custom'>('select')

  const [saving, setSaving] = useState(false)

  // Keep a ref of the current python value so the interpreter effect can read the
  // prefilled value without re-running on every keystroke of the custom field.
  const pythonRef = useRef(python)
  pythonRef.current = python

  // Resolve the runnable working directory + entry filename from the (possibly
  // nested) entry path, so apps whose runner lives in a subdir work correctly.
  const { dir: entrySubdir, file: effectiveEntry } = useMemo(
    () => splitEntry(entry.trim()),
    [entry],
  )
  const effectiveCwd = useMemo(
    () => (entrySubdir ? `${cwd.replace(/\/+$/, '')}/${entrySubdir}` : cwd),
    [cwd, entrySubdir],
  )

  // --- Discover folders (add mode) ------------------------------------------
  useEffect(() => {
    if (!isAdd) return
    let cancelled = false
    setDiscovering(true)
    api
      .discoverServers()
      .then((resp) => {
        if (!cancelled) setFolders(resp.folders)
      })
      .catch((e: unknown) => {
        if (!cancelled) notify('error', e instanceof api.ApiError ? e.message : 'Could not scan folders')
      })
      .finally(() => {
        if (!cancelled) setDiscovering(false)
      })
    return () => {
      cancelled = true
    }
  }, [isAdd])

  // --- Fetch interpreters whenever the resolved working dir changes ---------
  useEffect(() => {
    if (!effectiveCwd) return
    let cancelled = false
    setInterpLoading(true)
    api
      .serverInterpreters(effectiveCwd)
      .then(({ interpreters: list }) => {
        if (cancelled) return
        setInterpreters(list)
        const cur = pythonRef.current
        if (cur && list.some((i) => i.path === cur)) {
          setPythonMode('select')
        } else if (cur) {
          // Prefilled path that isn't in the discovered list (e.g. on edit).
          setPythonMode('custom')
        } else {
          const venv = list.find((i) => i.kind === 'venv')
          const sys = list.find((i) => i.kind === 'system')
          setPython((venv ?? sys ?? list[0])?.path ?? '')
          setPythonMode('select')
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setInterpreters([])
        notify('warn', e instanceof api.ApiError ? e.message : 'Could not list interpreters')
      })
      .finally(() => {
        if (!cancelled) setInterpLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [effectiveCwd])

  // --- Auto-suggest a port from the entry/.env (until the user edits it) -----
  useEffect(() => {
    if (portTouched || !effectiveEntry || !effectiveCwd) return
    let cancelled = false
    api
      .suggestPort(effectiveCwd, effectiveEntry)
      .then(({ port }) => {
        if (!cancelled && !portTouched) setPortText(String(port))
      })
      .catch(() => {
        /* leave the port empty on failure */
      })
    return () => {
      cancelled = true
    }
  }, [effectiveCwd, effectiveEntry, portTouched])

  // --- Escape to close ------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  function pickFolder(folder: DiscoveredFolder) {
    setCwd(folder.path)
    setEntries(folder.entries)
    setName(folder.name)
    setEntry(folder.suggested_entry ?? folder.entries[0] ?? '')
    setPython('')
    setPythonMode('select')
    setPortText('')
    setPortTouched(false)
    setPhase('form')
  }

  async function submit() {
    const trimmedEntry = entry.trim()
    if (!cwd) {
      notify('warn', 'Choose a project folder')
      return
    }
    if (!trimmedEntry) {
      notify('warn', 'Choose an entry file')
      return
    }
    let port: number | null = null
    if (portText.trim()) {
      const n = Number(portText.trim())
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        notify('warn', 'Port must be a number between 1 and 65535')
        return
      }
      port = n
    }
    const input: ServiceInput = {
      name: name.trim() || basename(effectiveCwd),
      cwd: effectiveCwd,
      entry: effectiveEntry,
      python: python.trim() || undefined,
      port,
      args: argsText.trim() ? argsText.trim().split(/\s+/) : [],
      env: parseEnv(envText),
      domain: domain.trim() || undefined,
      email: email.trim() || undefined,
    }
    setSaving(true)
    try {
      if (isAdd) {
        await api.createServer(input)
        notify('ok', `Added “${input.name}”`)
      } else if (service) {
        await api.updateServer(service.id, input)
        notify('ok', `Updated “${input.name}”`)
      }
      onSaved()
      onClose()
    } catch (e) {
      notify('error', e instanceof api.ApiError ? e.message : 'Could not save service')
      setSaving(false)
    }
  }

  const showForm = phase === 'form'

  return (
    <motion.div
      className="srv-overlay is-dialog"
      onMouseDown={() => !saving && onClose()}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
    >
      <motion.div
        className="srv-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="srv-dialog-head">
          <span className="srv-dialog-title">
            {isAdd ? (showForm ? 'Configure server' : 'Add a server') : 'Edit server'}
          </span>
          <button className="srv-close" onClick={onClose} disabled={saving} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="srv-dialog-body">
          {/* ---------- Folder picker (add mode, phase 1) ---------- */}
          {!showForm && (
            <>
              {discovering ? (
                <div className="srv-dialog-msg">
                  <Icon name="refresh" size={20} className="spin" />
                  Scanning for project folders…
                </div>
              ) : folders.length === 0 ? (
                <div className="srv-dialog-msg">
                  <Icon name="folder" size={22} />
                  No project folders found in the base directory.
                </div>
              ) : (
                <div className="srv-folder-list">
                  {folders.map((f) => (
                    <button key={f.path} className="srv-folder-item" onClick={() => pickFolder(f)}>
                      <Icon name="folder" size={18} className="srv-folder-icon" />
                      <span className="srv-folder-info">
                        <span className="srv-folder-name">{f.name}</span>
                        <span className="srv-folder-meta">
                          {f.entries.length} python file{f.entries.length === 1 ? '' : 's'}
                          {f.suggested_entry ? ` · ${f.suggested_entry}` : ''}
                        </span>
                      </span>
                      {f.has_venv && <span className="srv-badge">venv</span>}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ---------- Configuration form (phase 2) ---------- */}
          {showForm && (
            <>
              {/* Folder */}
              <div className="srv-field">
                <span className="srv-field-label">Working directory</span>
                <div className="srv-readonly">
                  <Icon name="folder" size={14} />
                  <span className="srv-readonly-path" title={effectiveCwd}>
                    {effectiveCwd}
                  </span>
                  {isAdd && (
                    <button className="srv-link-btn" onClick={() => setPhase('pick')}>
                      Change
                    </button>
                  )}
                </div>
              </div>

              {/* Name */}
              <div className="srv-field">
                <span className="srv-field-label">Name</span>
                <input
                  className="tv-field srv-input"
                  value={name}
                  spellCheck={false}
                  placeholder={basename(cwd)}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="srv-field-row">
                {/* Entry */}
                <div className="srv-field">
                  <span className="srv-field-label">Entry file</span>
                  {entries.length > 0 ? (
                    <select
                      className="tv-field srv-select"
                      value={entry}
                      onChange={(e) => setEntry(e.target.value)}
                    >
                      {entry && !entries.includes(entry) && <option value={entry}>{entry}</option>}
                      {entries.map((e) => (
                        <option key={e} value={e}>
                          {e}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="tv-field srv-input"
                      value={entry}
                      spellCheck={false}
                      placeholder="app.py"
                      onChange={(e) => setEntry(e.target.value)}
                    />
                  )}
                </div>

                {/* Port */}
                <div className="srv-field">
                  <span className="srv-field-label">
                    Port <span className="srv-optional">optional</span>
                  </span>
                  <input
                    className="tv-field srv-input"
                    value={portText}
                    inputMode="numeric"
                    spellCheck={false}
                    placeholder="auto"
                    onChange={(e) => {
                      setPortText(e.target.value.replace(/[^0-9]/g, ''))
                      setPortTouched(true)
                    }}
                  />
                </div>
              </div>

              {/* Interpreter */}
              <div className="srv-field">
                <span className="srv-field-label">Python interpreter</span>
                {interpLoading ? (
                  <div className="srv-readonly">
                    <Icon name="refresh" size={14} className="spin" />
                    Finding interpreters…
                  </div>
                ) : pythonMode === 'custom' ? (
                  <div className="srv-custom-row">
                    <input
                      className="tv-field srv-input"
                      value={python}
                      spellCheck={false}
                      placeholder="/path/to/python"
                      onChange={(e) => setPython(e.target.value)}
                    />
                    <button
                      className="srv-link-btn"
                      onClick={() => {
                        setPython('')
                        setPythonMode('select')
                      }}
                    >
                      Use list
                    </button>
                  </div>
                ) : (
                  <select
                    className="tv-field srv-select"
                    value={python}
                    onChange={(e) => {
                      if (e.target.value === CUSTOM) {
                        setPython('')
                        setPythonMode('custom')
                      } else {
                        setPython(e.target.value)
                      }
                    }}
                  >
                    <option value="">Default (project / system)</option>
                    {(['venv', 'pyenv', 'system'] as const).map((kind) => {
                      const group = interpreters.filter((i) => i.kind === kind)
                      if (group.length === 0) return null
                      return (
                        <optgroup key={kind} label={KIND_LABELS[kind]}>
                          {group.map((i) => (
                            <option key={i.path} value={i.path}>
                              {i.label}
                            </option>
                          ))}
                        </optgroup>
                      )
                    })}
                    <option value={CUSTOM}>Custom path…</option>
                  </select>
                )}
              </div>

              {/* Args */}
              <div className="srv-field">
                <span className="srv-field-label">
                  Arguments <span className="srv-optional">space-separated</span>
                </span>
                <input
                  className="tv-field srv-input"
                  value={argsText}
                  spellCheck={false}
                  placeholder="--host 0.0.0.0 --reload"
                  onChange={(e) => setArgsText(e.target.value)}
                />
              </div>

              {/* Domain / Email (for HTTPS publishing) */}
              <div className="srv-field-row">
                <div className="srv-field">
                  <span className="srv-field-label">
                    Domain <span className="srv-optional">for HTTPS</span>
                  </span>
                  <input
                    className="tv-field srv-input"
                    value={domain}
                    spellCheck={false}
                    autoCapitalize="none"
                    placeholder="app.example.com"
                    onChange={(e) => setDomain(e.target.value.trim())}
                  />
                </div>
                <div className="srv-field">
                  <span className="srv-field-label">
                    Email <span className="srv-optional">cert notices</span>
                  </span>
                  <input
                    className="tv-field srv-input"
                    value={email}
                    type="email"
                    spellCheck={false}
                    autoCapitalize="none"
                    placeholder="you@example.com"
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              {/* Env */}
              <div className="srv-field">
                <span className="srv-field-label">
                  Environment <span className="srv-optional">KEY=VALUE per line</span>
                </span>
                <textarea
                  className="tv-field srv-textarea"
                  value={envText}
                  spellCheck={false}
                  placeholder={'DEBUG=1\nAPI_KEY=…'}
                  onChange={(e) => setEnvText(e.target.value)}
                />
              </div>
            </>
          )}
        </div>

        <div className="srv-dialog-foot">
          <button className="tv-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          {showForm && (
            <button className="tv-btn tv-btn--primary" onClick={() => void submit()} disabled={saving}>
              {saving && <Icon name="refresh" size={14} className="spin" />}
              {isAdd ? 'Add server' : 'Save changes'}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
