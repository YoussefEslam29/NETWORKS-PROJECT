# Role & Context
You are an expert Frontend Engineer and Robotics UI developer. I have an old Web GUI codebase originally built for a robotics team called "Triton". I am adapting, cleaning, and rewriting this codebase for a new self-stabilizing wheeled robot project named **EVE**. 

I will provide the source code files below. Your task is to modify the layout, branding, and functionalities exactly according to the specifications below.

---

# 1. Branding & Code Cleanup
- **Rebrand:** Search the entire provided code for any mention of "Triton" (case-insensitive) and replace it with our new robot name: **EVE**.
- **Feature Strip-down:** Remove any extra complex features from the original code that are not explicitly mentioned in the requirements below. Keep the code clean, minimal, and highly optimized.

---

# 2. Design & Layout Updates
- **Center Bottom Controls:** Locate the bottom panel of controls in the UI layout. Update its styling/flexbox/grid configurations to ensure this control section is perfectly centered horizontally in the middle of its container. Ensure it remains fully responsive.

---

# 3. Camera Functionality Updates
- **Single Robot Stream Only:** The robot EVE only has one onboard camera. Completely remove any multi-camera switching features, including any `+` and `-` camera selection buttons.
- **Remove Local Webcam Access:** The original code attempts to open the laptop's local webcam. **Completely strip out** any WebRTC/`navigator.mediaDevices.getUserMedia` code that requests browser camera permissions. The GUI should never ask the user for permission to open their local laptop camera. It should only display the incoming robot camera stream canvas/image element.

---

# 4. Gamepad Section Updates (PlayStation Controller)
We are using the browser **HTML5 Gamepad API** to read a connected PlayStation controller. Update the gamepad script and visual UI wrapper to meet these strict specifications:
- **Available Inputs Only:** EVE only processes the following inputs:
  1. **Left Stick (Ls):** Maps movement. Read its axes to handle **Forward, Backward, Rotate Left, Rotate Right**. Translate these values into a standard ROS 2 `geometry_msgs/msg/Twist` JSON structure for the `/cmd_vel` topic:
     - Forward/Backward maps to `linear.x`
     - Rotate Left/Rotate Right maps to `angular.z`
  2. **The 4 Shape Buttons:** These trigger voice taunts from the robot. Map the following button indexes:
     - **Cross (X)**
     - **Circle (◯)**
     - **Square (◻)**
     - **Triangle (△)**
     *(Note: Just log or set up a placeholder function for these 4 button triggers, as I will add the specific audio filenames later).*
- **Visual Gamepad Tester UI:** Update the Gamepad UI container to display authentic, highly visual PlayStation controller button icons (like the layout on gamepad-tester.com). Use clean CSS/SVG icons for the 4 shapes (✕, ◯, ◻, △) and the Left Stick (Ls). When the user pushes the stick or presses one of the 4 shape buttons on their physical controller, the corresponding icon on the screen must visually light up or change state in real-time.

---

# 5. Live Diagnostics Section Updates
Update the telemetry/live diagnostics UI panel to match EVE's incoming sensor feedback state.
- **Grid Layout:** Structure the live diagnostics layout to explicitly show data fields or directional layout blocks for:
  - **Left**
  - **Right**
  - **Front**
  - **Back**
- **ROS 2 Topic Integration:** Ensure these fields are wired to parse data from the `/status` topic (`custom_msgs/msg/Status`), which has the following layout:
  ```msg
  builtin_interfaces/Time stamp
  uint8[2]                distance_cm
  geometry_msgs/Vector3   euler