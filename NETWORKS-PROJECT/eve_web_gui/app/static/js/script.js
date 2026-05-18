(function() {
    'use strict';

    const CONFIG = {
        NOTIFICATION_DURATION: 2500,
        CAMERA_WS_PORT: 9999,
        CAMERA_RECONNECT_DELAY: 3000,
    };

    const state = {
        gamepadId: null,
        controllerConnected: false,
        cameraWs: null,
        cameraReconnectTimer: null,
        lastFrame: null,
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
    socket.on('robot_status', function(data) {
        var ex = document.getElementById('euler-x');
        var ey = document.getElementById('euler-y');
        var ez = document.getElementById('euler-z');
        var dl = document.getElementById('diag-left-val');
        var dr = document.getElementById('diag-right-val');
        if (ex) ex.textContent = data.euler.x.toFixed(2) + '°';
        if (ey) ey.textContent = data.euler.y.toFixed(2) + '°';
        if (ez) ez.textContent = data.euler.z.toFixed(2) + '°';
        if (dl) dl.textContent = data.distance_cm[0] + ' cm';
        if (dr) dr.textContent = data.distance_cm[1] + ' cm';
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

    // ========== CLEANUP ==========
    window.addEventListener('beforeunload', function() {
        state.controllerConnected = false;
        state.gamepadId = null;
        if (state.cameraWs) state.cameraWs.close();
        socket.disconnect();
    });

    // ========== INITIALIZATION ==========
    connectCamera();

    console.log('EVE Web GUI initialized — single camera, no local webcam.');

})();
