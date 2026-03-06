/* ============================================================
   ThinkViewer - SPA Client
   ============================================================ */

// === State ===
const state = {
    token: null,
    ws: null,
    currentPage: 'desktop',
    controlling: false,
    screenWidth: 0,
    screenHeight: 0,
    commandHistory: [],
    historyIndex: -1,
    currentDir: '~',
    passwordVisible: false,
    frameReceived: false,
    wsReconnectTimer: null,
    zoom: 0,         // 0 = fit-to-window, >0 = percentage (e.g. 100 = 100%)
    isFullscreen: false,
    isPanning: false,
    panStart: { x: 0, y: 0 },
    scrollStart: { x: 0, y: 0 },
};

// === Key Mapping ===
const KEY_MAP = {
    'Enter': 'enter', 'Backspace': 'backspace', 'Tab': 'tab',
    'Escape': 'escape', 'Delete': 'delete', 'Insert': 'insert',
    'ArrowUp': 'up', 'ArrowDown': 'down', 'ArrowLeft': 'left', 'ArrowRight': 'right',
    'Home': 'home', 'End': 'end', 'PageUp': 'pageup', 'PageDown': 'pagedown',
    ' ': 'space',
    'F1': 'f1', 'F2': 'f2', 'F3': 'f3', 'F4': 'f4',
    'F5': 'f5', 'F6': 'f6', 'F7': 'f7', 'F8': 'f8',
    'F9': 'f9', 'F10': 'f10', 'F11': 'f11', 'F12': 'f12',
};

// === Init ===
document.addEventListener('DOMContentLoaded', () => {
    // Login form
    document.getElementById('login-form').addEventListener('submit', (e) => {
        e.preventDefault();
        login();
    });

    document.getElementById('login-btn').addEventListener('click', login);

    // Terminal input
    document.getElementById('terminal-input').addEventListener('keydown', handleTerminalKey);

    // Auto-focus password input
    document.getElementById('password-input').focus();
});

// === Auth ===
async function login() {
    const passwordInput = document.getElementById('password-input');
    const password = passwordInput.value.trim();
    const errorDiv = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');

    if (!password) {
        errorDiv.textContent = 'Please enter a password';
        errorDiv.classList.remove('hidden');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Connecting...';

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
        });

        if (!res.ok) {
            throw new Error('Invalid password');
        }

        const data = await res.json();
        state.token = data.token;
        errorDiv.classList.add('hidden');

        // Switch to main view
        document.getElementById('login-view').classList.add('hidden');
        document.getElementById('main-view').classList.remove('hidden');

        // Start WebSocket & load data
        connectWebSocket();
        loadDeviceInfo();
        loadDirectory('~');
        initFileManager();

    } catch (err) {
        errorDiv.textContent = err.message || 'Connection failed';
        errorDiv.classList.remove('hidden');
        passwordInput.value = '';
        passwordInput.focus();
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/>
            <polyline points="10 17 15 12 10 7"/>
            <line x1="15" y1="12" x2="3" y2="12"/>
        </svg> Connect`;
    }
}

async function logout() {
    try {
        await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: state.token }),
        });
    } catch (_) {}

    if (state.ws) {
        state.ws.close();
        state.ws = null;
    }
    if (state.wsReconnectTimer) {
        clearTimeout(state.wsReconnectTimer);
    }

    state.token = null;
    state.controlling = false;
    state.frameReceived = false;

    document.getElementById('main-view').classList.add('hidden');
    document.getElementById('login-view').classList.remove('hidden');
    document.getElementById('password-input').value = '';
    document.getElementById('password-input').focus();

    // Reset canvas
    const canvas = document.getElementById('remote-canvas');
    canvas.style.display = 'none';
    document.getElementById('no-stream').classList.remove('hidden');
}

// === Navigation ===
function navigate(page) {
    state.currentPage = page;

    // Update nav
    document.querySelectorAll('.nav-item').forEach((el) => {
        el.classList.toggle('active', el.dataset.page === page);
    });

    // Update pages
    document.querySelectorAll('.page').forEach((el) => {
        el.classList.toggle('active', el.id === page + '-page');
        el.classList.toggle('hidden', el.id !== page + '-page');
    });

    if (page === 'terminal') {
        document.getElementById('terminal-input').focus();
    }
    if (page === 'files') {
        refreshFiles();
    }
    if (page === 'settings') {
        loadDeviceInfo();
    }
}

// === WebSocket ===
function connectWebSocket() {
    if (state.ws) {
        state.ws.close();
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws`;
    state.ws = new WebSocket(wsUrl);

    state.ws.onopen = () => {
        // Authenticate
        state.ws.send(JSON.stringify({ type: 'auth', token: state.token }));
    };

    state.ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'auth_ok') {
                state.screenWidth = data.screen_width;
                state.screenHeight = data.screen_height;
                showNotification('Connected to remote desktop', 'success');
            } else if (data.type === 'frame') {
                renderFrame(data);
            } else if (data.type === 'error') {
                showNotification(data.message, 'error');
            }
        } catch (_) {}
    };

    state.ws.onclose = () => {
        // Reconnect after delay
        if (state.token) {
            state.wsReconnectTimer = setTimeout(connectWebSocket, 3000);
        }
    };

    state.ws.onerror = () => {};
}

