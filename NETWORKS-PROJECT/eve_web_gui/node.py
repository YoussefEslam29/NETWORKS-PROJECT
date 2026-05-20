import rclpy
from rclpy.node import Node
from rclpy.client import Client
from rclpy.qos import QoSProfile,QoSReliabilityPolicy,QoSHistoryPolicy,QoSDurabilityPolicy
import rclpy.logging
from eve_web_gui.app import app, socketio
from flask import request
from flask_socketio import emit
from rcl_interfaces.msg import Log

from eve_control_types.msg import Status

from geometry_msgs.msg import Twist
from std_msgs.msg import String
from ament_index_python.packages import get_package_share_directory

import threading
import socket
import time
import json
import os
import sqlite3
from pathlib import Path

_DB_PATH = Path.home() / '.local' / 'share' / 'eve_web_gui' / 'controller_mappings.db'

DEFAULT_MAPPING = {
  "deadzone": 0.1,
  "axes": {
    "forward": {"source": "axis", "index": 1, "invert": True},
    "turn":    {"source": "axis", "index": 2, "invert": False}
  },
  "buttons": {},
  "keyboard": {}
}


class EVEGUINode(Node):
    def __init__(self):
        super().__init__('eve_gui')
        self.get_logger().set_level(rclpy.logging.LoggingSeverity.DEBUG)

        #initial attributes.
        self.__is_shutting_down = False

        self.__current_device_id = ''
        self.__current_profile   = 'Default'
        self.__mapping = self.__default_mapping()
        self.__prev_buttons = {}
        self.__controller_connected = False
        self.__controller_name = ''
        self.__pilot_sid = None
        self.__db_lock = threading.Lock()
        self.__init_db()


        #publish cmd_vel at a fixed 5 Hz.
        self.create_timer(0.2, self.__publish_cmd_vel)

        #rosout log.
        self.create_subscription(Log,
            'rosout',
            self.__log_callback,
            self.__qos_profile(10)
        )

        #robot status subscription.
        self.create_subscription(Status, '/status', self.__status_callback, self.__qos_profile())

        #controller input movement command publisher.
        self.__cmd_vel_pub = self.create_publisher(Twist,'/cmd_vel',self.__qos_profile(1))
        self.__twist = Twist()

        #taunt publisher
        self.__taunt_pub = self.create_publisher(String, '/robot_taunt', self.__qos_profile(1))

        #background thread spin.
        self.__ros_thread = threading.Thread(target=self.__ros,daemon=True)
        self.__ros_thread.start()

        #socket events.
        self.__handle_socket_events()


    #rosout log callback function.
    def __log_callback(self,msg:Log):
        level_mapping = {
            Log.DEBUG: 'DEBUG',
            Log.INFO: 'INFO',
            Log.WARN: 'WARN',
            Log.ERROR: 'ERROR',
            Log.FATAL: 'FATAL',
        }

        level = level_mapping.get(msg.level, 'INFO')

        timestamp = f'{msg.stamp.sec}.{msg.stamp.nanosec // 1000000:03d}'
        
        socketio.emit('terminal_log',{
                'timestamp': timestamp,
                'level': level,
                'message': f'[{msg.name}] {msg.msg}',
            })

    #robot status callback.
    def __status_callback(self, msg: Status):
        socketio.emit('robot_status', {
            'distance_cm': [
                int(msg.distance_cm[0]),
                int(msg.distance_cm[1]),
                int(msg.distance_cm[2]),
                int(msg.distance_cm[3])
            ],
            'euler': {
                'x': float(msg.euler.x),
                'y': float(msg.euler.y),
                'z': float(msg.euler.z),
            }
        })

    #handle socket events.
    def __handle_socket_events(self):

        #browser connection event.
        @socketio.on('connect')
        def handle_connect():
            emit('robot_status', {
                'distance_cm': [0, 0, 0, 0],
                'euler': {'x': 0.0, 'y': 0.0, 'z': 0.0}
            })
            emit('controller_status', {
                'connected': self.__controller_connected,
                'name': self.__controller_name
            })
            emit('mapping', self.__mapping)

        #clear pilot ownership when the pilot's browser disconnects.
        @socketio.on('disconnect')
        def handle_disconnect():
            if request.sid == self.__pilot_sid:
                self.__pilot_sid = None
                self.__controller_connected = False
                self.__controller_name = ''
                self.__prev_buttons = {}
                self.__apply_gamepad_state([], [])
                socketio.emit('controller_status', {'connected': False, 'name': ''})
                self.get_logger().info('Pilot disconnected')

        #gamepad_connected socket event.
        @socketio.on('gamepad_connected')
        def handle_gamepad_connected(data):
            name         = data.get('id', '')
            device_id    = data.get('device_id', '')
            profile_name = data.get('profile_name', 'Default')
            sid          = request.sid
            if self.__pilot_sid is not None and self.__pilot_sid != sid:
                emit('mapping', self.__mapping)
                return
            self.__pilot_sid = sid
            if device_id:
                profiles = self.__db_get_profiles(device_id)
                if not profiles:
                    self.__db_upsert(device_id, 'Default', self.__default_mapping())
                    profiles = ['Default']
                    profile_name = 'Default'
                elif profile_name not in profiles:
                    profile_name = profiles[0]
                self.__current_device_id = device_id
                self.__current_profile   = profile_name
                self.__mapping = self.__db_get_mapping(device_id, profile_name) or self.__default_mapping()
                self.__prev_buttons = {}
            self.__controller_connected = True
            self.__controller_name = name
            socketio.emit('controller_status', {'connected': True, 'name': name})
            emit('mapping', self.__mapping)
            self.get_logger().info(
                f'Browser gamepad connected: {name} (device={device_id or "unknown"}, profile={profile_name})'
            )

        #gamepad_disconnected socket event.
        @socketio.on('gamepad_disconnected')
        def handle_gamepad_disconnected(data=None):
            if request.sid != self.__pilot_sid:
                return
            self.__pilot_sid = None
            self.__controller_connected = False
            self.__controller_name = ''
            self.__prev_buttons = {}
            self.__apply_gamepad_state([], [])
            socketio.emit('controller_status', {'connected': False, 'name': ''})
            self.get_logger().info('Browser gamepad disconnected')

        #gamepad_state socket event.
        @socketio.on('gamepad_state')
        def handle_gamepad_state(data):
            if request.sid != self.__pilot_sid:
                return
            axes     = data.get('axes', [])
            buttons  = data.get('buttons', [])
            kbd_axes = data.get('kbd_axes', {})
            kbd_btns = data.get('kbd_buttons', {})
            self.__apply_gamepad_state(axes, buttons, kbd_axes, kbd_btns)

        @socketio.on('get_profiles')
        def handle_get_profiles(data=None):
            data = data or {}
            device_id = data.get('device_id', '')
            profiles = self.__db_get_profiles(device_id) or ['Default']
            emit('profiles_list', {'profiles': profiles})

        @socketio.on('get_mapping')
        def handle_get_mapping(data=None):
            data = data or {}
            device_id    = data.get('device_id', '')
            profile_name = data.get('profile_name', 'Default')
            mapping = self.__db_get_mapping(device_id, profile_name) or self.__default_mapping()
            emit('mapping', mapping)

        @socketio.on('save_mapping')
        def handle_save_mapping(data):
            device_id    = data.get('device_id', '')
            profile_name = data.get('profile_name', 'Default')
            mapping      = data.get('mapping')
            if mapping is None:
                self.__db_delete_profile(device_id, profile_name)
            else:
                self.__db_upsert(device_id, profile_name, mapping)
                if device_id == self.__current_device_id and profile_name == self.__current_profile:
                    self.__mapping = mapping
            emit('mapping_saved', {'ok': True})

        @socketio.on('create_profile')
        def handle_create_profile(data):
            device_id    = data.get('device_id', '')
            profile_name = (data.get('profile_name') or '').strip()
            copy_from    = data.get('copy_from', 'Default')
            if not profile_name:
                emit('profiles_list', {'profiles': self.__db_get_profiles(device_id) or ['Default'], 'error': 'empty name'})
                return
            base = self.__db_get_mapping(device_id, copy_from) or self.__default_mapping()
            self.__db_upsert(device_id, profile_name, base)
            emit('profiles_list', {'profiles': self.__db_get_profiles(device_id)})

        @socketio.on('delete_profile')
        def handle_delete_profile(data):
            device_id    = data.get('device_id', '')
            profile_name = data.get('profile_name', '')
            self.__db_delete_profile(device_id, profile_name)
            profiles = self.__db_get_profiles(device_id) or ['Default']
            emit('profiles_list', {'profiles': profiles})

        #robot taunt event
        @socketio.on('trigger_taunt')
        def handle_trigger_taunt(data):
            button_id = data.get('button', '')
            if button_id:
                msg = String()
                msg.data = button_id
                self.__taunt_pub.publish(msg)
                self.get_logger().info(f'Published taunt: {button_id}')

        #shutdown/restart socket event.
        @socketio.on('shutdown')
        def shutdown():
            self.__shutdown()



    #shutdown.
    def __shutdown(self):
        self.get_logger().info('System shutdown requested')
        self.__emit_notification(True, 0, 'System shutting down...')
        def _do():
            time.sleep(1.5)
            import subprocess
            subprocess.run(['sudo', 'systemctl', 'poweroff'], check=False)
        threading.Thread(target=_do, daemon=True).start()

    #publish the current twist at a fixed rate.
    def __publish_cmd_vel(self):
        if self.__is_shutting_down:
            return
        try:
            self.__cmd_vel_pub.publish(self.__twist)
        except Exception as e:
            self.get_logger().error(f'Failed to publish twist: {e}')

    #apply incoming browser gamepad state.
    def __apply_gamepad_state(self, axes: list, buttons: list,
                               kbd_axes: dict = None, kbd_buttons: dict = None):
        if self.__is_shutting_down:
            return

        kbd_axes    = kbd_axes    or {}
        kbd_buttons = kbd_buttons or {}
        deadzone = self.__mapping.get('deadzone', 0.1)

        def get_axis(name):
            cfg = self.__mapping['axes'].get(name, {})
            source = cfg.get('source', 'axis')
            invert = cfg.get('invert', False)

            if source == 'buttons':
                pos_idx = cfg.get('pos', -1)
                neg_idx = cfg.get('neg', -1)
                pos = bool(buttons[pos_idx]) if 0 <= pos_idx < len(buttons) else False
                neg = bool(buttons[neg_idx]) if 0 <= neg_idx < len(buttons) else False
                val = (1.0 if pos else 0.0) - (1.0 if neg else 0.0)
            else:
                idx = cfg.get('index', -1)
                if idx < 0 or idx >= len(axes):
                    val = 0.0
                else:
                    val = float(axes[idx])
                    if abs(val) < deadzone:
                        val = 0.0

            gp_val = -val if invert else val
            # Merge keyboard axis contribution (additive, clamped).
            return max(-1.0, min(1.0, gp_val + float(kbd_axes.get(name, 0.0))))

        self.__twist.linear.x  = get_axis('forward')
        self.__twist.angular.z = get_axis('turn')

    #check service status.
    def __check_service(self, client:Client) -> bool:
        return client.service_is_ready()

    #qos profile factory.
    def __qos_profile(self,depth:int = 5) -> QoSProfile:
        return QoSProfile(
            reliability = QoSReliabilityPolicy.BEST_EFFORT,
            history = QoSHistoryPolicy.KEEP_LAST,
            durability = QoSDurabilityPolicy.VOLATILE,
            depth = depth
        )

    #build a fresh copy of the default mapping.
    def __default_mapping(self) -> dict:
        return {
            'deadzone': DEFAULT_MAPPING['deadzone'],
            'axes':    {k: dict(v) for k, v in DEFAULT_MAPPING['axes'].items()},
            'buttons': dict(DEFAULT_MAPPING['buttons']),
            'keyboard': dict(DEFAULT_MAPPING.get('keyboard', {})),
        }

    # ── SQLite helpers ─────────────────────────────────────────────────────────
    def __init_db(self):
        _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        self.__db = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
        self.__db.execute('''
            CREATE TABLE IF NOT EXISTS profiles (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id    TEXT    NOT NULL,
                profile_name TEXT    NOT NULL DEFAULT 'Default',
                deadzone     REAL    NOT NULL DEFAULT 0.1,
                axes         TEXT    NOT NULL,
                buttons      TEXT    NOT NULL,
                keyboard     TEXT    NOT NULL DEFAULT '{}',
                updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
                UNIQUE(device_id, profile_name)
            )
        ''')
        self.__db.commit()

    def __db_get_profiles(self, device_id: str) -> list:
        with self.__db_lock:
            rows = self.__db.execute(
                'SELECT profile_name FROM profiles WHERE device_id=? ORDER BY id',
                (device_id,)
            ).fetchall()
        return [r[0] for r in rows]

    def __db_get_mapping(self, device_id: str, profile_name: str) -> dict | None:
        with self.__db_lock:
            row = self.__db.execute(
                'SELECT deadzone, axes, buttons, keyboard FROM profiles WHERE device_id=? AND profile_name=?',
                (device_id, profile_name)
            ).fetchone()
        if not row:
            return None
        try:
            return {
                'deadzone': row[0],
                'axes':     json.loads(row[1]),
                'buttons':  json.loads(row[2]),
                'keyboard': json.loads(row[3]),
            }
        except Exception:
            return None

    def __db_upsert(self, device_id: str, profile_name: str, mapping: dict):
        with self.__db_lock:
            self.__db.execute(
                '''INSERT OR REPLACE INTO profiles
                       (device_id, profile_name, deadzone, axes, buttons, keyboard, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, datetime('now'))''',
                (
                    device_id,
                    profile_name,
                    float(mapping.get('deadzone', 0.1)),
                    json.dumps(mapping.get('axes', {})),
                    json.dumps(mapping.get('buttons', {})),
                    json.dumps(mapping.get('keyboard', {})),
                )
            )
            self.__db.commit()

    def __db_delete_profile(self, device_id: str, profile_name: str):
        with self.__db_lock:
            self.__db.execute(
                'DELETE FROM profiles WHERE device_id=? AND profile_name=?',
                (device_id, profile_name)
            )
            self.__db.commit()

    #server ip.
    def __get_ip(self) -> str:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(('192.168.0.1', 1))
            return s.getsockname()[0]
        except OSError as e:
            self.get_logger().warn(f'Unable to determine LAN IP, falling back to localhost: {e}')
            return '127.0.0.1'
        finally:
            s.close()
    
    #notification helper.
    def __emit_notification(self, success: bool, error_code: int, message: str):
        socketio.emit('notification', {
            'success': success,
            'error_code': error_code,
            'message': message
        })

    #initiate ros process.
    def __ros(self):
        while rclpy.ok():
            try:
                rclpy.spin_once(self,timeout_sec=0.01)
            except Exception as e:
                try:
                    self.get_logger().error(f'ROS spin error: {e}')
                except Exception:
                    pass
    
    #initiate socket.
    def run_socket(self):
        port = int(os.environ.get('EVE_GUI_PORT', '5050'))
        self.get_logger().info(f'Server starting at http://{self.__get_ip()}:{port}...')
        socketio.run(app, host='0.0.0.0', port=port, allow_unsafe_werkzeug=True)

    #destroy node override.
    def destroy_node(self):
        self.__is_shutting_down = True
        try:
            self.__db.close()
        except Exception:
            pass
        super().destroy_node()

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

if __name__ == '__main__':
    main()
