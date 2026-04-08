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

    // Try auto-login with saved session
    const savedToken = localStorage.getItem('tv_session_token');
    if (savedToken) {
        tryResumeSession(savedToken);
    } else {
        document.getElementById('password-input').focus();
    }
});

// === Auth ===
async function tryResumeSession(token) {
    try {
        const res = await fetch('/api/info', {
            headers: { 'Authorization': 'Bearer ' + token },
        });
        if (!res.ok) throw new Error('expired');

        // Token still valid — skip login
        state.token = token;
        document.getElementById('login-view').classList.add('hidden');
        document.getElementById('main-view').classList.remove('hidden');
        connectWebSocket();
        loadDeviceInfo();
        loadDirectory('~');
        initFileManager();
    } catch (_) {
        // Token expired or invalid — clear and show login
        localStorage.removeItem('tv_session_token');
        document.getElementById('password-input').focus();
    }
}

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
        localStorage.setItem('tv_session_token', data.token);
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

    localStorage.removeItem('tv_session_token');

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
        if (termState.tabs.length === 0) {
            createTerminalTab();
        } else if (termState.activeTab && termState.terminals[termState.activeTab]) {
            const active = termState.terminals[termState.activeTab];
            setTimeout(() => {
                active.fitAddon.fit();
                active.term.focus();
            }, 50);
        }
    }
    if (page === 'files') {
        refreshFiles();
    }
    if (page === 'settings') {
        loadDeviceInfo();
        renderShortcutsList();
        renderKeyMappingsList();
    }

    // Show mobile toolbar only on desktop page
    const mobileToolbar = document.getElementById('mobile-toolbar');
    if (mobileToolbar) {
        mobileToolbar.style.display = page === 'desktop' ? '' : 'none';
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
                // Request list of existing terminal sessions
                state.ws.send(JSON.stringify({ type: 'term_list' }));
            } else if (data.type === 'frame') {
                renderFrame(data);
            } else if (data.type === 'error') {
                showNotification(data.message, 'error');
            } else if (data.type && data.type.startsWith('term_')) {
                _handleTerminalWsMessage(data);
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

    canvas.addEventListener('mousedown', (e) => {
        if (!state.controlling) {
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
        isDragging = true;
        sendControl({ type: 'mouse_down', ...pos, button: btn });
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
        isDragging = false;
        sendControl({
            type: 'mouse_up', ...canvasToNormalized(e),
            button: ['left', 'middle', 'right'][e.button] || 'left',
        });
    });

    // Double-click: use browser's native dblclick event
    canvas.addEventListener('dblclick', (e) => {
        if (!state.controlling) return;
        e.preventDefault();
        // Server handles the full double-click with proper OS click counts
        sendControl({ type: 'mouse_dblclick', ...canvasToNormalized(e) });
    });

    canvas.addEventListener('click', (e) => { if (state.controlling) e.preventDefault(); });

    canvas.addEventListener('wheel', (e) => {
        // Ctrl/Cmd+scroll = zoom centered on cursor
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const containerRect = container.getBoundingClientRect();
            const contentX = e.clientX - containerRect.left + container.scrollLeft;
            const contentY = e.clientY - containerRect.top + container.scrollTop;
            const oldScale = state.zoom === 0 ?
                Math.min(container.clientWidth / canvas.width, container.clientHeight / canvas.height) :
                state.zoom / 100;

            if (e.deltaY < 0) zoomIn(); else zoomOut();

            const newScale = state.zoom === 0 ?
                Math.min(container.clientWidth / canvas.width, container.clientHeight / canvas.height) :
                state.zoom / 100;
            if (state.zoom !== 0) {
                const scaleChange = newScale / oldScale;
                container.scrollLeft = contentX * scaleChange - (e.clientX - containerRect.left);
                container.scrollTop = contentY * scaleChange - (e.clientY - containerRect.top);
            }
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

    // Release all modifiers when window loses focus or tab becomes hidden
    window.addEventListener('blur', releaseAllModifiers);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) releaseAllModifiers();
    });

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
        pinchStartZoom: 0,
        pinchStartDist: 0,
    };
    let lastTapTime = 0;
    let tapClickTimer = null;
    let pendingTapPos = null;

    function getCurrentScale() {
        const canvas = document.getElementById('remote-canvas');
        const ctr = document.getElementById('desktop-container');
        if (!canvas.width || !canvas.height) return 1;
        if (state.zoom === 0) {
            return Math.min(ctr.clientWidth / canvas.width, ctr.clientHeight / canvas.height);
        }
        return state.zoom / 100;
    }

    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();

        if (e.touches.length === 1 && !touchState.pinching) {
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
                        touchState.startPos = null;
                    }
                }, 600);
            } else if (state.zoom !== 0) {
                // Pan when not controlling and zoomed
                state.isPanning = true;
                state.panStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                state.scrollStart = { x: container.scrollLeft, y: container.scrollTop };
            }
        } else if (e.touches.length === 2) {
            clearTimeout(touchState.longPressTimer);

            // If was dragging, release mouse first
            if (touchState.dragging && state.controlling) {
                const pos = touchToNormalized(e.changedTouches[0] || e.touches[0]);
                sendControl({ type: 'mouse_up', ...pos, button: 'left' });
            }

            touchState.pinching = true;
            touchState.dragging = false;
            state.isPanning = false;
            touchState.lastDist = getTouchDistance(e.touches);
            touchState.pinchStartDist = touchState.lastDist;
            touchState.pinchStartZoom = getCurrentScale() * 100;
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

            // --- Smooth pinch zoom centered on pinch point ---
            if (touchState.pinchStartDist > 0) {
                const ratio = dist / touchState.pinchStartDist;
                const oldScale = getCurrentScale();
                const newZoom = Math.max(10, Math.min(500, Math.round(touchState.pinchStartZoom * ratio)));

                if (newZoom !== state.zoom) {
                    // Calculate pinch center in content coordinates (before zoom)
                    const containerRect = container.getBoundingClientRect();
                    const contentX = center.x - containerRect.left + container.scrollLeft;
                    const contentY = center.y - containerRect.top + container.scrollTop;

                    state.zoom = newZoom;
                    const newScale = state.zoom / 100;
                    applyZoom();

                    // Adjust scroll to keep pinch center stationary
                    const scaleChange = newScale / oldScale;
                    container.scrollLeft = contentX * scaleChange - (center.x - containerRect.left);
                    container.scrollTop = contentY * scaleChange - (center.y - containerRect.top);
                }
            }

            // --- Simultaneous two-finger pan ---
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
                        clearTimeout(tapClickTimer);
                        tapClickTimer = null;
                        sendControl({ type: 'mouse_dblclick', ...pos });
                        lastTapTime = 0;
                    } else {
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

            // Snap to fit if zoomed very close to fit level
            const canvas = document.getElementById('remote-canvas');
            if (canvas.width && canvas.height) {
                const fitScale = Math.min(container.clientWidth / canvas.width, container.clientHeight / canvas.height);
                const fitPct = Math.round(fitScale * 100);
                if (state.zoom > 0 && Math.abs(state.zoom - fitPct) < 5) {
                    state.zoom = 0;
                    applyZoom();
                    container.scrollTo(0, 0);
                }
            }
        }
    }, { passive: false });
}