function sendControl(data) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify(data));
    }
}

// === Screen Rendering ===
function renderFrame(data) {
    const canvas = document.getElementById('remote-canvas');
    const ctx = canvas.getContext('2d');
    const noStream = document.getElementById('no-stream');

    const img = new Image();
    img.onload = () => {
        if (!state.frameReceived) {
            state.frameReceived = true;
            canvas.style.display = 'block';
            noStream.classList.add('hidden');
            setupCanvasEvents();
        }

        // Use native image resolution for sharp rendering
        if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
        }
        ctx.drawImage(img, 0, 0);

        // Apply zoom / fit
        applyZoom();
    };
    img.src = 'data:image/jpeg;base64,' + data.data;
}

function applyZoom() {
    const canvas = document.getElementById('remote-canvas');
    const container = document.getElementById('desktop-container');
    const wrapper = document.getElementById('canvas-wrapper');
    if (!canvas.width || !canvas.height) return;

    const containerW = container.clientWidth;
    const containerH = container.clientHeight;

    let scale;
    if (state.zoom === 0) {
        // Fit to window
        const scaleW = containerW / canvas.width;
        const scaleH = containerH / canvas.height;
        scale = Math.min(scaleW, scaleH);
    } else {
        scale = state.zoom / 100;
    }

    const displayW = canvas.width * scale;
    const displayH = canvas.height * scale;

    canvas.style.width = displayW + 'px';
    canvas.style.height = displayH + 'px';

    // Center if smaller than container, otherwise allow scroll
    if (displayW <= containerW && displayH <= containerH) {
        wrapper.style.justifyContent = 'center';
        wrapper.style.alignItems = 'center';
        wrapper.style.width = '100%';
        wrapper.style.height = '100%';
    } else {
        wrapper.style.justifyContent = 'flex-start';
        wrapper.style.alignItems = 'flex-start';
        wrapper.style.width = displayW + 'px';
        wrapper.style.height = displayH + 'px';
    }

    updateZoomLabels(scale);
}

function updateZoomLabels(scale) {
    const pct = Math.round(scale * 100) + '%';
    const label = state.zoom === 0 ? 'Fit' : pct;
    const el1 = document.getElementById('zoom-label');
    const el2 = document.getElementById('fs-zoom-label');
    if (el1) el1.textContent = label;
    if (el2) el2.textContent = label;
}

// === Zoom Controls ===
const ZOOM_STEPS = [25, 50, 75, 100, 125, 150, 200, 250, 300];

function zoomIn() {
    if (state.zoom === 0) {
        // Find current fit scale, then go one step above
        const canvas = document.getElementById('remote-canvas');
        const container = document.getElementById('desktop-container');
        const fitScale = Math.min(container.clientWidth / canvas.width, container.clientHeight / canvas.height);
        const fitPct = Math.round(fitScale * 100);
        state.zoom = ZOOM_STEPS.find(z => z > fitPct) || fitPct + 25;
    } else {
        const next = ZOOM_STEPS.find(z => z > state.zoom);
        state.zoom = next || state.zoom + 25;
    }
    applyZoom();
}

function zoomOut() {
    if (state.zoom === 0) return;
    const prev = [...ZOOM_STEPS].reverse().find(z => z < state.zoom);
    if (prev) {
        state.zoom = prev;
    } else {
        state.zoom = 0; // back to fit
    }
    applyZoom();
}

function zoomFit() {
    state.zoom = 0;
    applyZoom();
    // Reset scroll position
    document.getElementById('desktop-container').scrollTo(0, 0);
}

// === Fullscreen ===
function toggleFullscreen() {
    state.isFullscreen = !state.isFullscreen;
    document.body.classList.toggle('fullscreen', state.isFullscreen);
    document.getElementById('fs-toolbar').classList.toggle('hidden', !state.isFullscreen);

    if (state.isFullscreen) {
        // Try native fullscreen
        document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
        document.exitFullscreen?.().catch(() => {});
    }

    // Re-fit after layout change
    setTimeout(() => applyZoom(), 100);
}

