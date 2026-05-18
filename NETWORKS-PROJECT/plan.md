# EVE_WEB_GUI — Implementation Plan

Adapt the `triton_gui` ROS 2 + Flask GUI (originally built for a 6-thruster ROV) to
control a 2-wheel self-balancing robot. The ROS package is renamed to `eve_web_gui`.

---

## 1. Package rename

### `setup.py`
- `package_name = 'triton_gui'` → `'eve_web_gui'`
- In `data_files`, change `'resource/triton_gui'` → `'resource/eve_web_gui'`
- Remove the two TTS wav entries:
  ```python
  ('share/' + package_name + '/tts-lines',    glob('tts-lines/*.wav')),
  ('share/' + package_name + '/tts-lines-ar', glob('tts-lines-ar/*.wav')),
  ```
- Update entry point: `'pilot_node = eve_web_gui.node:main'`

### `package.xml`
- `<name>triton_gui</name>` → `<name>eve_web_gui</name>`

### `resource/` directory
- Rename the file `resource/triton_gui` → `resource/eve_web_gui`

### Python package directory
- Rename the top-level Python package directory `triton_gui/` → `eve_web_gui/`
- Update every Python import that references `triton_gui`:
  - `eve_web_gui/app/__init__.py`: `get_package_share_directory('triton_gui')` → `'eve_web_gui'`  
    and `from triton_gui.app import routes` → `from eve_web_gui.app import routes`
  - `eve_web_gui/node.py`: `from triton_gui.app import app, socketio` → `from eve_web_gui.app import app, socketio`
  - `eve_web_gui/app/routes.py`: `from triton_gui.app import app, socketio` → `from eve_web_gui.app import app, socketio`

---

## 2. `eve_web_gui/node.py`

### Remove imports
```python
# DELETE these lines:
from equinox_movement_types.msg import Status
from equinox_movement_types.srv import SetState
from equinox_payload_types.msg import Payloads
from equinox_power_types.msg import PowerStatus
from equinox_safety_types.msg import SafetyStatus
from pi_system_types.msg import Stats
from misc_types.msg import Heartbeat
import psutil
import subprocess
```

### Add import
```python
from eve_control_types.msg import Status
```

### Remove constants
Delete `DEAD_THRESHOLD`, `_GAIN_UP`, `_GAIN_DOWN`.

### Update DB path
```python
_DB_PATH = Path.home() / '.local' / 'share' / 'eve_web_gui' / 'controller_mappings.db'
```

### Replace `DEFAULT_MAPPING`
Strip the ROV 6-axis mapping down to forward/turn only:
```python
DEFAULT_MAPPING = {
  "deadzone": 0.1,
  "axes": {
    "forward": {"source": "axis", "index": 1, "invert": True},
    "turn":    {"source": "axis", "index": 2, "invert": False}
  },
  "buttons": {},
  "keyboard": {}
}
```

### Remove state variables from `__init__`
Delete these attributes:
```python
self.__arm_status
self.__movement_mode
self.__motor_power
self.__pressure_normal
self.__gripper_status
self.__last_payload_state
self.__fcu_status
self.__lastfcu_time
self.__visionu_status
self.__lastvisionu_time
```

### Remove timers from `__init__`
Delete:
```python
self.create_timer(0.5, self.__check_inactivity)
self.create_timer(2.0, self.__collect_local_stats)
```
Keep `self.create_timer(0.2, self.__publish_cmd_vel)`.

### Remove subscriptions from `__init__`
Delete all of these:
```python
self.create_subscription(Stats, 'system/stats/rpicontrol', ...)
self.create_subscription(Stats, 'system/stats/rpivision', ...)
self.create_subscription(Status, 'movement/status', ...)
self.create_subscription(SafetyStatus, 'safety/status', ...)
self.create_subscription(PowerStatus, 'power/status', ...)
self.create_subscription(Heartbeat, 'heartbeat', ...)
```
Keep the `rosout` subscription.

### Add `/status` subscription to `__init__`
```python
self.create_subscription(Status, '/status', self.__status_callback, self.__qos_profile())
```