// Track pressed modifiers for safety release
const _pressedModifiers = {};  // key -> timestamp

function handleKeyDown(e) {
    // Only capture when desktop page is active and controlling
    if (state.currentPage !== 'desktop' || !state.controlling) return;

    // Don't capture if focus is on an input/textarea/select
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    // Check key mappings FIRST (client shortcut → remote shortcut)
    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
        const mapping = findKeyMapping(e);
        if (mapping) {
            e.preventDefault();
            e.stopPropagation();
            for (const k in _pressedModifiers) delete _pressedModifiers[k];
            sendControl({ type: 'key_combo', keys: mapping.toKeys });
            return;
        }
    }

    // Ctrl/Cmd+V → paste from client clipboard to remote
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        e.stopPropagation();
        releaseAllModifiers();
        pasteFromClipboard();
        return;
    }

    // Let browser-level shortcuts pass through (new tab, new window, copy, etc.)
    const BROWSER_KEYS = ['t', 'n', 'w', 'r', 'l', 'c'];
    if ((e.ctrlKey || e.metaKey) && BROWSER_KEYS.includes(e.key.toLowerCase())) {
        releaseAllModifiers();
        return;
    }

    // Prevent default for everything else so keys go to remote
    e.preventDefault();
    e.stopPropagation();

    const MODIFIER_MAP = { 'Control': 'ctrl', 'Alt': 'alt', 'Shift': 'shift', 'Meta': 'command' };
    const IGNORE_KEYS = ['Fn', 'CapsLock', 'NumLock', 'ScrollLock', 'Dead', 'Process', 'Unidentified'];

    if (IGNORE_KEYS.includes(e.key)) return;

    // Send modifier key_down separately and track
    if (MODIFIER_MAP[e.key]) {
        if (!e.repeat) {
            const modKey = MODIFIER_MAP[e.key];
            _pressedModifiers[modKey] = Date.now();
            sendControl({ type: 'key_down', key: modKey });
        }
        return;
    }

    const key = KEY_MAP[e.key] || e.key.toLowerCase();

    // For repeated keys (hold), send key_down again (OS handles repeat)
    sendControl({ type: 'key_down', key });
}

function handleKeyUp(e) {
    if (state.currentPage !== 'desktop' || !state.controlling) return;

    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    e.preventDefault();
    e.stopPropagation();

    const IGNORE_KEYS = ['Fn', 'CapsLock', 'NumLock', 'ScrollLock', 'Dead', 'Process', 'Unidentified'];
    if (IGNORE_KEYS.includes(e.key)) return;

    const MODIFIER_MAP = { 'Control': 'ctrl', 'Alt': 'alt', 'Shift': 'shift', 'Meta': 'command' };
    if (MODIFIER_MAP[e.key]) {
        const modKey = MODIFIER_MAP[e.key];
        delete _pressedModifiers[modKey];
        sendControl({ type: 'key_up', key: modKey });
        return;
    }

    const key = KEY_MAP[e.key] || e.key.toLowerCase();
    sendControl({ type: 'key_up', key });
}

