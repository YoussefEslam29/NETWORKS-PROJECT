from setuptools import find_packages, setup
from glob import glob
import os

package_name = 'eve_web_gui'

setup(
    name=package_name,
    version='0.0.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages',
            ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        ('share/' + package_name + '/templates', glob('eve_web_gui/app/templates/*')),
        ('share/' + package_name + '/static/css', glob('eve_web_gui/app/static/css/*')),
        ('share/' + package_name + '/static/js', [f for f in glob('eve_web_gui/app/static/js/*') if os.path.isfile(f)]),
        ('share/' + package_name + '/static/js/vendor', glob('eve_web_gui/app/static/js/vendor/*')),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='adham-waheeb',
    maintainer_email='adhamwaheeb4444@gmail.com',
    description='TODO: Package description',
    license='TODO: License declaration',
    extras_require={
        'test': [
            'pytest',
        ],
    },
    entry_points={
        'console_scripts': [
            'pilot_node = eve_web_gui.node:main',
        ],
    },
)
