from flask import Flask
from flask_socketio import SocketIO
import os
from ament_index_python.packages import get_package_share_directory

share = get_package_share_directory('eve_web_gui')

app = Flask(
    __name__,
    template_folder=os.path.join(share, 'templates'),
    static_folder=os.path.join(share, 'static')
)

socketio = SocketIO(app, async_mode='threading', cors_allowed_origins='*', allow_upgrades=False)

from eve_web_gui.app import routes