### Remove publishers/clients from `__init__`
Delete:
```python
self.__set_state_client = self.create_client(SetState, 'movement/set_state')
self.__grippers_pub = self.create_publisher(Payloads, 'payload', self.__qos_profile(1))
self.__grippers = Payloads()
```

### Update cmd_vel publisher topic
```python
# Change:
self.__cmd_vel_pub = self.create_publisher(Twist, 'movement/cmd_vel', self.__qos_profile(1))
# To:
self.__cmd_vel_pub = self.create_publisher(Twist, '/cmd_vel', self.__qos_profile(1))
```

### Delete these methods entirely
- `__flight_controller_telemetry`
- `__vision_unit_telemetry`
- `__collect_local_stats`
- `__flight_controller_readings`
- `__internal_box_safety`
- `__buck_esc_readings`
- `__heartbeat_callback`
- `__check_inactivity`
- `__set_state`
- `__handle_set_state_response`

### Add new callback method
```python
def __status_callback(self, msg: Status):
    socketio.emit('robot_status', {
        'distance_cm': [int(msg.distance_cm[0]), int(msg.distance_cm[1])],
        'euler': {
            'x': float(msg.euler.x),
            'y': float(msg.euler.y),
            'z': float(msg.euler.z),
        }
    })
```

### Update `__apply_gamepad_state`
Replace the 6-axis twist assignments:
```python
# DELETE these 6 lines:
self.__twist.linear.y  = get_axis('surge')
self.__twist.linear.x  = get_axis('sway')
self.__twist.linear.z  = get_axis('heave')
self.__twist.angular.x = get_axis('yaw')
self.__twist.angular.z = get_axis('pitch')
self.__twist.angular.y = get_axis('roll')

# ADD these 2 lines:
self.__twist.linear.x  = get_axis('forward')
self.__twist.angular.z = get_axis('turn')
```

Delete all the button-action blocks after the twist assignments:
```python
# DELETE everything from here to the end of __apply_gamepad_state:
if btn_pressed('arm_disarm'): ...
if btn_pressed('mode_manual'): ...
if btn_pressed('mode_stabilize'): ...
if btn_pressed('mode_depth_hold'): ...
if btn_pressed('mode_position_hold'): ...
gripper_changed = False
if btn_pressed('gripper_left'): ...
if btn_pressed('gripper_right'): ...
if gripper_changed: ...
roll_cw_held  = btn_held('roll_cw')
...
if btn_pressed('gain_up'): ...
if btn_pressed('gain_down'): ...
```

### Update `handle_connect` socket event
Replace the full emit block in `handle_connect` with:
```python
@socketio.on('connect')
def handle_connect():
    emit('robot_status', {
        'distance_cm': [0, 0],
        'euler': {'x': 0.0, 'y': 0.0, 'z': 0.0}
    })
    emit('controller_status', {
        'connected': self.__controller_connected,
        'name': self.__controller_name
    })
    emit('mapping', self.__mapping)
```

### Delete socket events
Remove the handler functions for: `set_arm`, `set_movement_mode`, `set_motor_power`.

### Rename node class
`class TritonGUINode(Node):` → `class EVEGUINode(Node):`  
Update `super().__init__('gui')` to `super().__init__('eve_gui')`.

### Update `main()`
Replace the entire `main()` function with:
```python
def main():
    rclpy.init()
    node = EVEGUINode()
    try:
        node.run_socket()
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()
```

---

## 3. `eve_web_gui/app/routes.py`

Delete all TTS code. The file should only contain:
```python
from eve_web_gui.app import app
from flask import render_template

@app.route('/')
def home_page():
    return render_template('index.html')
```

---

## 4. `eve_web_gui/app/templates/index.html`

### `<head>` changes
- Change title: `ROV Pilot Control System` → `EVE Robot Control`
- Remove this line: `<link rel="stylesheet" href="/static/css/dashboard.css">`
- Remove this line: `<script src="/static/js/audio.js" defer></script>`