function releaseAllModifiers() {
    // Clear local tracking
    for (const k in _pressedModifiers) delete _pressedModifiers[k];
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ type: 'release_modifiers' }));
    }
}

// Periodic safety: release modifiers stuck for more than 3s on client side
setInterval(() => {
    if (!state.controlling) return;
    const now = Date.now();
    for (const [key, time] of Object.entries(_pressedModifiers)) {
        if (now - time > 3000) {
            delete _pressedModifiers[key];
            sendControl({ type: 'key_up', key });
        }
    }
}, 1000);

// === Control Toggle ===
function toggleControl() {
    state.controlling = !state.controlling;
    const btn = document.getElementById('control-toggle');
    const canvas = document.getElementById('remote-canvas');

    const fsLabel = document.getElementById('fs-control-label');
    const mobileBtn = document.getElementById('mobile-control-toggle');
    if (state.controlling) {
        btn.classList.add('active');
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
        </svg> <span class="btn-label">Control</span>`;
        canvas.classList.add('controlling');
        if (fsLabel) fsLabel.textContent = 'Control ON';
        if (mobileBtn) mobileBtn.classList.add('active');
        showNotification('Remote control enabled', 'info');
    } else {
        btn.classList.remove('active');
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
        </svg> <span class="btn-label">Control</span>`;
        canvas.classList.remove('controlling');
        releaseAllModifiers();
        if (fsLabel) fsLabel.textContent = 'Control OFF';
        if (mobileBtn) mobileBtn.classList.remove('active');
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

// === Quick Shortcuts ===
const DEFAULT_SHORTCUTS = [
    { keys: ['ctrl', 'd'], label: 'Ctrl+D' },
    { keys: ['command', 'd'], label: 'Cmd+D' },
    { keys: ['command', 'ctrl', 'd'], label: 'Cmd+Ctrl+D' },
    { keys: ['command', 'alt', 'd'], label: 'Cmd+Opt+D' },
    { keys: ['f11'], label: 'F11' },
];

function loadShortcuts() {
    try {
        const saved = localStorage.getItem('tv_shortcuts');
        if (saved) return JSON.parse(saved);
    } catch (_) {}
    return DEFAULT_SHORTCUTS;
}

function saveShortcuts(shortcuts) {
    localStorage.setItem('tv_shortcuts', JSON.stringify(shortcuts));
}

function shortcutLabel(keys) {
    const names = { ctrl: 'Ctrl', command: 'Cmd', alt: 'Opt', shift: 'Shift' };
    return keys.map(k => names[k] || k.charAt(0).toUpperCase() + k.slice(1)).join('+');
}

function renderToolbarShortcuts() {
    const shortcuts = loadShortcuts();
    const btnHtml = shortcuts.map(s =>
        `<button class="btn btn-sm vk-combo" onclick="sendVkCombo(${JSON.stringify(s.keys).replace(/"/g, '&quot;')})">${escapeHtml(s.label)}</button>`
    ).join('');
    // Main toolbar
    const container = document.getElementById('toolbar-shortcuts');
    if (container) container.innerHTML = btnHtml;
    // Fullscreen toolbar
    const fsContainer = document.getElementById('fs-shortcuts');
    if (fsContainer) fsContainer.innerHTML = btnHtml;
    // Mobile toolbar
    const mobileContainer = document.getElementById('mobile-shortcuts');
    if (mobileContainer) mobileContainer.innerHTML = btnHtml;
}

function renderShortcutsList() {
    const shortcuts = loadShortcuts();
    const list = document.getElementById('shortcuts-list');
    if (!list) return;
    if (shortcuts.length === 0) {
        list.innerHTML = '<span style="font-size:12px;color:var(--text-dim)">No shortcuts defined</span>';
        return;
    }
    list.innerHTML = shortcuts.map((s, i) =>
        `<span class="shortcut-tag">${escapeHtml(s.label)}<button class="sc-remove" onclick="removeShortcut(${i})">&times;</button></span>`
    ).join('');
}

function addShortcut() {
    const keyInput = document.getElementById('sc-key-input');
    const key = keyInput.value.trim().toLowerCase();
    if (!key) {
        showNotification('Enter a key', 'error');
        return;
    }

    const mods = [];
    if (document.getElementById('sc-mod-ctrl').checked) mods.push('ctrl');
    if (document.getElementById('sc-mod-command').checked) mods.push('command');
    if (document.getElementById('sc-mod-alt').checked) mods.push('alt');
    if (document.getElementById('sc-mod-shift').checked) mods.push('shift');

    const keys = [...mods, key];
    const label = shortcutLabel(keys);

    const shortcuts = loadShortcuts();
    // Prevent duplicates
    if (shortcuts.some(s => s.label === label)) {
        showNotification('Shortcut already exists', 'error');
        return;
    }

    shortcuts.push({ keys, label });
    saveShortcuts(shortcuts);

    // Reset form
    keyInput.value = '';
    document.getElementById('sc-mod-ctrl').checked = false;
    document.getElementById('sc-mod-command').checked = false;
    document.getElementById('sc-mod-alt').checked = false;
    document.getElementById('sc-mod-shift').checked = false;

    renderShortcutsList();
    renderToolbarShortcuts();
    showNotification('Shortcut added: ' + label, 'success');
}

function removeShortcut(index) {
    const shortcuts = loadShortcuts();
    const removed = shortcuts.splice(index, 1);
    saveShortcuts(shortcuts);
    renderShortcutsList();
    renderToolbarShortcuts();
    if (removed[0]) showNotification('Removed: ' + removed[0].label, 'info');
}

// === Key Mapping (Client → Remote) ===
function loadKeyMappings() {
    try {
        const saved = localStorage.getItem('tv_key_mappings');
        if (saved) return JSON.parse(saved);
    } catch (_) {}
    return [];
}

function saveKeyMappings(mappings) {
    localStorage.setItem('tv_key_mappings', JSON.stringify(mappings));
}

function _keyMappingId(e) {
    // Build a string like "ctrl+shift+a" from a keyboard event
    const parts = [];
    if (e.ctrlKey) parts.push('ctrl');
    if (e.metaKey) parts.push('command');
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');
    const key = e.key.length === 1 ? e.key.toLowerCase() : (KEY_MAP[e.key] || e.key.toLowerCase());
    if (!['control', 'alt', 'shift', 'meta'].includes(e.key.toLowerCase())) {
        parts.push(key);
    }
    return parts.join('+');
}

function findKeyMapping(e) {
    const id = _keyMappingId(e);
    const mappings = loadKeyMappings();
    return mappings.find(m => m.fromId === id) || null;
}

function renderKeyMappingsList() {
    const list = document.getElementById('keymap-list');
    if (!list) return;
    const mappings = loadKeyMappings();
    if (mappings.length === 0) {
        list.innerHTML = '<span style="font-size:12px;color:var(--text-dim)">No mappings defined</span>';
        return;
    }
    list.innerHTML = mappings.map((m, i) =>
        `<div class="keymap-row">
            <span class="shortcut-tag">${escapeHtml(m.fromLabel)}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="2" style="flex-shrink:0"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            <span class="shortcut-tag" style="color:var(--success);border-color:rgba(16,185,129,0.3)">${escapeHtml(m.toLabel)}</span>
            <button class="sc-remove" onclick="removeKeyMapping(${i})" title="Remove">&times;</button>
        </div>`
    ).join('');
}

function removeKeyMapping(index) {
    const mappings = loadKeyMappings();
    const removed = mappings.splice(index, 1);
    saveKeyMappings(mappings);
    renderKeyMappingsList();
    if (removed[0]) showNotification('Removed mapping: ' + removed[0].fromLabel + ' → ' + removed[0].toLabel, 'info');
}

// Capture a shortcut from the user pressing keys in an input
function _setupKeyCaptureInput(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('keydown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const IGNORE = ['Fn', 'CapsLock', 'NumLock', 'ScrollLock', 'Dead', 'Process', 'Unidentified'];
        if (IGNORE.includes(e.key)) return;
        // Skip if only a modifier is pressed (wait for the actual key)
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

        const parts = [];
        if (e.ctrlKey) parts.push('ctrl');
        if (e.metaKey) parts.push('command');
        if (e.altKey) parts.push('alt');
        if (e.shiftKey) parts.push('shift');
        const key = e.key.length === 1 ? e.key.toLowerCase() : (KEY_MAP[e.key] || e.key.toLowerCase());
        parts.push(key);

        input.value = parts.join('+');
        input.dataset.keys = JSON.stringify(parts);
    });
}

function addKeyMapping() {
    const fromInput = document.getElementById('keymap-from');
    const toInput = document.getElementById('keymap-to');
    const fromKeys = fromInput.dataset.keys;
    const toKeys = toInput.dataset.keys;

    if (!fromKeys || !toKeys) {
        showNotification('Press a shortcut in both fields', 'error');
        return;
    }

    const fromParts = JSON.parse(fromKeys);
    const toParts = JSON.parse(toKeys);
    const fromLabel = shortcutLabel(fromParts);
    const toLabel = shortcutLabel(toParts);
    const fromId = fromParts.join('+');

    const mappings = loadKeyMappings();
    if (mappings.some(m => m.fromId === fromId)) {
        showNotification('Mapping for ' + fromLabel + ' already exists', 'error');
        return;
    }

    mappings.push({ fromId, fromKeys: fromParts, fromLabel, toKeys: toParts, toLabel });
    saveKeyMappings(mappings);

    fromInput.value = '';
    fromInput.dataset.keys = '';
    toInput.value = '';
    toInput.dataset.keys = '';

    renderKeyMappingsList();
    showNotification('Mapping added: ' + fromLabel + ' → ' + toLabel, 'success');
}

// Init capture inputs on page load
document.addEventListener('DOMContentLoaded', () => {
    _setupKeyCaptureInput('keymap-from');
    _setupKeyCaptureInput('keymap-to');
    renderKeyMappingsList();
});

// Init shortcuts on page load
document.addEventListener('DOMContentLoaded', () => {
    renderToolbarShortcuts();
    renderShortcutsList();
});

// === Mobile On-Screen Keyboard ===
let mobileKbActive = false;
let _kbToggling = false;

function toggleMobileKeyboard() {
    const input = document.getElementById('mobile-kb-input');
    _kbToggling = true;
    mobileKbActive = !mobileKbActive;

    if (mobileKbActive) {
        input.focus();
    } else {
        input.blur();
    }

    updateKbButtons();
    setTimeout(() => { _kbToggling = false; }, 150);
}

function updateKbButtons() {
    const btn = document.getElementById('mobile-kb-btn');
    const fsBtn = document.getElementById('fs-kb-btn');
    const mobileBtn2 = document.getElementById('mobile-kb-btn2');
    if (btn) btn.classList.toggle('active', mobileKbActive);
    if (fsBtn) fsBtn.classList.toggle('active', mobileKbActive);
    if (mobileBtn2) mobileBtn2.classList.toggle('active', mobileKbActive);
}

(function initMobileKeyboard() {
    const input = document.getElementById('mobile-kb-input');
    if (!input) return;

    // Send each typed character as a key press
    input.addEventListener('input', (e) => {
        const data = e.data;
        if (data) {
            for (const ch of data) {
                sendControl({ type: 'key_press', key: ch });
            }
        }
        // Keep input empty so next keystroke is detectable
        input.value = '';
    });

    // Handle special keys (backspace, enter, arrows, etc.)
    input.addEventListener('keydown', (e) => {
        const special = KEY_MAP[e.key];
        if (special) {
            e.preventDefault();
            sendControl({ type: 'key_press', key: special });
            return;
        }
        // Let normal characters go through the 'input' event
    });

    // Detect when keyboard is dismissed externally (not via button)
    input.addEventListener('blur', () => {
        if (_kbToggling) return;
        mobileKbActive = false;
        updateKbButtons();
    });
})();

async function pasteFromClipboard() {
    // Try Clipboard API first (works on HTTPS / localhost with permission)
    if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                sendControl({ type: 'type_text', text });
                showNotification('Pasted ' + text.length + ' chars', 'success');
                return;
            }
            showNotification('Clipboard is empty', 'info');
            return;
        } catch (_) {
            // Clipboard API denied — fall through to fallback
        }
    }

    // Fallback: open Send Text dialog so user can Ctrl+V manually
    document.getElementById('text-dialog').classList.remove('hidden');
    const input = document.getElementById('send-text-input');
    input.value = '';
    input.placeholder = 'Clipboard access denied — press Ctrl+V here, then click Send';
    input.focus();
}

