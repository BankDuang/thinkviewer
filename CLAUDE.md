# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is ThinkViewer

A self-hosted, browser-based remote desktop application (like TeamViewer), presented as a **macOS-style desktop web UI**. A Python/FastAPI **engine** does the host-OS work (screen capture, input injection, PTY terminals, files, auth); a **React + Vite + TypeScript SPA** (`frontend/`) renders a draggable-window desktop with a dock, menu bar, wallpapers, and five apps: Remote Desktop, Terminal, Files, Settings, and **Servers** (a process manager for sibling Python apps under `~/Desktop/public_server`). Real-time data is WebSocket-first.

Why this split (not "all React"): the backend needs host-OS access React cannot have — `mss` screen capture, `pyautogui`/Quartz input injection, `os.fork`+`pty` terminals. So the backend stays Python and serves the built SPA.

## Commands

```bash
# --- Backend engine (Python) ---
pip install -r requirements.txt
python run.py                  # serves API+WS, and the built SPA, on http://localhost:19080
                                # binds 127.0.0.1 by default; THINKVIEWER_BIND=0.0.0.0 to expose (warns)
                                # THINKVIEWER_AUTOUPDATE=0 disables the git auto-updater (do this in dev)

# --- Frontend (React/Vite/TS) — lives in ./frontend ---
cd frontend && npm install
npm run build                   # type-checks (tsc --noEmit) then emits frontend/dist (served by run.py)
npm run dev                     # Vite dev server on :5173, proxies /api /ws /static -> :19080
npm run typecheck               # tsc --noEmit only

# --- Assets ---
python gen_wallpapers.py        # (re)generate the built-in wallpaper set into static/wallpapers via Gemini
python generate_image.py "PROMPT" -o path.png   # single image (Gemini gemini-3.1-flash-image)

# --- Smoke test (server must be running on 19080) ---
node playwright_verify.js       # logs in, opens each app, screenshots to screenshots/, reports console errors
```

**Dev loop**: run `python run.py` (terminal A) + `npm run dev` (terminal B), open http://localhost:5173. **Prod/single-process**: `npm run build` then `python run.py`, open http://localhost:19080. `frontend/dist` is committed so the auto-updater's `git reset --hard` always ships a working bundle.

## Configuration

Environment variables (or `.env`, which is gitignored — it holds `GEMINI_API_KEY`/`OPENAI_API_KEY` used only by image generation; secrets must never reach the client bundle):
- `THINKVIEWER_PASSWORD` — login password (auto-generated + printed at startup if unset)
- `THINKVIEWER_PORT` — server port (default 19080)
- `THINKVIEWER_BIND` — bind address (default `127.0.0.1`; `0.0.0.0` to expose on LAN)
- `THINKVIEWER_AUTOUPDATE` — `0` disables the git auto-updater (default on)
- `THINKVIEWER_MAX_UPLOAD_MB` — file-upload size cap (default 2048)
- `THINKVIEWER_SERVERS_DIR` — base dir the Servers app manages (default `~/Desktop/public_server`)

## Architecture

```
React SPA (frontend/dist)  <--single WebSocket /ws + REST /api-->  FastAPI engine (run.py)
                                                                     ├── ScreenStreamer  (mss → PIL → JPEG → raw-binary WS frames)
                                                                     ├── InputHandler    (pyautogui mouse/keyboard, Quartz on macOS)
                                                                     ├── TerminalManager (os.fork + pty, multi-client sync, image paste)
                                                                     ├── FileManager     (REST list/upload/download/delete/mkdir)
                                                                     ├── Wallpapers      (REST list/select/upload/delete → static/wallpapers)
                                                                     ├── ServerManager   (spawn/stop/monitor sibling apps; logs → server_logs/)
                                                                     └── Auth            (SQLite: SHA-256 password, 24h tokens)
```

**Backend** (single file `run.py`): unchanged OS subsystems plus a SPA catch-all route (declared LAST; rejects `api/`/`ws`/`assets/`/`static/`, serves `frontend/dist/index.html` for extensionless paths, real files only inside dist) and the wallpaper endpoints. `/static` serves `static/wallpapers`; `/assets` serves `frontend/dist/assets` (mounted only if built). SQLite (`thinkviewer.db`): tables `settings`, `sessions`, `connection_log`, `services` (wallpaper selection + servers base dir persist in `settings`).

