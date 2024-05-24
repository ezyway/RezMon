## Overview
This is a minimalist system monitor extension for GNOME Shell. It displays CPU( Useage | Average Clock | Temperature ), RAM (Free | Used) and NET ( Download | Upload ) GNOME Shell top bar. 

![Screenshot](./screenshots/Full%20View.png)

## Compatibility

Tested on - GNOME SHELL 46 - Ubuntu 24.04
May work on GNOME SHELL 45

## Installation

Install via [Gnome Extensions](https://extensions.gnome.org/extension/6952/rezmon/) page (recommended). 

Or by downloading this repository. 

```bash
cd /tmp
git clone https://github.com/ezyway/RezMon.git
cd RezMon
./install.sh
```
Once done, manually restart the GNOME Shell for the changes to take effect. On **X** you can do this by pressing 
`Alt+F2`, typing `r`, and pressing `Enter`. On **Wayland**, simply log out and back in.

The `install.sh` script copies the extension files to your local GNOME extensions directory. Once GNOME restarts, you can manage extension via Extensions app.


## Credits

System Monitor Tray Indicator [Gnome Extensions](https://extensions.gnome.org/extension/6586/system-monitor-tray-indicator/)