// Exit fullscreen on Escape
document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && state.isFullscreen) {
        state.isFullscreen = false;
        document.body.classList.remove('fullscreen');
        document.getElementById('fs-toolbar').classList.add('hidden');
        setTimeout(() => applyZoom(), 100);
    }
});

// === Canvas Events ===
let canvasEventsSetup = false;

function canvasToNormalized(e) {
    const canvas = document.getElementById('remote-canvas');
    const rect = canvas.getBoundingClientRect();
    return {
        x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
}

function touchToNormalized(touch) {
    const canvas = document.getElementById('remote-canvas');
    const rect = canvas.getBoundingClientRect();
    return {
        x: Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (touch.clientY - rect.top) / rect.height)),
    };
}

function getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function getTouchCenter(touches) {
    return {
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2,
    };
}

function setupCanvasEvents() {
    if (canvasEventsSetup) return;
    canvasEventsSetup = true;

    const canvas = document.getElementById('remote-canvas');
    const container = document.getElementById('desktop-container');

    // Mouse move (throttled)
    let lastMoveTime = 0;
    canvas.addEventListener('mousemove', (e) => {
        if (!state.controlling) return;
        const now = Date.now();
        if (now - lastMoveTime < 33) return;
        lastMoveTime = now;
        sendControl({ type: 'mouse_move', ...canvasToNormalized(e) });
    });

    let isDragging = false;
    let lastMouseDownTime = 0;
    let lastMouseDownPos = null;
    let skipNextMouseUp = false;

    canvas.addEventListener('mousedown', (e) => {
        if (!state.controlling) {
            // Enable panning when zoomed and not controlling
            if (state.zoom !== 0 && e.button === 0) {
                state.isPanning = true;
                state.panStart = { x: e.clientX, y: e.clientY };
                state.scrollStart = { x: container.scrollLeft, y: container.scrollTop };
                canvas.style.cursor = 'grabbing';
            }
            return;
        }
        e.preventDefault();
        const pos = canvasToNormalized(e);
        const btn = ['left', 'middle', 'right'][e.button] || 'left';
        const now = Date.now();

        // Detect double-click: two mousedowns within 400ms at same position
        if (btn === 'left' && now - lastMouseDownTime < 400 && lastMouseDownPos) {
            const dx = Math.abs(pos.x - lastMouseDownPos.x);
            const dy = Math.abs(pos.y - lastMouseDownPos.y);
            if (dx < 0.03 && dy < 0.03) {
                sendControl({ type: 'mouse_dblclick', ...pos });
                lastMouseDownTime = 0;
                lastMouseDownPos = null;
                isDragging = false;
                skipNextMouseUp = true;
                return;
            }
        }

        isDragging = true;
        sendControl({ type: 'mouse_down', ...pos, button: btn });
        lastMouseDownTime = now;
        lastMouseDownPos = pos;
    });

    // Panning move (when not controlling)
    document.addEventListener('mousemove', (e) => {
        if (!state.isPanning) return;
        const dx = e.clientX - state.panStart.x;
        const dy = e.clientY - state.panStart.y;
        container.scrollLeft = state.scrollStart.x - dx;
        container.scrollTop = state.scrollStart.y - dy;
    });

    document.addEventListener('mouseup', (e) => {
        if (state.isPanning) {
            state.isPanning = false;
            const cvs = document.getElementById('remote-canvas');
            cvs.style.cursor = state.controlling ? 'none' : 'default';
            return;
        }
    });

    canvas.addEventListener('mouseup', (e) => {
        if (!state.controlling) return;
        if (skipNextMouseUp) {
            skipNextMouseUp = false;
            isDragging = false;
            return;
        }
        isDragging = false;
        sendControl({
            type: 'mouse_up', ...canvasToNormalized(e),
            button: ['left', 'middle', 'right'][e.button] || 'left',
        });
    });

    // Suppress browser click/dblclick - handled via mousedown detection
    canvas.addEventListener('click', (e) => { if (state.controlling) e.preventDefault(); });
    canvas.addEventListener('dblclick', (e) => { if (state.controlling) e.preventDefault(); });

    canvas.addEventListener('wheel', (e) => {
        // Ctrl+scroll = zoom
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (e.deltaY < 0) zoomIn(); else zoomOut();
            return;
        }
        if (!state.controlling) return;
        e.preventDefault();
        sendControl({
            type: 'mouse_scroll', ...canvasToNormalized(e),
            delta: Math.sign(e.deltaY) * -3,
        });
    }, { passive: false });

    canvas.addEventListener('contextmenu', (e) => {
        if (state.controlling) e.preventDefault();
    });

    // Re-apply zoom on window resize
    window.addEventListener('resize', () => applyZoom());

    // Keyboard events on document when controlling
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    // === Touch Events (mobile/tablet) ===
    const touchState = {
        startTime: 0,
        startPos: null,
        moved: false,
        dragging: false,
        pinching: false,
        lastDist: 0,
        lastCenter: null,
        longPressTimer: null,
    };
    let lastTapTime = 0;
    let tapClickTimer = null;
    let pendingTapPos = null;

    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();

        if (e.touches.length === 1) {
            touchState.startTime = Date.now();
            touchState.startPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            touchState.moved = false;
            touchState.dragging = false;

            if (state.controlling) {
                const pos = touchToNormalized(e.touches[0]);
                sendControl({ type: 'mouse_move', ...pos });

                // Long press = right-click
                touchState.longPressTimer = setTimeout(() => {
                    if (!touchState.moved) {
                        sendControl({ type: 'mouse_click', ...pos, button: 'right' });
                        touchState.startPos = null; // Cancel tap on touchend
                    }
                }, 600);
            } else if (state.zoom !== 0) {
                // Pan when not controlling
                state.isPanning = true;
                state.panStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                state.scrollStart = { x: container.scrollLeft, y: container.scrollTop };
            }
        } else if (e.touches.length === 2) {
            clearTimeout(touchState.longPressTimer);
            touchState.pinching = true;
            touchState.dragging = false;
            touchState.lastDist = getTouchDistance(e.touches);
            touchState.lastCenter = getTouchCenter(e.touches);
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();

        if (e.touches.length === 1 && !touchState.pinching) {
            if (state.controlling && touchState.startPos) {
                const dx = Math.abs(e.touches[0].clientX - touchState.startPos.x);
                const dy = Math.abs(e.touches[0].clientY - touchState.startPos.y);

                if (dx > 8 || dy > 8) {
                    touchState.moved = true;
                    clearTimeout(touchState.longPressTimer);

                    if (!touchState.dragging) {
                        touchState.dragging = true;
                        const sp = touchToNormalized({ clientX: touchState.startPos.x, clientY: touchState.startPos.y });
                        sendControl({ type: 'mouse_down', ...sp, button: 'left' });
                    }

                    const pos = touchToNormalized(e.touches[0]);
                    sendControl({ type: 'mouse_move', ...pos });
                }
            } else if (state.isPanning) {
                const dx = e.touches[0].clientX - state.panStart.x;
                const dy = e.touches[0].clientY - state.panStart.y;
                container.scrollLeft = state.scrollStart.x - dx;
                container.scrollTop = state.scrollStart.y - dy;
            }
        } else if (e.touches.length === 2 && touchState.pinching) {
            const dist = getTouchDistance(e.touches);
            const center = getTouchCenter(e.touches);

            if (touchState.lastDist > 0) {
                const ratio = dist / touchState.lastDist;
                if (ratio > 1.08) { zoomIn(); touchState.lastDist = dist; }
                else if (ratio < 0.92) { zoomOut(); touchState.lastDist = dist; }
            }

            if (touchState.lastCenter) {
                container.scrollLeft -= (center.x - touchState.lastCenter.x);
                container.scrollTop -= (center.y - touchState.lastCenter.y);
            }
            touchState.lastCenter = center;
        }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        clearTimeout(touchState.longPressTimer);

        if (state.controlling && touchState.startPos && !touchState.pinching) {
            const touch = e.changedTouches[0];

            if (touchState.dragging) {
                const pos = touchToNormalized(touch);
                sendControl({ type: 'mouse_up', ...pos, button: 'left' });
            } else if (!touchState.moved) {
                const dt = Date.now() - touchState.startTime;
                if (dt < 500) {
                    const pos = touchToNormalized(touch);
                    const now = Date.now();
                    if (tapClickTimer && now - lastTapTime < 400) {
                        // Double-tap: cancel pending single click, send dblclick
                        clearTimeout(tapClickTimer);
                        tapClickTimer = null;
                        sendControl({ type: 'mouse_dblclick', ...pos });
                        lastTapTime = 0;
                    } else {
                        // Single tap: delay to check for double-tap
                        lastTapTime = now;
                        pendingTapPos = pos;
                        tapClickTimer = setTimeout(() => {
                            sendControl({ type: 'mouse_click', ...pendingTapPos, button: 'left' });
                            tapClickTimer = null;
                        }, 250);
                    }
                }
            }
        }

        if (state.isPanning) {
            state.isPanning = false;
        }

        touchState.startPos = null;
        touchState.dragging = false;

        if (e.touches.length === 0) {
            touchState.pinching = false;
            touchState.lastDist = 0;
            touchState.lastCenter = null;
        }
    }, { passive: false });
}