### Status bar — remove these sections (delete the full `<div class="status-item">` block for each)
- `id="timer-section"` (timer + start/pause/reset buttons)
- `id="grippers-section"` (L/R gripper LEDs)
- `id="power-section"` (GAIN control)
- `id="depth-section"`
- `id="orientation-section"` (gyro indicator)
- `id="mode-section"` (MAN/STAB/DEPTH/POS buttons)
- `id="arm-section"`

Also delete the `<div class="divider"></div>` that precedes each removed section.

### Status bar — add new sections after `id="controller-section"`
Insert after the controller section's closing `</div>` and its following divider:
```html
<div class="divider"></div>

<div class="status-item" id="euler-section">
    <span class="label">X:</span><span id="euler-x" class="value">0.00°</span>
    <span class="label">Y:</span><span id="euler-y" class="value">0.00°</span>
    <span class="label">Z:</span><span id="euler-z" class="value">0.00°</span>
</div>

<div class="divider"></div>

<div class="status-item" id="distance-section">
    <span class="label">L:</span><span id="dist-left"  class="value">0 cm</span>
    <span class="label">R:</span><span id="dist-right" class="value">0 cm</span>
</div>
```

### Shutdown dialog
Update the confirm message text:
```html
<!-- Change: -->
<div class="confirm-message">This will power off the flight controller and vision unit.</div>
<!-- To: -->
<div class="confirm-message">This will power off the robot.</div>
```

---

## 5. `eve_web_gui/app/static/js/script.js`

### Remove socket event handlers
Delete these `socket.on(...)` blocks entirely:
- `'tts_language_changed'`
- `'safety_alert'`
- `'gripper_status'`
- `'flight_controller_status'`
- `'vision_unit_status'`
- `'rov_orientation'`
- `'rov_depth'`
- `'arm_state'`
- `'movement_mode_state'`
- `'motor_power'`

### Add `robot_status` handler
Add this after the `controller_status` handler:
```js
socket.on('robot_status', function(data) {
    var ex = document.getElementById('euler-x');
    var ey = document.getElementById('euler-y');
    var ez = document.getElementById('euler-z');
    var dl = document.getElementById('dist-left');
    var dr = document.getElementById('dist-right');
    if (ex) ex.textContent = data.euler.x.toFixed(2) + '°';
    if (ey) ey.textContent = data.euler.y.toFixed(2) + '°';
    if (ez) ez.textContent = data.euler.z.toFixed(2) + '°';
    if (dl) dl.textContent = data.distance_cm[0] + ' cm';
    if (dr) dr.textContent = data.distance_cm[1] + ' cm';
});
```

### Remove DOM references that no longer exist
In the `DOM` object at the top of the file, delete these entries (the elements are gone
from the HTML):
```js
gripperLed1, gripperLed2,
gyroHorizon, gyroHeadingValue,
depthValue,
timerLabel, startBtn, pauseBtn, resetBtn,
armBtn, modeBtns,
powerInput, powerDownBtn, powerAbsBtn, powerUpBtn,
powerValueDisplay, powerValueBox
```

### Remove dead event listeners and functions
Delete the following blocks (they reference removed DOM elements):
- Timer section: `DOM.startBtn.onclick`, `DOM.pauseBtn.onclick`, `DOM.resetBtn.onclick`
- Arm: `DOM.armBtn.onclick`
- Power: `DOM.powerDownBtn.onclick`, `DOM.powerUpBtn.onclick`, `DOM.powerAbsBtn.onclick`
- Mode buttons: `DOM.modeBtns.forEach(...)` click listener and `setActiveMode()` function

### Remove TTS/audio references in `connect` handler
In the `socket.on('connect', ...)` handler, delete:
```js
window.tritonAudio?.holdFor(1000);
window.tritonAudio?.play('welcome', { force: true });
```

Also remove the `window.addEventListener('storage', ...)` block that references `triton_kbd_hold`.

---

## 6. Files to delete
- `tts-lines/` directory (all `.wav` files inside)
- `tts-lines-ar/` directory (all `.wav` files inside)
- `eve_web_gui/app/static/js/audio.js` (if it exists)