document.addEventListener('paste', (e) => {
    // Skip normal inputs (rename field, send text dialog, etc.)
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const text = (e.clipboardData || window.clipboardData)?.getData('text');
    if (!text) return;

    // Desktop page: send as type_text to remote
    if (state.currentPage === 'desktop' && state.controlling) {
        e.preventDefault();
        releaseAllModifiers();
        sendControl({ type: 'type_text', text });
        showNotification('Pasted ' + text.length + ' chars', 'success');
    }
});

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

// === Terminal (xterm.js + PTY) ===
const termState = {
    tabs: [],        // ordered list of session IDs
    activeTab: null, // current session ID
    terminals: {},   // session_id -> { term, fitAddon, element }
    names: {},       // session_id -> custom name (or default "Terminal N")
    tabCounter: 0,
};

function initTerminal() {
    // Nothing to init until user navigates to terminal page
}

function createTerminalTab() {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
        showNotification('Not connected', 'error');
        return;
    }
    state.ws.send(JSON.stringify({ type: 'term_create' }));
}

function _termSendInput(sessionId, text) {
    if (text && state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({
            type: 'term_input',
            session_id: sessionId,
            data: btoa(text),
        }));
    }
}

// ── Terminal image paste ──────────────────────────────────────────────────────
// How it works:
//   1. Browser intercepts paste event, detects image in clipboardData
//   2. Image is base64-encoded and sent over the existing WebSocket as
//      a "term_paste_image" control message (same WS used for PTY I/O)
//   3. Server saves image to /tmp, sets the SERVER OS clipboard via
//      osascript (macOS) / xclip / wl-copy (Linux)
//   4. Server injects \x16 (Ctrl-V) into the PTY — Claude Code's own
//      Ctrl-V handler fires, reads the OS clipboard, attaches the image
//   5. Server replies with "term_image_pasted"; client shows preview