function handleKeyDown(e) {
    // Only capture when desktop page is active and controlling
    if (state.currentPage !== 'desktop' || !state.controlling) return;

    // Don't capture if focus is on an input/textarea/select
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    // Always prevent default so the browser doesn't intercept Cmd/Ctrl combos
    e.preventDefault();
    e.stopPropagation();

    // Don't send bare modifier/special keys alone
    if (['Control', 'Alt', 'Shift', 'Meta', 'Fn', 'CapsLock', 'NumLock', 'ScrollLock', 'Dead', 'Process', 'Unidentified'].includes(e.key)) return;

    // Skip auto-repeated keys
    if (e.repeat) return;

    // Use the event's own modifier flags - always accurate per-event
    const modifiers = [];
    if (e.ctrlKey) modifiers.push('ctrl');
    if (e.altKey) modifiers.push('alt');
    if (e.shiftKey) modifiers.push('shift');
    if (e.metaKey) modifiers.push('command');

    const key = KEY_MAP[e.key] || e.key.toLowerCase();

    if (modifiers.length > 0) {
        sendControl({ type: 'key_combo', keys: [...modifiers, key] });
    } else {
        sendControl({ type: 'key_press', key });
    }
}

function handleKeyUp(e) {
    // no-op
}

// === Control Toggle ===
function toggleControl() {
    state.controlling = !state.controlling;
    const btn = document.getElementById('control-toggle');
    const canvas = document.getElementById('remote-canvas');

    const fsLabel = document.getElementById('fs-control-label');
    if (state.controlling) {
        btn.classList.add('active');
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
        </svg> Control ON`;
        canvas.classList.add('controlling');
        if (fsLabel) fsLabel.textContent = 'Control ON';
        showNotification('Remote control enabled', 'info');
    } else {
        btn.classList.remove('active');
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
        </svg> Enable Control`;
        canvas.classList.remove('controlling');
        if (fsLabel) fsLabel.textContent = 'Control OFF';
    }
}

