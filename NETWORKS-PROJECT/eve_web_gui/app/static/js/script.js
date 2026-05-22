(function() {
    'use strict';

    const CONFIG = {
        NOTIFICATION_DURATION: 2500,
        CAMERA_WS_PORT: 9999,
        CAMERA_RECONNECT_DELAY: 3000,
        QR_SCAN_INTERVAL: 400,      // ms between QR scans
    };

    const state = {
        gamepadId: null,
        controllerConnected: false,
        cameraWs: null,
        cameraReconnectTimer: null,
        lastFrame: null,
        qrScanning: false,
        lastQrScanTime: 0,
        savedQrCodes: [],
    };

    const DOM = {
        notification: document.getElementById('notification'),
        notificationTitle: document.getElementById('notification-title'),
        notificationMessage: document.getElementById('notification-message'),
        controlBox: document.getElementById('control-box'),
        cameraSlot: document.getElementById('cam-0'),
        cameraCanvas: document.getElementById('feed-0'),
    };

    const socket = window._appSocket = io({ transports: ['polling'] });

    // ========== QR CODE STORAGE ==========
    function loadSavedQrCodes() {
        try {
            var raw = localStorage.getItem('eve_saved_qrcodes');
            state.savedQrCodes = raw ? JSON.parse(raw) : [];
        } catch (e) {
            state.savedQrCodes = [];
        }
        updateQrBadge();
    }

    function saveSavedQrCodes() {
        localStorage.setItem('eve_saved_qrcodes', JSON.stringify(state.savedQrCodes));
        updateQrBadge();
    }

    function updateQrBadge() {
        var badge = document.getElementById('qr-badge');
        if (!badge) return;
        var count = state.savedQrCodes.length;
        badge.textContent = count;
        badge.style.display = count > 0 ? 'flex' : 'none';
    }

    function addQrCode(data) {
        // Check for duplicates (same data within last 5 seconds)
        var now = Date.now();
        for (var i = 0; i < state.savedQrCodes.length; i++) {
            if (state.savedQrCodes[i].data === data) {
                var elapsed = now - state.savedQrCodes[i].timestamp;
                if (elapsed < 5000) return; // Ignore rapid re-scans of same code
                // Update the timestamp of existing code
                state.savedQrCodes[i].timestamp = now;
                state.savedQrCodes[i].date = new Date(now).toLocaleString();
                saveSavedQrCodes();
                notify('QR Code', 'Updated: ' + data.substring(0, 60), 'success');
                renderQrList();
                return;
            }
        }
        // Add new QR code
        state.savedQrCodes.unshift({
            data: data,
            timestamp: now,
            date: new Date(now).toLocaleString(),
        });
        saveSavedQrCodes();
        notify('QR Code Detected', data.substring(0, 80), 'success');
        renderQrList();
    }

    function deleteQrCode(index) {
        state.savedQrCodes.splice(index, 1);
        saveSavedQrCodes();
        renderQrList();
    }

    function renderQrList() {
        var list = document.getElementById('qr-list');
        if (!list) return;
        if (state.savedQrCodes.length === 0) {
            list.innerHTML = '<div class="qr-empty">No QR codes scanned yet.<br>Point a QR code at the robot camera to scan.</div>';
            return;
        }
        var html = '';
        for (var i = 0; i < state.savedQrCodes.length; i++) {
            var item = state.savedQrCodes[i];
            var escaped = item.data.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
            var isUrl = /^https?:\/\//i.test(item.data);
            html += '<div class="qr-item">';
            html += '  <div class="qr-item-content">';
            if (isUrl) {
                html += '    <a class="qr-item-data qr-link" href="' + escaped + '" target="_blank" rel="noopener">' + escaped + '</a>';
            } else {
                html += '    <span class="qr-item-data">' + escaped + '</span>';
            }
            html += '    <span class="qr-item-date">' + item.date + '</span>';
            html += '  </div>';
            html += '  <div class="qr-item-actions">';
            html += '    <button class="qr-copy-btn" data-idx="' + i + '" title="Copy">&#128203;</button>';
            html += '    <button class="qr-del-btn" data-idx="' + i + '" title="Delete">&times;</button>';
            html += '  </div>';
            html += '</div>';
        }
        list.innerHTML = html;

        // Attach event listeners
        var delBtns = list.querySelectorAll('.qr-del-btn');
        for (var d = 0; d < delBtns.length; d++) {
            delBtns[d].addEventListener('click', function() {
                deleteQrCode(parseInt(this.getAttribute('data-idx')));
            });
        }
        var copyBtns = list.querySelectorAll('.qr-copy-btn');
        for (var c = 0; c < copyBtns.length; c++) {
            copyBtns[c].addEventListener('click', function() {
                var idx = parseInt(this.getAttribute('data-idx'));
                var text = state.savedQrCodes[idx].data;
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(function() {
                        notify('Copied', 'QR code copied to clipboard', 'success');
                    });
                } else {
                    // Fallback
                    var ta = document.createElement('textarea');
                    ta.value = text;
                    ta.style.position = 'fixed';
                    ta.style.left = '-9999px';
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    notify('Copied', 'QR code copied to clipboard', 'success');
                }
            });
        }
    }

    // ========== QR CODE SCANNER ==========
    function scanForQrCode() {
        if (!DOM.cameraCanvas) return;
        if (!window.jsQR) return;
        var now = Date.now();
        if (now - state.lastQrScanTime < CONFIG.QR_SCAN_INTERVAL) return;
        state.lastQrScanTime = now;

        try {
            var w = DOM.cameraCanvas.width;
            var h = DOM.cameraCanvas.height;
            if (w < 10 || h < 10) return; // No valid frame yet
            var ctx = DOM.cameraCanvas.getContext('2d');
            var imageData = ctx.getImageData(0, 0, w, h);
            var code = jsQR(imageData.data, w, h, { inversionAttempts: 'dontInvert' });
            if (code && code.data) {
                addQrCode(code.data);
            }
        } catch (e) {
            // Silently ignore scan errors (e.g. tainted canvas on cross-origin)
        }
    }

    // ========== UTILITIES ==========
    function notify(title, message, type) {
        type = type || 'error';
        DOM.notificationTitle.textContent = title;
        DOM.notificationMessage.textContent = message;
        DOM.notification.classList.remove('error', 'success');
        DOM.notification.classList.add(type, 'show');
        setTimeout(function() { DOM.notification.classList.remove('show'); }, CONFIG.NOTIFICATION_DURATION);
    }

    // ========== SOCKET EVENT HANDLERS ==========
    socket.on('connect', function() {
        socket.emit('get_mapping', {
            device_id:    window.GamepadManager ? window.GamepadManager.getDeviceId() : '',
            profile_name: window.GamepadManager ? (window.GamepadManager.getActiveProfile() || 'Default') : 'Default',
        });
    });

    socket.on('mapping', function(data) {
        window._eveMapping = data;
    });

    socket.on('notification', function(data) {
        notify(
            data.success ? 'Success' : 'Error ' + data.error_code,
            data.message,
            data.success ? 'success' : 'error'
        );
    });

    socket.on('controller_status', function(data) {
        var wasConnected = state.controllerConnected;
        state.controllerConnected = !!data.connected;
        state.gamepadId = data.name || null;

        DOM.controlBox.classList.toggle('connected', state.controllerConnected);

        if (state.controllerConnected && (!wasConnected || state.gamepadId !== data.name)) {
            notify('Controller', data.name || 'Connected', 'success');
        } else if (!state.controllerConnected && wasConnected) {
            notify('Controller', 'Disconnected', 'error');
        }
    });

    // Live robot status → diagnostics panel
    // distance_cm is [left, right] (uint8[2] from the ROS msg)
    // Front and Back ultrasonics are not wired — keep them as em-dash
    socket.on('robot_status', function(data) {
        var ex = document.getElementById('euler-x');
        var ey = document.getElementById('euler-y');
        var ez = document.getElementById('euler-z');
        var dl = document.getElementById('diag-left-val');
        var dr = document.getElementById('diag-right-val');
        if (ex) ex.textContent = data.euler.x.toFixed(2) + '°';
        if (ey) ey.textContent = data.euler.y.toFixed(2) + '°';
        if (ez) ez.textContent = data.euler.z.toFixed(2) + '°';
        if (dl && data.distance_cm.length > 0) dl.textContent = data.distance_cm[0] + ' cm';
        if (dr && data.distance_cm.length > 1) dr.textContent = data.distance_cm[1] + ' cm';
    });

    socket.on('disconnect', function() {
        state.controllerConnected = false;
        state.gamepadId = null;
        DOM.controlBox.classList.remove('connected');
    });

    // ========== KEYBOARD SHORTCUTS ==========
    document.addEventListener('keydown', function(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'f' || e.key === 'F') {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen();
            } else {
                document.exitFullscreen();
            }
        }
    });

    // ========== SINGLE CAMERA STREAM ==========
    function drawFrameToCanvas(canvas, jpegBytes) {
        var blob = new Blob([jpegBytes], { type: 'image/jpeg' });
        return createImageBitmap(blob).then(function(bitmap) {
            canvas.width  = bitmap.width;
            canvas.height = bitmap.height;
            canvas.getContext('2d').drawImage(bitmap, 0, 0);
            bitmap.close();
        });
    }

    function connectCamera() {
        var wsUrl = 'ws://' + window.location.hostname + ':' + CONFIG.CAMERA_WS_PORT;
        try {
            state.cameraWs = new WebSocket(wsUrl);
            state.cameraWs.binaryType = 'arraybuffer';

            state.cameraWs.onopen = function() {
                notify('Camera', 'Stream connected', 'success');
                if (state.cameraReconnectTimer) {
                    clearTimeout(state.cameraReconnectTimer);
                    state.cameraReconnectTimer = null;
                }
            };

            state.cameraWs.onclose = function() {
                state.lastFrame = null;
                if (DOM.cameraSlot) {
                    DOM.cameraSlot.classList.remove('online');
                    DOM.cameraSlot.classList.add('offline');
                }
                scheduleCameraReconnect();
            };

            state.cameraWs.onerror = function(err) { console.error('Camera error:', err); };

            state.cameraWs.onmessage = function(e) {
                if (!(e.data instanceof ArrayBuffer)) return;
                var buf = e.data;
                var view = new DataView(buf);
                var offset = 0;
                var numCams = view.getUint8(offset++);
                if (numCams < 1) return;

                // Only use the first camera
                var camId = view.getUint8(offset++);
                var jpegSize = view.getUint32(offset, true); offset += 4;
                var jpegBytes = new Uint8Array(buf, offset, jpegSize);
                state.lastFrame = jpegBytes;

                if (DOM.cameraCanvas) {
                    drawFrameToCanvas(DOM.cameraCanvas, jpegBytes).then(function() {
                        DOM.cameraSlot.classList.add('online');
                        DOM.cameraSlot.classList.remove('offline');
                        // Run QR scan after every frame render (throttled internally)
                        scanForQrCode();
                    }).catch(function() {});
                }
            };
        } catch (err) {
            console.error('Camera connection failed:', err);
            scheduleCameraReconnect();
        }
    }

    function scheduleCameraReconnect() {
        if (state.cameraReconnectTimer) return;
        state.cameraReconnectTimer = setTimeout(function() {
            state.cameraReconnectTimer = null;
            connectCamera();
        }, CONFIG.CAMERA_RECONNECT_DELAY);
    }

    // ========== QR OVERLAY MANAGEMENT ==========
    function initQrOverlay() {
        var openBtn = document.getElementById('qr-open-btn');
        var overlay = document.getElementById('qrcode-overlay');
        var closeBtn = document.getElementById('qr-panel-close');
        var clearBtn = document.getElementById('qr-clear-all');

        if (openBtn) openBtn.addEventListener('click', function() {
            if (overlay) { overlay.classList.add('open'); renderQrList(); }
        });
        if (closeBtn) closeBtn.addEventListener('click', function() {
            if (overlay) overlay.classList.remove('open');
        });
        if (overlay) overlay.addEventListener('click', function(e) {
            if (e.target === overlay) overlay.classList.remove('open');
        });
        if (clearBtn) clearBtn.addEventListener('click', function() {
            state.savedQrCodes = [];
            saveSavedQrCodes();
            renderQrList();
        });
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && overlay && overlay.classList.contains('open')) {
                overlay.classList.remove('open');
            }
        });
    }

    // ========== CLEANUP ==========
    window.addEventListener('beforeunload', function() {
        state.controllerConnected = false;
        state.gamepadId = null;
        if (state.cameraWs) state.cameraWs.close();
        socket.disconnect();
    });

    // ========== INITIALIZATION ==========
    loadSavedQrCodes();
    initQrOverlay();
    renderQrList();
    connectCamera();

    console.log('EVE Web GUI initialized — single camera, QR scanner active.');

})();

