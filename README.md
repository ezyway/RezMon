# RezMon (Resource Monitor)

A minimalist, lightweight system resource monitor extension for the GNOME Shell top bar/status area. It provides real-time tracking of CPU, RAM, and network statistics directly in your panel, complete with custom threshold coloring and full styling configuration.

![Resource Monitor Screenshot](./screenshots/Full%20View.png)

## Features

- **CPU monitoring**:
  - Usage percentage (colored based on configurable warning/critical thresholds)
  - Average clock frequency (GHz)
  - Core temperature (℃)
- **RAM monitoring**:
  - Used memory (GB)
  - Free memory (GB)
  - Usage percentage (colored based on thresholds)
- **Network monitoring**:
  - Real-time download (↓) and upload (↑) speeds
  - Smart automatic unit conversion (B/s, KB/s, MB/s, GB/s)
- **Highly customizable appearance**:
  - Customizable brackets: `( )`, `[ ]`, or `{ }`
  - Multiple text delimiters: `|`, `-`, `~`, `/`, `\`, `:`, `;`, `+`, `=`, or space
  - Configurable panel spacing: `Small`, `Normal`, or `Wide`
- **Adjustable behavior**:
  - Customizable update interval (1 to 5 seconds)
  - Warning and critical thresholds for color coding (Yellow/Red)

## Compatibility

RezMon is officially tested and supported on:
- **GNOME Shell version**: `45`, `46`, `47`, `48`, `49`, and `50`
- **OS**: Ubuntu 26.04 LTS (and other distributions running compatible GNOME versions)

## Installation

### Method 1: GNOME Extensions Website (Recommended)

Install it directly with one click from the official [GNOME Extensions - RezMon](https://extensions.gnome.org/extension/6952/rezmon/) page.

### Method 2: Manual Installation (From Source)

To build and install the extension manually, you can use the provided `Makefile`.

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ezyway/RezMon.git
   cd RezMon
   ```

2. **Build and install:**
   ```bash
   make install
   ```
   This will compile the settings schemas and copy the extension files to your local directory: `~/.local/share/gnome-shell/extensions/rezmon@azz.lol`.

3. **Restart GNOME Shell:**
   - **X11**: Press `Alt+F2`, type `r`, and press `Enter`.
   - **Wayland**: Log out of your session and log back in.

4. **Enable the extension:**
   Enable it via the GNOME **Extensions** or **Extension Manager** application.

## Makefile Reference

The `Makefile` supports the following targets:
- `make build` - Prepares extension files under `build/` and compiles settings GSchemas.
- `make install` - Installs the extension locally and attempts to enable it.
- `make uninstall` - Disables and removes the local installation.
- `make zip` - Generates a production-ready package zip file (`rezmon@azz.lol.zip`).
- `make clean` - Removes the build directories.

## Credits

Based on the [System Monitor Tray Indicator](https://github.com/michaelknap/gnome-system-monitor-indicator) by Michael Knap.

## License

This project is licensed under the [MIT License](LICENSE).