function sendKeyCombo(keys) {
    sendControl({ type: 'key_combo', keys });
    showNotification('Sent: ' + keys.join('+'), 'info');
}

// === Quick Combo Buttons ===
function sendVkCombo(keys) {
    sendControl({ type: 'key_combo', keys });
    showNotification('Sent: ' + keys.join('+'), 'info');
}

function sendTextPrompt() {
    document.getElementById('text-dialog').classList.remove('hidden');
    document.getElementById('send-text-input').value = '';
    document.getElementById('send-text-input').focus();
}

function closeTextDialog() {
    document.getElementById('text-dialog').classList.add('hidden');
}

function sendText() {
    const text = document.getElementById('send-text-input').value;
    if (text) {
        sendControl({ type: 'type_text', text });
        showNotification('Text sent', 'success');
    }
    closeTextDialog();
}

function updateQualityFromToolbar() {
    const quality = parseInt(document.getElementById('quality-select').value);
    sendControl({ type: 'stream_settings', quality });
}

// === Terminal ===
async function executeCommand(cmd) {
    const output = document.getElementById('terminal-output');

    // Show command
    const cmdDiv = document.createElement('div');
    cmdDiv.className = 'cmd-line';
    cmdDiv.textContent = '$ ' + cmd;
    output.appendChild(cmdDiv);

    try {
        const res = await fetch('/api/command', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + state.token,
            },
            body: JSON.stringify({ command: cmd, cwd: state.currentDir }),
        });

        const data = await res.json();

        if (data.stdout) {
            const stdoutDiv = document.createElement('div');
            stdoutDiv.className = 'stdout';
            stdoutDiv.textContent = data.stdout;
            output.appendChild(stdoutDiv);
        }

        if (data.stderr) {
            const stderrDiv = document.createElement('div');
            stderrDiv.className = 'stderr';
            stderrDiv.textContent = data.stderr;
            output.appendChild(stderrDiv);
        }

        // Check for cd command to update current directory
        if (cmd.trim().startsWith('cd ')) {
            const newDir = cmd.trim().slice(3).trim();
            if (data.returncode === 0) {
                // Resolve the new directory
                const resolveRes = await fetch('/api/command', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + state.token,
                    },
                    body: JSON.stringify({
                        command: `cd ${newDir} && pwd`,
                        cwd: state.currentDir,
                    }),
                });
                const resolveData = await resolveRes.json();
                if (resolveData.stdout) {
                    state.currentDir = resolveData.stdout.trim();
                }
            }
        }
    } catch (err) {
        const errDiv = document.createElement('div');
        errDiv.className = 'stderr';
        errDiv.textContent = 'Error: ' + err.message;
        output.appendChild(errDiv);
    }

    output.scrollTop = output.scrollHeight;
}