let _pendingImagePreview = null; // { dataUrl } while awaiting server reply

async function _termPasteImage(sessionId, blob) {
    _showImagePastePreview(null, null, 'Uploading…');

    // Read blob → dataUrl (for thumbnail) and split off base64 payload
    const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(blob);
    });

    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
        _hideImagePastePreview();
        showNotification('Not connected', 'error');
        return;
    }

    // Show thumbnail immediately while server processes
    _showImagePastePreview(dataUrl, null, 'Setting remote clipboard…');
    _pendingImagePreview = { dataUrl };

    state.ws.send(JSON.stringify({
        type: 'term_paste_image',
        session_id: sessionId,
        mime: blob.type || 'image/png',
        data: dataUrl.split(',')[1],   // base64 only, no data:… prefix
    }));
}

function _showImagePastePreview(dataUrl, path, hint) {
    const panel  = document.getElementById('term-img-preview');
    const thumb  = document.getElementById('term-img-thumb');
    const pathEl = document.getElementById('term-img-path');
    const hintEl = document.getElementById('term-img-hint');
    const labelEl = document.getElementById('term-img-label');
    if (!panel) return;

    if (dataUrl) thumb.src = dataUrl;
    if (path !== null && path !== undefined) {
        pathEl.textContent = path;
        pathEl.style.display = '';
        pathEl.onclick = () => {
            navigator.clipboard?.writeText(path).catch(() => {});
            showNotification('Path copied', 'success');
        };
        if (labelEl) labelEl.textContent = 'Image saved →';
    } else {
        pathEl.style.display = 'none';
    }
    if (hint !== null && hint !== undefined && hintEl) {
        hintEl.textContent = hint;
    }

    panel.classList.remove('hidden');
    _refitAllTerminals();
}

