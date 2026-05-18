# Triton GUI

Triton GUI is a web-based interface that provides real-time monitoring and control of robot systems with live camera streaming and vehicle telemetry.

## Features

- **Real-time Camera Streaming**: Multi-camera support (default 4, up to 6) with WebSocket-based streaming at configurable resolution and frame rate
- **Robot Control**: 
  - Arm/disarm functionality
  - Movement mode selection (manual/autonomous)
  - Motor power control
  - Direct velocity commands via gamepad/controller input
- **System Monitoring**:
  - FCU (Flight Control Unit) and vision unit status
  - Motor power statistics and ESC readings
  - Safety status and leak detection
  - System resource usage (CPU, memory, temperature)
  - Real-time ROS logs and diagnostics
  - Remote shutdown and restart capabilities
## Architecture

Triton GUI consists of:

- **ROS 2 Node** (`triton_gui/node.py`): Core integration with ROS 2 ecosystem, handles subscriptions, service calls, and real-time data streaming
- **Camera Server** (`triton_gui/camera_server.py`): Manages multi-camera streaming via WebSocket connections with JPEG compression
- **Flask Web Application** (`triton_gui/app/`): Responsive web interface with real-time updates via Socket.IO
- **Configuration** (`triton_gui/config/`): YAML-based controller configuration

## Requirements

- ROS2
- Python 3.x
- Flask and Flask-SocketIO
- OpenCV
- NumPy
- websockets
- PyYAML
- Custom Equinox and system message types

## Installation

1. Clone into your ROS 2 workspace:
```bash
cd ~/ros2_ws/src
git clone <repository-url> triton_gui
```

2. Install dependencies:
```bash
source /opt/ros/jazzy/setup.bash
cd ~/ros2_ws
rosdep install -i --from-paths src --ignore-src --rosdistro jazzy -y
```

3. Build:
```bash
colcon build --packages-select triton_gui
```

4. Source the setup:
```bash
source install/setup.bash
```

## Usage

### Start the GUI Node

```bash
ros2 run triton_gui gui_node
```

The web interface will be accessible at `http://localhost:5000` by default. The node logs a LAN URL when it starts.

### Configuration

Edit `triton_gui/config/controller.yaml` to customize:
- Controller axis and button indices.