function handleTerminalKey(e) {
    const input = document.getElementById('terminal-input');

    if (e.key === 'Enter') {
        const cmd = input.value.trim();
        if (!cmd) return;

        state.commandHistory.push(cmd);
        state.historyIndex = state.commandHistory.length;
        input.value = '';

        executeCommand(cmd);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (state.historyIndex > 0) {
            state.historyIndex--;
            input.value = state.commandHistory[state.historyIndex];
        }
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (state.historyIndex < state.commandHistory.length - 1) {
            state.historyIndex++;
            input.value = state.commandHistory[state.historyIndex];
        } else {
            state.historyIndex = state.commandHistory.length;
            input.value = '';
        }
    }
}

function clearTerminal() {
    document.getElementById('terminal-output').innerHTML = '';
}

// === File Manager (FileZilla-style) ===

// Client-side staged files (File objects from browser)
const clientFiles = [];

function initFileManager() {
    const dropZone = document.getElementById('client-drop-zone');
    if (!dropZone) return;

    // Drag & drop into client pane
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('drag-active');
    });
    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-active');
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-active');
        if (e.dataTransfer.files.length > 0) {
            for (const f of e.dataTransfer.files) clientFiles.push(f);
            renderClientFiles();
        }
    });
}

function addClientFiles(event) {
    const files = event.target.files;
    if (!files) return;
    for (const f of files) clientFiles.push(f);
    event.target.value = '';
    renderClientFiles();
}

function removeClientFile(index) {
    clientFiles.splice(index, 1);
    renderClientFiles();
}

function renderClientFiles() {
    const list = document.getElementById('client-file-list');
    const zone = document.getElementById('client-drop-zone');
    const countEl = document.getElementById('client-file-count');
    const btn = document.getElementById('upload-all-btn');

    list.innerHTML = '';
    zone.classList.toggle('has-files', clientFiles.length > 0);
    countEl.textContent = clientFiles.length + ' file' + (clientFiles.length !== 1 ? 's' : '');
    btn.disabled = clientFiles.length === 0;

    clientFiles.forEach((file, i) => {
        const entry = document.createElement('div');
        entry.className = 'fz-client-entry';
        entry.draggable = true;
        entry.dataset.index = i;

        entry.innerHTML = `
            <div class="fz-name">
                <span class="fz-icon file">\u{1F4C4}</span>
                <span title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
            </div>
            <span class="fz-size">${formatBytes(file.size)}</span>
            <button class="fz-del-btn" onclick="event.stopPropagation();removeClientFile(${i})" title="Remove">\u00D7</button>
        `;

        // Drag from client to device
        entry.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', 'client:' + i);
            e.dataTransfer.effectAllowed = 'copy';
        });

        list.appendChild(entry);
    });
}

// Upload all client files to device
async function uploadAllToDevice() {
    if (clientFiles.length === 0) return;
    const log = document.getElementById('transfer-log-inner');

    for (let i = clientFiles.length - 1; i >= 0; i--) {
        const file = clientFiles[i];
        transferLog(`Uploading: ${file.name} (${formatBytes(file.size)})...`);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('path', state.currentDir);
        formData.append('token', state.token);

        try {
            const res = await fetch('/api/files/upload', { method: 'POST', body: formData });
            if (!res.ok) throw new Error('Upload failed');
            transferLog(`Uploaded: ${file.name}`, 'success');
            clientFiles.splice(i, 1);
        } catch (err) {
            transferLog(`Failed: ${file.name} - ${err.message}`, 'error');
        }
    }

    renderClientFiles();
    refreshFiles();
}

// Upload a single client file by index
async function uploadClientFile(index) {
    const file = clientFiles[index];
    if (!file) return;

    transferLog(`Uploading: ${file.name}...`);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', state.currentDir);
    formData.append('token', state.token);

    try {
        const res = await fetch('/api/files/upload', { method: 'POST', body: formData });
        if (!res.ok) throw new Error('Upload failed');
        transferLog(`Uploaded: ${file.name}`, 'success');
        clientFiles.splice(index, 1);
        renderClientFiles();
        refreshFiles();
    } catch (err) {
        transferLog(`Failed: ${file.name}`, 'error');
    }
}