function _hideImagePastePreview() {
    const panel = document.getElementById('term-img-preview');
    if (!panel) return;
    panel.classList.add('hidden');
    _pendingImagePreview = null;
    _refitAllTerminals();
}

function _refitAllTerminals() {
    for (const info of Object.values(termState.terminals || {})) {
        try { info.fitAddon.fit(); } catch (_) {}
    }
}

// ─────────────────────────────────────────────────────────────────────────────

function _setupTerminalInstance(sessionId, bufferData) {
    const container = document.getElementById('term-container');
    if (!container) return;

    // Create xterm.js instance
    const term = new Terminal({
        fontSize: 12,
        fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
        theme: {
            background: '#050810',
            foreground: '#f1f5f9',
            cursor: '#3b82f6',
            selectionBackground: 'rgba(59, 130, 246, 0.3)',
            black: '#1a1b26',
            red: '#f7768e',
            green: '#9ece6a',
            yellow: '#e0af68',
            blue: '#7aa2f7',
            magenta: '#bb9af7',
            cyan: '#7dcfff',
            white: '#c0caf5',
            brightBlack: '#414868',
            brightRed: '#f7768e',
            brightGreen: '#9ece6a',
            brightYellow: '#e0af68',
            brightBlue: '#7aa2f7',
            brightMagenta: '#bb9af7',
            brightCyan: '#7dcfff',
            brightWhite: '#c0caf5',
        },
        scrollback: 5000,
        cursorBlink: true,
        convertEol: false,
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);

    // Create DOM element
    const el = document.createElement('div');
    el.className = 'term-instance';
    el.dataset.sessionId = sessionId;
    container.appendChild(el);

    term.open(el);

    // Write buffer replay
    if (bufferData) {
        const bytes = Uint8Array.from(atob(bufferData), c => c.charCodeAt(0));
        term.write(bytes);
    }

    // Fit after a short delay to allow layout
    setTimeout(() => {
        fitAddon.fit();
        // Send initial size to server
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify({
                type: 'term_resize',
                session_id: sessionId,
                rows: term.rows,
                cols: term.cols,
            }));
        }
    }, 50);

    // Handle user input
    term.onData((data) => {
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify({
                type: 'term_input',
                session_id: sessionId,
                data: btoa(data),
            }));
        }
    });

    // Intercept paste on xterm's textarea BEFORE xterm handles it
    // (prevents double-paste: once by xterm via onData, once by us)
    const xtermTextarea = el.querySelector('.xterm-helper-textarea');
    if (xtermTextarea) {
        xtermTextarea.addEventListener('paste', (e) => {
            e.preventDefault();
            e.stopImmediatePropagation(); // block xterm's own paste handler

            // Check for image data first
            const items = e.clipboardData?.items || [];
            for (const item of items) {
                if (item.type.startsWith('image/')) {
                    const blob = item.getAsFile();
                    if (blob) { _termPasteImage(sessionId, blob); return; }
                }
            }

            // Fall back to text paste
            const text = (e.clipboardData || window.clipboardData)?.getData('text');
            if (text) _termSendInput(sessionId, text);
        }, true);
    }

    // Ctrl+V / Cmd+V: block xterm, let browser fire paste event on textarea
    term.attachCustomKeyEventHandler((e) => {
        if (e.type === 'keydown' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
            return false;
        }
        return true;
    });

    // Store
    termState.terminals[sessionId] = { term, fitAddon, element: el };
    termState.tabCounter++;
    if (!termState.names[sessionId]) {
        termState.names[sessionId] = 'Terminal ' + termState.tabCounter;
    }
    termState.tabs.push(sessionId);

    // Render tabs and switch
    _renderTermTabs();
    switchTerminalTab(sessionId);
}

