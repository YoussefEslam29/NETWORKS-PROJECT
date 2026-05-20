import sys

class MockModule:
    pass

class MockNode:
    def __init__(self, *args, **kwargs):
        pass
    def get_logger(self):
        class Logger:
            def set_level(self, *args, **kwargs): pass
            def info(self, msg): print(f"INFO: {msg}")
            def warn(self, msg): print(f"WARN: {msg}")
            def error(self, msg): print(f"ERROR: {msg}")
            def debug(self, msg): print(f"DEBUG: {msg}")
        return Logger()
    def create_timer(self, *args, **kwargs): pass
    def create_subscription(self, *args, **kwargs): pass
    def create_publisher(self, *args, **kwargs):
        class Publisher:
            def publish(self, *args, **kwargs): pass
        return Publisher()

mock_rclpy = MockModule()
mock_rclpy.logging = MockModule()
mock_rclpy.logging.LoggingSeverity = MockModule()
mock_rclpy.logging.LoggingSeverity.DEBUG = 1
mock_rclpy.ok = lambda: True
mock_rclpy.spin_once = lambda *args, **kwargs: None
mock_rclpy.init = lambda *args, **kwargs: None
mock_rclpy.shutdown = lambda *args, **kwargs: None

mock_rclpy_node = MockModule()
mock_rclpy_node.Node = MockNode

mock_rclpy_client = MockModule()
mock_rclpy_client.Client = MockModule

mock_rclpy_qos = MockModule()
mock_rclpy_qos.QoSProfile = lambda *args, **kwargs: None
mock_rclpy_qos.QoSReliabilityPolicy = MockModule()
mock_rclpy_qos.QoSReliabilityPolicy.BEST_EFFORT = 1
mock_rclpy_qos.QoSHistoryPolicy = MockModule()
mock_rclpy_qos.QoSHistoryPolicy.KEEP_LAST = 1
mock_rclpy_qos.QoSDurabilityPolicy = MockModule()
mock_rclpy_qos.QoSDurabilityPolicy.VOLATILE = 1

mock_rcl_interfaces = MockModule()
mock_rcl_interfaces_msg = MockModule()
mock_rcl_interfaces_msg.Log = MockModule()

mock_eve_control = MockModule()
mock_eve_control_msg = MockModule()
mock_eve_control_msg.Status = MockModule()

mock_geometry = MockModule()
mock_geometry_msg = MockModule()
mock_geometry_msg.Twist = lambda: type('T',(),{'linear':type('L',(),{'x':0,'y':0,'z':0})(),'angular':type('A',(),{'x':0,'y':0,'z':0})()})()

mock_ament = MockModule()
mock_ament_packages = MockModule()
mock_ament_packages.get_package_share_directory = lambda *args: ""

sys.modules['rclpy'] = mock_rclpy
sys.modules['rclpy.node'] = mock_rclpy_node
sys.modules['rclpy.client'] = mock_rclpy_client
sys.modules['rclpy.qos'] = mock_rclpy_qos
sys.modules['rclpy.logging'] = mock_rclpy.logging

sys.modules['rcl_interfaces'] = mock_rcl_interfaces
sys.modules['rcl_interfaces.msg'] = mock_rcl_interfaces_msg

sys.modules['eve_control_types'] = mock_eve_control
sys.modules['eve_control_types.msg'] = mock_eve_control_msg

sys.modules['geometry_msgs'] = mock_geometry
sys.modules['geometry_msgs.msg'] = mock_geometry_msg

sys.modules['ament_index_python'] = mock_ament
sys.modules['ament_index_python.packages'] = mock_ament_packages

mock_std_msgs = MockModule()
mock_std_msgs_msg = MockModule()
mock_std_msgs_msg.String = lambda: type('String', (), {'data': ''})()

sys.modules['std_msgs'] = mock_std_msgs
sys.modules['std_msgs.msg'] = mock_std_msgs_msg

from eve_web_gui.node import main
if __name__ == "__main__":
    print("Starting mock EVE Web GUI (without ROS 2)...")
    main()