**Frontend** (`frontend/src`): Vite + React 18 + TypeScript, Zustand stores, framer-motion, `@xterm/xterm`. Key layout:
- `types/` — the WS/REST contract (`ws.ts` ClientMsg/ServerMsg discriminated unions, `api.ts` DTOs, `windows.ts` incl. `AppProps`).
- `lib/` — `wsClient.ts` (singleton socket), `restClient.ts` (typed REST, per-endpoint token slot), `frameSink.ts` (off-React canvas renderer), `terminalRegistry.ts` (persistent xterm instances), `keymap.ts`, `base64.ts`, `layout.ts`, `openApp.ts`.
- `store/` — Zustand: `windowStore` (window manager), `sessionStore`, `connectionStore`, `streamStore`, `terminalStore`, `desktopStore`, `notificationStore`, `dialogStore`.
- `hooks/useWebSocket.ts` — wires the socket to stores + frameSink + xterm (mount ONCE, in Desktop).
- `components/` — `desktop/` (Desktop, MenuBar, Dock, Wallpaper, DesktopIcon), `window/` (Window chrome + traffic lights), `common/` (Login, Icon, AppTile, Notification, Dialog), `apps/{RemoteDesktop,Terminal,Files,Settings}/`.
- `registry/appRegistry.tsx` — `AppKind` → `{title, defaultSize, singleton, Component}`.

## WebSocket Protocol

One app-wide WebSocket at `/ws` (single socket shared by all windows — the engine streams frames to every client and broadcasts `term_*` to all). Most messages are JSON with a `type` field; **screen frames are the exception — raw binary JPEG blobs (`ws.send_bytes`), routed to `frameSink`, never JSON**.
- **Handshake**: client sends `{type:'auth',token}` first; server replies `auth_ok{screen_width,screen_height}`. Sends are queued client-side until `auth_ok`.
- **Desktop input** (coords normalized 0..1 vs the displayed canvas rect): `mouse_move/down/up/click/dblclick/scroll`, `key_down/key_up/key_press`, `key_combo`, `type_text`, `release_modifiers`, `stream_settings`.
- **Terminal**: `term_create`→`term_created`, `term_input` (base64), `term_resize`, `term_close`, `term_subscribe`→`term_subscribed`, `term_list`, `term_rename`→`term_renamed`, `term_paste_image`→`term_image_pasted`; `term_output` (base64). Create/close/rename also broadcast `term_new`/`term_closed`/`term_renamed` to all clients via `_all_ws`.

## REST (token slot varies by endpoint — `restClient.ts` handles it)

- **Bearer**: `GET /api/info`, `POST /api/settings/stream|password`, `POST /api/files/mkdir`, `DELETE /api/files/delete`, `POST /api/wallpapers/select`, `DELETE /api/wallpapers`, `POST /api/terminal/paste-image`, `POST /api/command`.
- **`?token=` query**: `GET /api/files/list`, `GET /api/files/download` (used as `<a href download>`), `GET /api/wallpapers`.
- **Form field**: `POST /api/files/upload`, `POST /api/wallpapers/upload`.
- **Servers** (all Bearer): `GET /api/servers`, `GET /api/servers/discover`, `GET /api/servers/interpreters?cwd=`, `POST /api/servers/base-dir`, `POST /api/servers`, `PUT/DELETE /api/servers/{id}`, `POST /api/servers/{id}/start|stop|restart`, `GET /api/servers/{id}/logs?lines=`.
- **Deploy/HTTPS** (all Bearer): `GET /api/deploy/info`, `POST /api/servers/{id}/reachability` `{domain,port?}`, `POST /api/servers/{id}/deploy` `{domain,email?,staging?}`, `GET /api/servers/{id}/deploy/log`.
- **No auth**: `POST /api/auth/login|logout`, `GET /{path}` (SPA shell).

## Critical Implementation Details