function switchTerminalTab(sessionId) {
    termState.activeTab = sessionId;

    // Show/hide terminal instances
    for (const [sid, info] of Object.entries(termState.terminals)) {
        info.element.style.display = sid === sessionId ? '' : 'none';
    }

    // Update tab active state
    _renderTermTabs();

    // Fit the active terminal
    const active = termState.terminals[sessionId];
    if (active) {
        setTimeout(() => {
            active.fitAddon.fit();
            active.term.focus();
            if (state.ws && state.ws.readyState === WebSocket.OPEN) {
                state.ws.send(JSON.stringify({
                    type: 'term_resize',
                    session_id: sessionId,
                    rows: active.term.rows,
                    cols: active.term.cols,
                }));
            }
        }, 50);
    }
}

function closeTerminalTab(sessionId) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({
            type: 'term_close',
            session_id: sessionId,
        }));
    }
    _removeTerminalTab(sessionId);
}

function _removeTerminalTab(sessionId) {
    const info = termState.terminals[sessionId];
    if (info) {
        info.term.dispose();
        info.element.remove();
        delete termState.terminals[sessionId];
    }
    delete termState.names[sessionId];

    const idx = termState.tabs.indexOf(sessionId);
    if (idx !== -1) termState.tabs.splice(idx, 1);

    // Switch to another tab or clear
    if (termState.activeTab === sessionId) {
        if (termState.tabs.length > 0) {
            switchTerminalTab(termState.tabs[Math.min(idx, termState.tabs.length - 1)]);
        } else {
            termState.activeTab = null;
            _renderTermTabs();
        }
    } else {
        _renderTermTabs();
    }
}

let _tabClickTimer = null;

function _renderTermTabs() {
    const tabsEl = document.getElementById('term-tabs');
    if (!tabsEl) return;

    tabsEl.innerHTML = termState.tabs.map((sid) => {
        const isActive = sid === termState.activeTab;
        const name = termState.names[sid] || sid;
        return `<div class="term-tab ${isActive ? 'active' : ''}" data-sid="${sid}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;opacity:0.6">
                <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
            </svg>
            <span class="term-tab-name" data-sid="${sid}">${escapeHtml(name)}</span>
            <button class="term-tab-close" onclick="event.stopPropagation();closeTerminalTab('${sid}')" title="Close">&times;</button>
        </div>`;
    }).join('');

    // Bind click/dblclick with timer so dblclick cancels the switch
    tabsEl.querySelectorAll('.term-tab').forEach(tab => {
        const sid = tab.dataset.sid;
        tab.addEventListener('click', (e) => {
            if (e.target.closest('.term-tab-close')) return;
            clearTimeout(_tabClickTimer);
            _tabClickTimer = setTimeout(() => switchTerminalTab(sid), 200);
        });
        tab.addEventListener('dblclick', (e) => {
            if (e.target.closest('.term-tab-close')) return;
            e.stopPropagation();
            clearTimeout(_tabClickTimer);
            renameTerminalTab(sid);
        });
    });
}

function renameTerminalTab(sessionId) {
    const nameSpan = document.querySelector(`.term-tab-name[data-sid="${sessionId}"]`);
    if (!nameSpan) return;

    const currentName = termState.names[sessionId] || sessionId;
    const tab = nameSpan.closest('.term-tab');

    // Replace span with inline input
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentName;
    input.className = 'term-tab-rename';
    nameSpan.replaceWith(input);
    input.focus();
    input.select();

    function commit() {
        const newName = input.value.trim() || currentName;
        termState.names[sessionId] = newName;
        _renderTermTabs();
        // Re-focus terminal
        const active = termState.terminals[termState.activeTab];
        if (active) active.term.focus();
    }

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = currentName; input.blur(); }
        e.stopPropagation();
    });
    input.addEventListener('click', (e) => e.stopPropagation());
}

