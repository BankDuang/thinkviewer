# ThinkViewer - Project Summary

A TeamViewer-like remote desktop control application built with Python/FastAPI, accessible via browser.

## Tech Stack

- **Backend**: Python 3, FastAPI, uvicorn, SQLite
- **Frontend**: Vanilla JS SPA, CSS (dark theme), Jinja2 templates
- **Screen Capture**: `mss` (multi-screen screenshot)
- **Input Control**: `pyautogui` (keyboard/mouse), `pyobjc-framework-Quartz` (macOS double-click)
- **Terminal**: PTY-based (`pty.openpty` + `os.fork`), xterm.js client
- **Communication**: WebSocket (real-time frames, input events, terminal I/O)

## Architecture

```
Browser (SPA)  <--WebSocket-->  FastAPI Server (port 19080)
                                  |-- ScreenStreamer (JPEG frames via WS)
                                  |-- InputHandler (pyautogui key/mouse events)
                                  |-- TerminalManager (PTY sessions)
                                  |-- FileManager (REST API)
                                  |-- Auth (SQLite sessions, 24h expiry)
```

## File Structure

| File | Lines | Purpose |
|------|-------|---------|
| `main.py` | ~1020 | FastAPI server, screen capture, input handling, PTY terminal, file API, auth |
| `static/js/app.js` | ~1810 | SPA client: desktop viewer, terminal tabs, file manager, settings |
| `templates/index.html` | ~478 | Single HTML template with all pages (login, desktop, terminal, files, settings) |
| `static/css/style.css` | ~1750 | Dark theme, responsive (desktop/tablet/mobile), xterm styling |
| `requirements.txt` | 11 | Python dependencies |
| `thinkviewer.db` | -- | SQLite database (auto-created, stores settings/sessions/logs) |

## Key Features

### Remote Desktop
- Real-time screen streaming (JPEG over WebSocket, configurable quality/FPS/scale)
- Mouse: click, double-click, drag, scroll, right-click
- Keyboard: key_down/key_up (real hold behavior), key combos, text input
- Cursor overlay drawn on captured frames
- Zoom: fit-to-window, step zoom, Ctrl+scroll zoom, pinch-zoom (mobile)
- Fullscreen mode with floating toolbar

### Terminal (PTY + xterm.js)
- Real shell sessions via `pty.openpty()` + `os.fork()` with `TERM=xterm-256color`
- Multiple tabs (create/switch/close)
- Full ANSI color and escape code support
- 64KB scrollback ring buffer for reconnect replay (prefixed with `\033c` reset)
- Multi-client: multiple browser tabs see same terminal output
- Process group cleanup (`os.killpg`) on close + `atexit` handler
- xterm.js with Tokyo Night color theme, 12px font, 5000-line scrollback

### File Manager (FileZilla-style)
- Split pane: client (browser) + device (remote)
- Upload: drag-and-drop or file picker, upload to current directory
- Download: click to select, double-click to download
- Browse directories, create folders, delete files
- Transfer log with timestamps

### Authentication & Sessions
- Password-based login (SHA-256 hash in SQLite)
- Password from `.env` (`THINKVIEWER_PASSWORD`) or auto-generated
- 24h session tokens stored in `localStorage` for auto-login
- Device ID: random 9-digit number (formatted xxx-xxx-xxx)

### System Integration
- Wake screen on client connect (`caffeinate` on macOS)
- Keep-awake while clients connected (`caffeinate -dis`)
- macOS double-click via Quartz CGEvents with proper `clickState`

### Mobile Support
- Bottom tab bar navigation
- Touch events: tap (click), double-tap, long-press (right-click), drag, pinch-zoom, two-finger pan
- Mobile floating toolbar with control toggle, shortcuts, keyboard button
- On-screen keyboard via hidden input element
- Responsive CSS breakpoints at 1024px (tablet) and 768px (mobile)

## Key Design Patterns

### Modifier Key Handling
- Per-modifier timestamp tracking in `modifier_down_times` dict
- Server auto-releases any modifier held > 2 seconds
- Client-side 1-second interval releases modifiers stuck > 3 seconds
- `blur` and `visibilitychange` handlers release all modifiers
- `fn` key is always filtered (never sent, always released server-side)

### WebSocket Protocol
Messages are JSON with `type` field:
- **Desktop**: `auth`, `auth_ok`, `frame`, `stream_settings`, `mouse_*`, `key_down`, `key_up`, `key_press`, `key_combo`, `release_modifiers`, `type_text`
- **Terminal**: `term_create`, `term_created`, `term_input`, `term_output` (base64), `term_resize`, `term_close`, `term_closed`, `term_list`, `term_subscribe`, `term_subscribed`

### Terminal Reconnect
On WebSocket reconnect, client requests `term_list`, then `term_subscribe` for each alive session. Server sends `\033c` (RIS reset) + scrollback buffer to prevent garbled output.

## Configuration

- Port: `THINKVIEWER_PORT` env var (default 19080)
- Password: `THINKVIEWER_PASSWORD` env var (or auto-generated)
- `.env` file supported via `python-dotenv`

## Running

```bash
pip install -r requirements.txt
python main.py
# Open http://localhost:19080
```

## Known Solutions to Recurring Issues

1. **Modifier keys get stuck**: Solved with per-modifier timestamp tracking + multi-layer auto-release (server 2s, client 3s, blur/visibility handlers)
2. **Terminal garbled on reconnect**: Solved with `\033c` reset prefix before scrollback replay
3. **fn key causes issues on macOS**: Solved by completely filtering fn (never sent client-side, always released server-side)
4. **Double-click not registering**: Solved with Quartz CGEvents and proper `clickState` values (1 for first click, 2 for second)
5. **PTY processes survive server exit**: Solved with `os.killpg()` (kills process group) + SIGKILL fallback + `atexit` handler