// Device file browser
async function loadDirectory(path) {
    const fileList = document.getElementById('device-file-list');
    const pathInput = document.getElementById('current-path');

    fileList.innerHTML = '<div style="padding:20px;color:var(--text-dim);text-align:center;font-size:12px;">Loading...</div>';

    try {
        const res = await fetch(
            `/api/files/list?path=${encodeURIComponent(path)}&token=${encodeURIComponent(state.token)}`
        );
        if (!res.ok) throw new Error('Failed to load directory');

        const data = await res.json();
        state.currentDir = data.path;
        pathInput.value = data.path;

        const countEl = document.getElementById('device-file-count');
        countEl.textContent = data.items.length + ' items';

        if (data.items.length === 0) {
            fileList.innerHTML = '<div style="padding:20px;color:var(--text-dim);text-align:center;font-size:12px;">Empty directory</div>';
            return;
        }

        fileList.innerHTML = '';
        for (const item of data.items) {
            const entry = document.createElement('div');
            entry.className = 'fz-entry';
            entry.dataset.path = item.path;
            entry.dataset.name = item.name;
            entry.dataset.isDir = item.is_dir;

            if (!item.is_dir) {
                entry.draggable = true;
                entry.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', 'device:' + item.path);
                    e.dataTransfer.effectAllowed = 'copy';
                });
            }

            const iconClass = item.is_dir ? 'folder' : 'file';
            const iconChar = item.is_dir ? '\u{1F4C1}' : '\u{1F4C4}';
            const sizeStr = item.is_dir ? '--' : formatBytes(item.size);
            const dateStr = item.modified ? formatDate(item.modified) : '--';

            entry.innerHTML = `
                <div class="fz-name">
                    <span class="fz-icon ${iconClass}">${iconChar}</span>
                    <span title="${escapeHtml(item.path)}">${escapeHtml(item.name)}</span>
                </div>
                <span class="fz-size">${sizeStr}</span>
                <span class="fz-modified">${dateStr}</span>
                <button class="fz-del-btn" onclick="event.stopPropagation();deleteItem('${escapeAttr(item.path)}','${escapeHtml(item.name)}')" title="Delete">\u00D7</button>
            `;

            // Click to toggle selection (files), navigate (dirs)
            entry.addEventListener('click', (e) => {
                if (e.target.closest('.fz-del-btn')) return;
                if (item.is_dir) {
                    loadDirectory(item.path);
                } else {
                    entry.classList.toggle('selected');
                }
            });

            // Double-click file to download
            if (!item.is_dir) {
                entry.addEventListener('dblclick', () => downloadFile(item.path));
            }

            fileList.appendChild(entry);
        }
    } catch (err) {
        fileList.innerHTML = `<div style="padding:20px;color:var(--danger);text-align:center;font-size:12px;">${err.message}</div>`;
    }
}

// Device drag-and-drop handlers (for dropping client files onto device pane)
function deviceDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    document.getElementById('device-file-list').classList.add('drag-over');
}

function deviceDragLeave(e) {
    document.getElementById('device-file-list').classList.remove('drag-over');
}

async function deviceDrop(e) {
    e.preventDefault();
    document.getElementById('device-file-list').classList.remove('drag-over');

    // Files dragged from OS
    if (e.dataTransfer.files.length > 0) {
        for (const f of e.dataTransfer.files) clientFiles.push(f);
        renderClientFiles();
        await uploadAllToDevice();
        return;
    }

    // Files dragged from client pane
    const data = e.dataTransfer.getData('text/plain');
    if (data.startsWith('client:')) {
        const idx = parseInt(data.split(':')[1]);
        await uploadClientFile(idx);
    }
}

// Download selected device files
function downloadSelectedFromDevice() {
    const selected = document.querySelectorAll('#device-file-list .fz-entry.selected');
    if (selected.length === 0) {
        showNotification('Select files on the device side first', 'info');
        return;
    }
    selected.forEach(entry => {
        if (entry.dataset.isDir === 'true') return;
        downloadFile(entry.dataset.path);
        entry.classList.remove('selected');
    });
    transferLog(`Downloaded ${selected.length} file(s)`, 'success');
}

function navigateUp() {
    const path = document.getElementById('current-path').value;
    const parts = path.split('/');
    if (parts.length > 1) {
        parts.pop();
        loadDirectory(parts.join('/') || '/');
    }
}

function refreshFiles() {
    loadDirectory(document.getElementById('current-path').value || '~');
}

function downloadFile(path) {
    const a = document.createElement('a');
    a.href = `/api/files/download?path=${encodeURIComponent(path)}&token=${encodeURIComponent(state.token)}`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

async function deleteItem(path, name) {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
        const res = await fetch('/api/files/delete', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + state.token,
            },
            body: JSON.stringify({ path }),
        });
        if (!res.ok) throw new Error('Delete failed');
        transferLog(`Deleted: ${name}`, 'success');
        refreshFiles();
    } catch (err) {
        showNotification(`Failed to delete ${name}`, 'error');
    }
}

function transferLog(msg, type = '') {
    const log = document.getElementById('transfer-log-inner');
    const line = document.createElement('div');
    line.className = 'log-line' + (type ? ' ' + type : '');
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    line.textContent = `[${now}] ${msg}`;
    log.appendChild(line);
    log.parentElement.scrollTop = log.parentElement.scrollHeight;
}