**Hot path bypasses React**: `frameSink` decodes JPEG blobs via `createImageBitmap` (off-thread), draws to an uncontrolled `<canvas>` with newest-wins frame dropping and `bmp.close()` in a `finally`. Per-frame mouse-move + window drag/resize mutate the DOM imperatively and commit to the store only on pointer-up. Never `setState` on the frame or mouse-move path.

**Single socket / reconnect**: `wsClient` is one socket with exponential backoff + jitter; `onclose` ignores stale sockets (`if (this.ws !== ws) return`) to avoid StrictMode duplicate-socket storms; STOPS reconnecting and routes to login on Unauthorized. The pre-auth queue is capped and drops transient input (no stale-input replay on reconnect).

**Terminal**: xterm instances live in `terminalRegistry` keyed by `session_id`, disposed only on real close (and reconciled against `term_list` after reconnect). `term.onData` is wired once per session; text paste is handled by xterm's own listener (don't double-send); image paste reads clipboard/drag → base64 → `term_paste_image`. StrictMode-safe create latch.

**Input parity** (mirrors the retired client): normalized coords account for `object-fit:contain` letterboxing; `key_down`/`key_up` (not press) for hold; `Meta`→`command`; `fn`/lock keys filtered; modifiers auto-release on blur/visibilitychange/control-off/unmount + 3s safety timer; double-click → `mouse_dblclick` (Quartz `clickState`); `Cmd/Ctrl+V` reads the local clipboard and sends `type_text`.

**Backend OS subsystems** (preserved): raw-binary frames with MD5 dirty-skip + 2s keepalive; HiDPI `effective_scale = scale / hiDPI_ratio` (so `scale=1.0` = logical resolution; clamps scale 0.25–2.0, fps 1–30, quality 10–100); PTY 64KB scrollback ring replay (`\033c` reset); macOS double-click via Quartz `clickState`; `caffeinate` keep-awake. **Image-paste clipboard bridge**: the path is passed to `osascript` as an argument and the extension comes from a MIME allowlist (no command injection); on macOS `osascript` needs `DEVNULL` not `PIPE`. **Auto-updater**: daemon thread, `git fetch` every 30s, pulls only when remote is strictly ahead (`merge-base --is-ancestor`), then closes PTYs + stops keep-awake before `os.execv`. Destructive, no rollback.

**ServerManager** (process manager behind the Servers app): managed apps are spawned with `start_new_session=True` (their own process group) so they **survive a ThinkViewer restart**; the PID is persisted in `services` and `reconcile()` recovers status on boot. Stop uses `killpg` SIGTERM→SIGKILL. stdout+stderr append to `server_logs/<id>.log`. Status = PID-alive + a 0.25s TCP connect to the configured port. `entry` is validated to live inside `cwd` (no traversal); blocking ops (start/stop/list with port checks) run via `asyncio.to_thread`. Interpreter discovery finds project venvs (`.venv`/`venv`/`env`), `pyenv` versions, and Homebrew/system pythons.

**Deploy / HTTPS** (the Servers app "Publish" button → `deploy-kit/deploy.sh`): assigns a `domain` to a service and runs the kit (nginx reverse-proxy `https://domain` → `127.0.0.1:<port>` + certbot HTTP-01 + auto-renew). `deploy.sh` needs **root**, so it's launched via `osascript "do shell script … with administrator privileges"` — the macOS auth dialog appears **on the host Mac** (no password touches the app). The kit is copied to `/tmp/tv-deploy-kit` first (the `~/Desktop` source is TCC-protected). `domain`/`email` are strictly regex-validated (no shell injection) and written into a one-shot `/tmp/tv-deploy-run-<id>.sh`; output streams to `server_logs/deploy-<id>.log` (tailed live by the UI); `https=1` is set when the log shows the kit's success marker. `reachability` runs `check-reachability.sh` (non-root, global probe of inbound port 80). Requires `brew install nginx certbot`, a DNS A record → the host's public IP, and open inbound 80/443.

## Notes / known limitations

- `test_thinkviewer.js` and `test_files_view.js` target the **old** vanilla UI and no longer match the SPA; `playwright_verify.js` is the current smoke test.
- `/api/info` returns the cleartext connection password by design (shown in Settings, like TeamViewer). `POST /api/command` is a retained shell-exec endpoint — another reason to keep the default `127.0.0.1` bind.
