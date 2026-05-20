/**
 * GamepadManager — browser Gamepad API → Socket.IO bridge for EVE robot.
 *
 * Each browser is identified by a canvas-fingerprint hash stored in
 * localStorage under 'eve_device_id'. The active controller-mapping
 * profile name is stored under 'eve_active_profile'.
 *
 * EVE only uses:
 *   - Left Stick (axes 0,1): Forward/Backward → linear.x, Rotate → angular.z
 *   - Shape buttons (Cross, Circle, Square, Triangle): Voice taunts
 *
 * Exposes window.GamepadManager with the same API as before.
 */
(function () {
    'use strict';

    var POLL_HZ          = 60;
    var POLL_INTERVAL_MS = 1000 / POLL_HZ;
    var LS_ID_KEY        = 'eve_device_id';
    var LS_PROFILE_KEY   = 'eve_active_profile';

    // PlayStation shape button indices (standard mapping)
    var PS_CROSS    = 0;
    var PS_CIRCLE   = 1;
    var PS_SQUARE   = 2;
    var PS_TRIANGLE = 3;

    var _rafId               = null;
    var _lastPollTime        = 0;
    var _lastAxesSnapshot    = null;
    var _lastButtonsSnapshot = null;
    var _activeIndex         = -1;
    var _onStateChange       = null;
    var _prevShapeButtons    = {};

    // ── Device identity ──────────────────────────────────────────────────────
    function _canvasFingerprint() {
        try {
            var c = document.createElement('canvas');
            c.width = 200; c.height = 50;
            var ctx = c.getContext('2d');
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = '#f0f';
            ctx.fillRect(125, 1, 62, 20);
            ctx.fillStyle = '#069';
            ctx.font = '11pt no-real-font-6119679';
            ctx.fillText('EVE.', 2, 15);
            ctx.fillStyle = 'rgba(102,204,0,0.3)';
            ctx.font = '18pt Arial';
            ctx.fillText('EVE.', 4, 45);
            return c.toDataURL();
        } catch (e) { return null; }
    }

    function _djb2(str) {
        var h = 5381;
        for (var i = 0; i < str.length; i++) h = (((h << 5) + h) ^ str.charCodeAt(i)) >>> 0;
        return h.toString(16).padStart(8, '0');
    }

    function _getDeviceId() {
        var id = localStorage.getItem(LS_ID_KEY);
        if (id) return id;
        var fp = _canvasFingerprint();
        id = fp ? ('cv-' + _djb2(fp)) : ('rn-' + _djb2(Math.random().toString() + Date.now()));
        localStorage.setItem(LS_ID_KEY, id);
        return id;
    }

    function _getActiveProfile() {
        return localStorage.getItem(LS_PROFILE_KEY) || 'Default';
    }

    function _setActiveProfile(name) {
        localStorage.setItem(LS_PROFILE_KEY, name || 'Default');
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function _getSocket() { return window._appSocket || null; }

    function _pickGamepad() {
        var pads = navigator.getGamepads ? navigator.getGamepads() : [];
        if (_activeIndex >= 0 && pads[_activeIndex] && pads[_activeIndex].connected) {
            return pads[_activeIndex];
        }
        for (var i = 0; i < pads.length; i++) {
            if (pads[i] && pads[i].connected) return pads[i];
        }
        return null;
    }

    function _snapshotEquals(a, b) {
        if (!a || !b || a.length !== b.length) return false;
        for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) return false; }
        return true;
    }

    // ── Voice taunt placeholders ─────────────────────────────────────────────
    function _triggerTaunt(buttonName) {
        console.log('[EVE] Voice taunt triggered: ' + buttonName);
        var sock = _getSocket();
        if (sock && !GamepadManager.noEmit) {
            sock.emit('trigger_taunt', { button: buttonName });
        }
    }

    function _checkShapeButtons(buttons) {
        var shapes = {
            cross:    PS_CROSS,
            circle:   PS_CIRCLE,
            square:   PS_SQUARE,
            triangle: PS_TRIANGLE,
        };

        for (var name in shapes) {
            var idx = shapes[name];
            var pressed = idx < buttons.length && buttons[idx] === 1;
            if (pressed && !_prevShapeButtons[name]) {
                _triggerTaunt(name);
            }
            _prevShapeButtons[name] = pressed;
        }
    }

    // ── Update PS Gamepad Visual Tester ───────────────────────────────────────
    function _updatePSTester(axes, buttons) {
        // Left stick
        var dot    = document.getElementById('ps-stick-dot');
        var lsX    = document.getElementById('ps-ls-x');
        var lsY    = document.getElementById('ps-ls-y');
        if (dot && axes.length >= 2) {
            var x = axes[0], y = axes[1];
            var maxR = 18; // pixels
            dot.style.transform = 'translate(' + (x * maxR) + 'px, ' + (y * maxR) + 'px)';
            dot.classList.toggle('active', Math.abs(x) > 0.1 || Math.abs(y) > 0.1);
        }
        if (lsX && axes.length >= 1) lsX.textContent = axes[0].toFixed(2);
        if (lsY && axes.length >= 2) lsY.textContent = axes[1].toFixed(2);

        // Shape buttons
        var btnMap = { cross: PS_CROSS, circle: PS_CIRCLE, square: PS_SQUARE, triangle: PS_TRIANGLE };
        for (var name in btnMap) {
            var el = document.getElementById('ps-btn-' + name);
            if (el) {
                el.classList.toggle('active', btnMap[name] < buttons.length && buttons[btnMap[name]] === 1);
            }
        }
    }

    // ── Announce already-connected gamepad ────────────────────────────────────
    function _announceExistingGamepad() {
        var pads = navigator.getGamepads ? navigator.getGamepads() : [];
        var pad = null;
        for (var i = 0; i < pads.length; i++) {
            if (pads[i] && pads[i].connected) { pad = pads[i]; break; }
        }
        if (!pad) return;
        _activeIndex = pad.index;

        function tryEmit() {
            var s = _getSocket();
            if (!s || !s.connected) return false;
            s.emit('gamepad_connected', {
                id: pad.id, index: pad.index,
                device_id: _getDeviceId(), profile_name: _getActiveProfile(),
            });
            return true;
        }

        if (!tryEmit()) {
            var attempts = 0;
            var iv = setInterval(function () {
                if (tryEmit() || ++attempts > 30) clearInterval(iv);
            }, 100);
        }
    }

    // ── Poll loop ─────────────────────────────────────────────────────────────
    function _poll(timestamp) {
        _rafId = requestAnimationFrame(_poll);
        if (timestamp - _lastPollTime < POLL_INTERVAL_MS) return;
        _lastPollTime = timestamp;

        var pad     = _pickGamepad();
        var axes    = pad ? Array.from(pad.axes).map(function(v) { return parseFloat(v.toFixed(4)); }) : [];
        var buttons = pad ? Array.from(pad.buttons).map(function(b) { return b.pressed ? 1 : 0; }) : [];

        // Update visual tester
        _updatePSTester(axes, buttons);

        // Check shape button presses for voice taunts
        if (buttons.length > 0) _checkShapeButtons(buttons);

        if (typeof _onStateChange === 'function') _onStateChange(axes, buttons, pad ? pad.id : '');

        var unchanged =
            _snapshotEquals(axes,    _lastAxesSnapshot) &&
            _snapshotEquals(buttons, _lastButtonsSnapshot);
        if (unchanged) return;

        _lastAxesSnapshot    = axes;
        _lastButtonsSnapshot = buttons;

        if (!GamepadManager.noEmit) {
            var sock = _getSocket();
            if (sock) sock.emit('gamepad_state', {
                id:      pad ? pad.id : '',
                axes:    axes,
                buttons: buttons,
            });
        }
    }

    // ── Gamepad connect / disconnect ──────────────────────────────────────────
    function _onConnect(event) {
        var pad = event.gamepad;
        _activeIndex         = pad.index;
        _lastAxesSnapshot    = null;
        _lastButtonsSnapshot = null;

        var sock = _getSocket();
        if (sock) {
            sock.emit('gamepad_connected', {
                id:           pad.id,
                index:        pad.index,
                device_id:    _getDeviceId(),
                profile_name: _getActiveProfile(),
            });
        }
        console.info('[GamepadManager] connected:', pad.id, '| device:', _getDeviceId());
    }

    function _onDisconnect(event) {
        var pad = event.gamepad;
        if (pad.index !== _activeIndex) return;
        _activeIndex         = -1;
        _lastAxesSnapshot    = null;
        _lastButtonsSnapshot = null;

        var sock = _getSocket();
        if (sock) sock.emit('gamepad_disconnected', {});
        console.info('[GamepadManager] disconnected:', pad.id);
    }

    // ── Public API ────────────────────────────────────────────────────────────
    var GamepadManager = {
        start: function() {
            if (_rafId !== null) return;
            window.addEventListener('gamepadconnected',    _onConnect);
            window.addEventListener('gamepaddisconnected', _onDisconnect);
            _rafId = requestAnimationFrame(_poll);
            _announceExistingGamepad();
        },
        stop: function() {
            if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
            window.removeEventListener('gamepadconnected',    _onConnect);
            window.removeEventListener('gamepaddisconnected', _onDisconnect);
        },
        getActiveGamepad:  function() { return _pickGamepad(); },
        getDeviceId:       function() { return _getDeviceId(); },
        getActiveProfile:  function() { return _getActiveProfile(); },
        setActiveProfile:  function(n) { _setActiveProfile(n); },
        set onStateChange(fn) { _onStateChange = typeof fn === 'function' ? fn : null; },
        get onStateChange()   { return _onStateChange; },
        noEmit:  false,
    };

    window.GamepadManager = GamepadManager;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { GamepadManager.start(); });
    } else {
        GamepadManager.start();
    }
})();