function showMkdirDialog() {
    document.getElementById('mkdir-dialog').classList.remove('hidden');
    document.getElementById('mkdir-name').value = '';
    document.getElementById('mkdir-name').focus();
}

function closeMkdirDialog() {
    document.getElementById('mkdir-dialog').classList.add('hidden');
}

async function createDirectory() {
    const name = document.getElementById('mkdir-name').value.trim();
    if (!name) return;

    const newPath = state.currentDir + '/' + name;

    try {
        const res = await fetch('/api/files/mkdir', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + state.token,
            },
            body: JSON.stringify({ path: newPath }),
        });

        if (!res.ok) throw new Error('Failed to create folder');
        showNotification(`Created folder: ${name}`, 'success');
        closeMkdirDialog();
        refreshFiles();
    } catch (err) {
        showNotification(err.message, 'error');
    }
}

// === Settings ===
async function loadDeviceInfo() {
    try {
        const res = await fetch('/api/info', {
            headers: { 'Authorization': 'Bearer ' + state.token },
        });

        if (!res.ok) return;
        const info = await res.json();

        document.getElementById('info-device-id').textContent = info.device_id;
        document.getElementById('info-hostname').textContent = info.hostname;
        document.getElementById('info-platform').textContent = info.platform;
        document.getElementById('info-resolution').textContent = `${info.screen_width} x ${info.screen_height}`;
        document.getElementById('client-count').textContent = `${info.connected_clients} connected`;

        // Store actual password for toggle
        state._password = info.password;
        if (state.passwordVisible) {
            document.getElementById('info-password').textContent = info.password;
        }

        // Update stream settings sliders
        document.getElementById('setting-quality').value = info.quality;
        document.getElementById('quality-value').textContent = info.quality + '%';
        document.getElementById('setting-fps').value = info.fps;
        document.getElementById('fps-value').textContent = info.fps;
        document.getElementById('setting-scale').value = Math.round(info.scale * 100);
        document.getElementById('scale-value').textContent = Math.round(info.scale * 100) + '%';
    } catch (_) {}
}

function togglePasswordVisibility() {
    state.passwordVisible = !state.passwordVisible;
    const el = document.getElementById('info-password');
    const btn = document.getElementById('pw-toggle-btn');

    if (state.passwordVisible && state._password) {
        el.textContent = state._password;
        btn.textContent = 'Hide';
    } else {
        el.textContent = '\u2022\u2022\u2022\u2022\u2022\u2022';
        btn.textContent = 'Show';
    }
}

async function changePassword() {
    const input = document.getElementById('new-password');
    const newPass = input.value.trim();

    if (newPass.length < 4) {
        showNotification('Password must be at least 4 characters', 'error');
        return;
    }

    try {
        const res = await fetch('/api/settings/password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + state.token,
            },
            body: JSON.stringify({ password: newPass }),
        });

        if (!res.ok) throw new Error('Failed to change password');

        showNotification('Password updated', 'success');
        input.value = '';
        state._password = newPass;
        if (state.passwordVisible) {
            document.getElementById('info-password').textContent = newPass;
        }
    } catch (err) {
        showNotification(err.message, 'error');
    }
}

function updateSettingLabel(type) {
    if (type === 'quality') {
        document.getElementById('quality-value').textContent =
            document.getElementById('setting-quality').value + '%';
    } else if (type === 'fps') {
        document.getElementById('fps-value').textContent =
            document.getElementById('setting-fps').value;
    } else if (type === 'scale') {
        document.getElementById('scale-value').textContent =
            document.getElementById('setting-scale').value + '%';
    }
}

async function applyStreamSettings() {
    const quality = parseInt(document.getElementById('setting-quality').value);
    const fps = parseInt(document.getElementById('setting-fps').value);
    const scale = parseInt(document.getElementById('setting-scale').value) / 100;

    try {
        const res = await fetch('/api/settings/stream', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + state.token,
            },
            body: JSON.stringify({ quality, fps, scale }),
        });

        if (!res.ok) throw new Error('Failed to update');
        showNotification('Stream settings updated', 'success');
    } catch (err) {
        showNotification(err.message, 'error');
    }
}

// === Notifications ===
let notificationTimer = null;

function showNotification(message, type = 'info') {
    const el = document.getElementById('notification');
    const textEl = document.getElementById('notification-text');

    if (notificationTimer) clearTimeout(notificationTimer);

    textEl.textContent = message;
    el.className = 'notification ' + type;

    notificationTimer = setTimeout(() => {
        el.classList.add('hidden');
    }, 3000);
}

// === Utilities ===
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(isoStr) {
    try {
        const d = new Date(isoStr);
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
        return isoStr;
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function escapeAttr(str) {
    return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
