(function () {
    'use strict';

    // EVE only uses forward + turn axes
    var MOTION_AXES = ['forward', 'turn'];

    var ACTION_LABELS = {
        forward:  'Forward',
        turn:     'Turn',
        cross:    'Cross (✕)',
        circle:   'Circle (◯)',
        square:   'Square (◻)',
        triangle: 'Triangle (△)',
    };

    // ── Socket ───────────────────────────────────────────────────────────────
    var socket = window._appSocket || (window._appSocket = io({ transports: ['polling'] }));

    // ── State ────────────────────────────────────────────────────────────────
    var currentMapping = null;
    var learnTarget    = null;

    // ── Compute motion output from raw gamepad + mapping ─────────────────────
    function computeMotion(axisName, axes, buttons, mapping) {
        if (!mapping) return 0;
        var cfg      = (mapping.axes || {})[axisName] || {};
        var source   = cfg.source || 'axis';
        var deadzone = mapping.deadzone || 0.1;
        var invert   = cfg.invert || false;
        var val = 0;

        if (source === 'buttons') {
            var posIdx = cfg.pos != null ? cfg.pos : -1;
            var negIdx = cfg.neg != null ? cfg.neg : -1;
            var pos = posIdx >= 0 && posIdx < buttons.length ? buttons[posIdx] : 0;
            var neg = negIdx >= 0 && negIdx < buttons.length ? buttons[negIdx] : 0;
            val = (pos ? 1.0 : 0.0) - (neg ? 1.0 : 0.0);
        } else {
            var idx = cfg.index != null ? cfg.index : -1;
            if (idx >= 0 && idx < axes.length) {
                val = axes[idx];
                if (Math.abs(val) < deadzone) val = 0;
            }
        }

        var gpVal = invert ? -val : val;
        return Math.max(-1, Math.min(1, gpVal));
    }

    // ── Motion output display ────────────────────────────────────────────────
    function updateMotionDisplay(axes, buttons) {
        MOTION_AXES.forEach(function(name) {
            var v    = computeMotion(name, axes, buttons, currentMapping);
            var bar  = document.getElementById('motion-bar-' + name);
            var val  = document.getElementById('motion-val-' + name);
            if (!bar || !val) return;

            if (v >= 0) {
                bar.style.left  = '50%';
                bar.style.width = (v * 50) + '%';
                bar.classList.remove('negative');
            } else {
                var w = Math.abs(v) * 50;
                bar.style.left  = (50 - w) + '%';
                bar.style.width = w + '%';
                bar.classList.add('negative');
            }

            val.textContent = v.toFixed(4);
            val.style.color = Math.abs(v) > 0.01 ? (v > 0 ? 'var(--blue)' : 'var(--orange)') : 'var(--text-muted)';
        });
    }

    // ── Active commands chips ─────────────────────────────────────────────────
    function buildActionChips() {
        var container = document.getElementById('active-actions');
        if (!container || !currentMapping) return;
        container.innerHTML = '';

        MOTION_AXES.forEach(function(name) {
            var chip = document.createElement('div');
            chip.className    = 'action-chip axis-chip';
            chip.dataset.action = name;
            chip.textContent  = ACTION_LABELS[name] || name;
            container.appendChild(chip);
        });

        var sep = document.createElement('div');
        sep.className = 'action-chip-sep';
        container.appendChild(sep);

        var btnActions = ['cross', 'circle', 'square', 'triangle'];
        btnActions.forEach(function(name) {
            var chip = document.createElement('div');
            chip.className    = 'action-chip btn-chip';
            chip.dataset.action = name;
            chip.textContent  = ACTION_LABELS[name] || name;
            container.appendChild(chip);
        });
    }

    function updateActiveActions(axes, buttons) {
        var container = document.getElementById('active-actions');
        if (!container || !currentMapping) return;

        MOTION_AXES.forEach(function(name) {
            var chip = container.querySelector('[data-action="' + name + '"]');
            if (!chip) return;
            var val = computeMotion(name, axes, buttons, currentMapping);
            chip.classList.toggle('active', Math.abs(val) > 0);
        });

        // PS shape buttons (standard mapping indices)
        var btnMap = { cross: 0, circle: 1, square: 2, triangle: 3 };
        for (var name in btnMap) {
            var chip = container.querySelector('[data-action="' + name + '"]');
            if (!chip) continue;
            chip.classList.toggle('active', btnMap[name] < buttons.length && buttons[btnMap[name]] === 1);
        }
    }

    // ── Raw axis table ───────────────────────────────────────────────────────
    function buildAxisTable(axes) {
        var tbody = document.getElementById('axis-table-body');
        if (!tbody) return;
        if (tbody.children.length !== axes.length) {
            tbody.innerHTML = '';
            axes.forEach(function(_, i) {
                var tr = document.createElement('tr');
                tr.innerHTML =
                    '<td class="axis-idx">' + i + '</td>' +
                    '<td><div class="axis-bar-wrap">' +
                        '<div class="axis-bar-fill" id="raw-bar-' + i + '"></div>' +
                        '<div class="axis-bar-center"></div>' +
                    '</div></td>' +
                    '<td class="axis-raw-val" id="raw-val-' + i + '">0.0000</td>';
                tbody.appendChild(tr);
            });
        }
        axes.forEach(function(v, i) {
            var fill = document.getElementById('raw-bar-' + i);
            var cell = document.getElementById('raw-val-' + i);
            if (!fill || !cell) return;
            fill.style.left  = v >= 0 ? '50%'            : ((v + 1) / 2 * 100) + '%';
            fill.style.width = v >= 0 ? (v * 50) + '%'   : (Math.abs(v) * 50) + '%';
            cell.textContent = v.toFixed(4);
            cell.style.color = Math.abs(v) > 0.02 ? 'var(--text-primary)' : 'var(--text-muted)';
        });
    }

    // ── Button grid ──────────────────────────────────────────────────────────
    function buildButtonGrid(buttons) {
        var grid = document.getElementById('btn-grid');
        if (!grid) return;
        if (grid.children.length !== buttons.length) {
            grid.innerHTML = '';
            buttons.forEach(function(_, i) {
                var d = document.createElement('div');
                d.className = 'btn-cell';
                d.id = 'btn-cell-' + i;
                d.textContent = i;
                grid.appendChild(d);
            });
        }
        buttons.forEach(function(v, i) {
            var cell = document.getElementById('btn-cell-' + i);
            if (cell) cell.classList.toggle('pressed', v === 1);
        });
    }

    // ── GamepadManager callback ──────────────────────────────────────────────
    if (window.GamepadManager) {
        GamepadManager.onStateChange = function(axes, buttons, id) {
            updateMotionDisplay(axes, buttons);
            updateActiveActions(axes, buttons);
            buildAxisTable(axes);
            buildButtonGrid(buttons);
            processLearnInput(axes, buttons);
        };

        GamepadManager.start();
    }

    // ── Controller status ────────────────────────────────────────────────────
    var banner     = document.getElementById('gp-status-banner');
    var bannerName = document.getElementById('gp-status-name');

    socket.on('controller_status', function(data) {
        if (!banner || !bannerName) return;
        banner.className = 'status-banner ' + (data.connected ? 'connected' : 'disconnected');
        bannerName.textContent = data.connected ? (data.name || 'Unknown controller') : 'No controller connected';
    });

    // ── Mapping ──────────────────────────────────────────────────────────────
    socket.on('mapping', function(data) {
        currentMapping = data;
        window._eveMapping = data;
        populateMappingForm(data);
        buildActionChips();
    });

    socket.on('mapping_saved', function(data) {
        setStatus(data.ok ? 'Mapping saved.' : 'Save failed: ' + (data.error || '?'), data.ok ? 'ok' : 'error');
    });

    // ── Profile list ─────────────────────────────────────────────────────────
    socket.on('profiles_list', function(data) {
        var profiles = data.profiles || [];
        var sel = document.getElementById('profile-select');
        if (!sel) return;
        var current = activeProfile();
        sel.innerHTML = '';
        profiles.forEach(function(name) {
            var opt = document.createElement('option');
            opt.value = opt.textContent = name;
            if (name === current) opt.selected = true;
            sel.appendChild(opt);
        });
        if (sel.value && sel.value !== current) {
            window.GamepadManager && window.GamepadManager.setActiveProfile(sel.value);
        }
    });

    // ── Device info + profile init ───────────────────────────────────────────
    (function initDeviceInfo() {
        var gm = window.GamepadManager;
        if (!gm) return;

        var idEl  = document.getElementById('device-id-display');
        var selEl = document.getElementById('profile-select');
        var newEl = document.getElementById('profile-new');
        var delEl = document.getElementById('profile-delete');

        var deviceId = gm.getDeviceId();
        if (idEl) idEl.textContent = deviceId;

        socket.emit('get_profiles', { device_id: deviceId });
        socket.emit('get_mapping', { device_id: deviceId, profile_name: activeProfile() });

        if (selEl) {
            selEl.addEventListener('change', function() {
                var name = selEl.value;
                window.GamepadManager && window.GamepadManager.setActiveProfile(name);
                socket.emit('get_mapping', { device_id: deviceId, profile_name: name });
            });
        }

        if (newEl) {
            newEl.addEventListener('click', function() {
                var name = prompt('New profile name:');
                if (!name || !name.trim()) return;
                socket.emit('create_profile', {
                    device_id:    deviceId,
                    profile_name: name.trim(),
                    copy_from:    activeProfile(),
                });
                socket.once('profiles_list', function() {
                    var sel = document.getElementById('profile-select');
                    if (sel && sel.querySelector('option[value="' + CSS.escape(name.trim()) + '"]')) {
                        window.GamepadManager && window.GamepadManager.setActiveProfile(name.trim());
                        sel.value = name.trim();
                        socket.emit('get_mapping', { device_id: deviceId, profile_name: name.trim() });
                    }
                });
            });
        }

        if (delEl) {
            delEl.addEventListener('click', function() {
                var current = activeProfile();
                if (!confirm('Delete profile "' + current + '"?')) return;
                socket.emit('delete_profile', { device_id: deviceId, profile_name: current });
                socket.once('profiles_list', function(data) {
                    var first = (data.profiles || ['Default'])[0];
                    window.GamepadManager && window.GamepadManager.setActiveProfile(first);
                    socket.emit('get_mapping', { device_id: deviceId, profile_name: first });
                });
            });
        }
    })();

    // ── Source select change ──────────────────────────────────────────────────
    function applySourceToRow(row, source) {
        row.dataset.source = source;
    }

    document.querySelectorAll('.source-select').forEach(function(sel) {
        sel.addEventListener('change', function() {
            applySourceToRow(this.closest('tr'), this.value);
        });
    });

    function applyBtnSourceToRow(row, source) {
        row.dataset.btnSource = source;
    }

    document.querySelectorAll('.btn-src-select').forEach(function(sel) {
        sel.addEventListener('change', function() {
            applyBtnSourceToRow(this.closest('tr'), this.value);
        });
    });

    // ── Populate form from mapping ───────────────────────────────────────────
    function populateMappingForm(mapping) {
        if (!mapping) return;

        var dz = document.getElementById('deadzone-input');
        if (dz) dz.value = mapping.deadzone != null ? mapping.deadzone : 0.1;

        Object.entries(mapping.axes || {}).forEach(function(entry) {
            var name = entry[0], cfg = entry[1];
            var row = document.querySelector('[data-axis-name="' + name + '"]');
            if (!row) return;
            var source = cfg.source || 'axis';
            var sel    = row.querySelector('.source-select');
            if (sel) sel.value = source;
            applySourceToRow(row, source);

            if (source === 'axis') {
                var idx = row.querySelector('.axis-index-input');
                if (idx) idx.value = cfg.index != null ? cfg.index : -1;
            } else {
                var pos = row.querySelector('.axis-pos-input');
                var neg = row.querySelector('.axis-neg-input');
                if (pos) pos.value = cfg.pos != null ? cfg.pos : -1;
                if (neg) neg.value = cfg.neg != null ? cfg.neg : -1;
            }
            var inv = row.querySelector('.axis-invert-check');
            if (inv) inv.checked = cfg.invert || false;
        });

        Object.entries(mapping.buttons || {}).forEach(function(entry) {
            var name = entry[0], cfg = entry[1];
            var row = document.querySelector('[data-btn-name="' + name + '"]');
            if (!row) return;
            if (typeof cfg === 'object' && cfg !== null && cfg.source === 'axis') {
                var srcSel = row.querySelector('.btn-src-select');
                if (srcSel) { srcSel.value = 'axis'; applyBtnSourceToRow(row, 'axis'); }
                var idxEl = row.querySelector('.btn-axis-index-input');
                var thrEl = row.querySelector('.btn-threshold-input');
                var dirEl = row.querySelector('.btn-direction-select');
                if (idxEl) idxEl.value = cfg.index != null ? cfg.index : -1;
                if (thrEl) thrEl.value = cfg.threshold != null ? cfg.threshold : 0.5;
                if (dirEl) dirEl.value = cfg.direction || 'positive';
            } else {
                var srcSel = row.querySelector('.btn-src-select');
                if (srcSel) { srcSel.value = 'button'; applyBtnSourceToRow(row, 'button'); }
                var input = row.querySelector('.btn-index-input');
                if (input) input.value = typeof cfg === 'number' ? cfg : -1;
            }
        });
    }

    // ── Collect form → mapping object ────────────────────────────────────────
    function collectMapping() {
        var dz = document.getElementById('deadzone-input');
        var mapping = {
            deadzone: parseFloat(dz ? dz.value : 0.1) || 0.1,
            axes:    {},
            buttons: {},
            keyboard: {},
        };

        document.querySelectorAll('[data-axis-name]').forEach(function(row) {
            var name   = row.dataset.axisName;
            var source = (row.querySelector('.source-select') || {}).value || 'axis';
            var invert = row.querySelector('.axis-invert-check') ? row.querySelector('.axis-invert-check').checked : false;

            if (source === 'axis') {
                var idxEl = row.querySelector('.axis-index-input');
                mapping.axes[name] = { source: 'axis', index: parseInt(idxEl ? idxEl.value : -1, 10), invert: invert };
            } else {
                var posEl = row.querySelector('.axis-pos-input');
                var negEl = row.querySelector('.axis-neg-input');
                mapping.axes[name] = {
                    source: 'buttons',
                    pos: parseInt(posEl ? posEl.value : -1, 10),
                    neg: parseInt(negEl ? negEl.value : -1, 10),
                    invert: invert,
                };
            }
        });

        document.querySelectorAll('[data-btn-name]').forEach(function(row) {
            var name   = row.dataset.btnName;
            var srcSel = row.querySelector('.btn-src-select');
            var src    = srcSel ? srcSel.value : 'button';
            if (src === 'axis') {
                var idxEl = row.querySelector('.btn-axis-index-input');
                var thrEl = row.querySelector('.btn-threshold-input');
                var dirEl = row.querySelector('.btn-direction-select');
                mapping.buttons[name] = {
                    source:    'axis',
                    index:     parseInt(idxEl ? idxEl.value : -1, 10),
                    threshold: parseFloat(thrEl ? thrEl.value : 0.5),
                    direction: dirEl ? dirEl.value : 'positive',
                };
            } else {
                var idxEl = row.querySelector('.btn-index-input');
                mapping.buttons[name] = parseInt(idxEl ? idxEl.value : -1, 10);
            }
        });

        return mapping;
    }

    // ── Save / Reset ─────────────────────────────────────────────────────────
    var saveBtn  = document.getElementById('save-mapping-btn');
    var resetBtn = document.getElementById('reset-mapping-btn');

    function deviceId() {
        return window.GamepadManager ? window.GamepadManager.getDeviceId() : '';
    }

    function activeProfile() {
        return window.GamepadManager ? (window.GamepadManager.getActiveProfile() || 'Default') : 'Default';
    }

    if (saveBtn) saveBtn.addEventListener('click', function() {
        socket.emit('save_mapping', {
            device_id:    deviceId(),
            profile_name: activeProfile(),
            mapping:      collectMapping(),
        });
    });

    if (resetBtn) resetBtn.addEventListener('click', function() {
        if (!confirm('Reset "' + activeProfile() + '" to factory defaults?')) return;
        socket.emit('delete_profile', { device_id: deviceId(), profile_name: activeProfile() });
        setTimeout(function() {
            window.GamepadManager && window.GamepadManager.setActiveProfile('Default');
            socket.emit('get_mapping', { device_id: deviceId(), profile_name: 'Default' });
        }, 300);
    });

    // ── Learn mode ───────────────────────────────────────────────────────────
    function enterLearnMode(type, name, row, btn) {
        cancelLearnMode();
        learnTarget = { type: type, name: name, el: row, learnBtn: btn };
        row.classList.add('learning');
        if (btn) btn.classList.add('active');
        var labels = { axis: 'Move a stick axis…', 'btn-pos': 'Press the + button…', 'btn-neg': 'Press the − button…', button: 'Press a button…', 'btn-axis': 'Move a trigger/axis…' };
        setStatus(labels[type] || 'Press input…', 'info');
    }

    function cancelLearnMode() {
        if (!learnTarget) return;
        if (learnTarget.el)      learnTarget.el.classList.remove('learning');
        if (learnTarget.learnBtn) learnTarget.learnBtn.classList.remove('active');
        learnTarget = null;
    }

    function processLearnInput(axes, buttons) {
        if (!learnTarget) return;

        if (learnTarget.type === 'axis') {
            var maxVal = 0.3, maxIdx = -1;
            axes.forEach(function(v, i) { if (Math.abs(v) > maxVal) { maxVal = Math.abs(v); maxIdx = i; } });
            if (maxIdx < 0) return;
            var inp = learnTarget.el.querySelector('.axis-index-input');
            if (inp) inp.value = maxIdx;
            setStatus('Axis ' + maxIdx + ' → ' + learnTarget.name, 'ok');
            cancelLearnMode();

        } else if (learnTarget.type === 'btn-pos' || learnTarget.type === 'btn-neg') {
            var idx = buttons.findIndex(function(b) { return b === 1; });
            if (idx < 0) return;
            var cls = learnTarget.type === 'btn-pos' ? '.axis-pos-input' : '.axis-neg-input';
            var inp = learnTarget.el.querySelector(cls);
            if (inp) inp.value = idx;
            var label = learnTarget.type === 'btn-pos' ? '+' : '−';
            setStatus('Button ' + idx + ' → ' + learnTarget.name + ' (' + label + ')', 'ok');
            cancelLearnMode();

        } else if (learnTarget.type === 'button') {
            var idx = buttons.findIndex(function(b) { return b === 1; });
            if (idx < 0) return;
            var inp = learnTarget.el.querySelector('.btn-index-input');
            if (inp) inp.value = idx;
            setStatus('Button ' + idx + ' → ' + learnTarget.name, 'ok');
            cancelLearnMode();

        } else if (learnTarget.type === 'btn-axis') {
            var maxVal = 0.3, maxIdx = -1;
            axes.forEach(function(v, i) { if (Math.abs(v) > maxVal) { maxVal = Math.abs(v); maxIdx = i; } });
            if (maxIdx < 0) return;
            var inp = learnTarget.el.querySelector('.btn-axis-index-input');
            if (inp) inp.value = maxIdx;
            setStatus('Axis ' + maxIdx + ' → ' + learnTarget.name, 'ok');
            cancelLearnMode();
        }
    }

    // Learn button click delegation
    var form = document.getElementById('mapping-form');
    if (form) {
        form.addEventListener('click', function(e) {
            var btn = e.target.closest('.learn-btn');
            if (!btn) return;
            var row = btn.closest('[data-axis-name], [data-btn-name]');
            if (!row) return;

            if (row.dataset.axisName) {
                var type = btn.dataset.learn || 'axis';
                enterLearnMode(type, row.dataset.axisName, row, btn);
            } else if (row.dataset.btnName) {
                var type = btn.dataset.learn || 'button';
                enterLearnMode(type, row.dataset.btnName, row, btn);
            }
        });
    }

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') cancelLearnMode();
    });

    // ── Helpers ──────────────────────────────────────────────────────────────
    function setStatus(msg, type) {
        var el = document.getElementById('mapping-status');
        if (!el) return;
        el.textContent = msg;
        el.className   = 'mapping-status ' + (type || '');
    }

})();