function _handleTerminalWsMessage(data) {
    switch (data.type) {
        case 'term_created': {
            _setupTerminalInstance(data.session_id, data.buffer || '');
            break;
        }
        case 'term_output': {
            const info = termState.terminals[data.session_id];
            if (info) {
                const bytes = Uint8Array.from(atob(data.data), c => c.charCodeAt(0));
                info.term.write(bytes);
            }
            break;
        }
        case 'term_closed': {
            _removeTerminalTab(data.session_id);
            break;
        }
        case 'term_list': {
            // Reconnect: subscribe to existing sessions
            if (data.sessions && data.sessions.length > 0) {
                for (const s of data.sessions) {
                    if (s.alive && !termState.terminals[s.session_id]) {
                        state.ws.send(JSON.stringify({
                            type: 'term_subscribe',
                            session_id: s.session_id,
                        }));
                    }
                }
            }
            break;
        }
        case 'term_subscribed': {
            if (!termState.terminals[data.session_id]) {
                _setupTerminalInstance(data.session_id, data.buffer || '');
            }
            break;
        }
        case 'term_image_pasted': {
            const pending = _pendingImagePreview;
            _pendingImagePreview = null;
            if (data.error) {
                _hideImagePastePreview();
                showNotification('Image paste failed: ' + data.error, 'error');
                break;
            }
            const hint = data.clipboard_ok
                ? 'Ctrl+V injected — Claude Code is attaching the image'
                : 'No clipboard tool (xclip/osascript) — path typed into terminal';
            _showImagePastePreview(pending?.dataUrl || null, data.path, hint);
            break;
        }
    }
}

// Resize terminals on window resize
window.addEventListener('resize', () => {
    if (termState.activeTab && termState.terminals[termState.activeTab]) {
        const active = termState.terminals[termState.activeTab];
        active.fitAddon.fit();
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify({
                type: 'term_resize',
                session_id: termState.activeTab,
                rows: active.term.rows,
                cols: active.term.cols,
            }));
        }
    }
});

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

// Upload a single file with XHR progress tracking
function _uploadFileWithProgress(file, onProgress) {
    return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('path', state.currentDir);
        formData.append('token', state.token);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/files/upload');

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable && onProgress) {
                onProgress(e.loaded, e.total);
            }
        });

        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error('Upload failed (HTTP ' + xhr.status + ')'));
        });
        xhr.addEventListener('error', () => reject(new Error('Network error')));
        xhr.addEventListener('abort', () => reject(new Error('Aborted')));

        xhr.send(formData);
    });
}

function _showUploadProgress(text, pct) {
    const bar = document.getElementById('upload-progress-bar');
    const textEl = document.getElementById('upload-progress-text');
    const pctEl = document.getElementById('upload-progress-pct');
    const fill = document.getElementById('upload-progress-fill');
    bar.classList.remove('hidden');
    textEl.textContent = text;
    pctEl.textContent = Math.round(pct) + '%';
    fill.style.width = pct + '%';
}

function _hideUploadProgress() {
    document.getElementById('upload-progress-bar').classList.add('hidden');
}

// Upload all client files to device
async function uploadAllToDevice() {
    if (clientFiles.length === 0) return;

    const totalFiles = clientFiles.length;
    const totalSize = clientFiles.reduce((sum, f) => sum + f.size, 0);
    let completedFiles = 0;
    let completedSize = 0;

    // Upload from last to first so splice doesn't shift indices
    for (let i = clientFiles.length - 1; i >= 0; i--) {
        const file = clientFiles[i];
        const fileNum = totalFiles - i;
        transferLog(`Uploading: ${file.name} (${formatBytes(file.size)})...`);

        try {
            await _uploadFileWithProgress(file, (loaded, total) => {
                const filePct = (loaded / total) * 100;
                const overallPct = totalSize > 0
                    ? ((completedSize + loaded) / totalSize) * 100
                    : (fileNum / totalFiles) * 100;
                _showUploadProgress(
                    `${fileNum}/${totalFiles} files — ${file.name} (${formatBytes(loaded)}/${formatBytes(total)})`,
                    overallPct
                );
            });
            completedSize += file.size;
            completedFiles++;
            transferLog(`Uploaded: ${file.name}`, 'success');
            clientFiles.splice(i, 1);
        } catch (err) {
            completedSize += file.size;
            transferLog(`Failed: ${file.name} - ${err.message}`, 'error');
        }
    }

    _showUploadProgress(`Done — ${completedFiles}/${totalFiles} files uploaded`, 100);
    setTimeout(_hideUploadProgress, 3000);
    renderClientFiles();
    refreshFiles();
}

// Upload a single client file by index
async function uploadClientFile(index) {
    const file = clientFiles[index];
    if (!file) return;

    transferLog(`Uploading: ${file.name}...`);

    try {
        await _uploadFileWithProgress(file, (loaded, total) => {
            const pct = (loaded / total) * 100;
            _showUploadProgress(
                `1/1 files — ${file.name} (${formatBytes(loaded)}/${formatBytes(total)})`,
                pct
            );
        });
        transferLog(`Uploaded: ${file.name}`, 'success');
        clientFiles.splice(index, 1);
        renderClientFiles();
        refreshFiles();
    } catch (err) {
        transferLog(`Failed: ${file.name} - ${err.message}`, 'error');
    }

    _showUploadProgress('Done', 100);
    setTimeout(_hideUploadProgress, 3000);
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
