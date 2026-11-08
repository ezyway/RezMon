# RezMon (Resource Monitor)

A minimalist, high-performance system resource monitor for the GNOME Shell top panel. RezMon provides real-time tracking of CPU, Multi-GPU, RAM, SWAP, Disk I/O, Root Storage, and Network statistics with threshold alerts, an interactive live dropdown dashboard, and deep visual styling.

![Resource Monitor Screenshot](./screenshots/Full%20View.png)

## Highlights & Features

- **CPU Monitoring**: Usage percentage, average core frequency (GHz), and core temperature (℃ / ℉).
- **Multi-GPU & VRAM**: 
  - Supports **NVIDIA**, **AMD Radeon**, and **Intel Graphics** (Auto, Dedicated, or Integrated selection).
  - Usage %, clock speed, temperature, and dedicated/shared VRAM (Used, Free, %).
  - Laptop power-saving: Preserves discrete GPU D3cold sleep on battery.
- **RAM & SWAP**: Memory usage, free memory, and dedicated swap tracking with color-coded alerts.
- **Disk I/O & Storage**: Real-time read/write throughput rates and root (`/`) storage utilization.
- **Network Bandwidth**: Live download (↓) and upload (↑) bandwidth, automatic default route or specific interface selection (Wi-Fi, Ethernet, VPN), and fractional precision.
- **Live System Overview Dashboard**: Real-time popup overview with visual progress bars (`████░░░░ 50%`) for all hardware, top 3 CPU and Memory processes, and quick-launch system monitors (*GNOME System Monitor, Resources, btop, htop*).
- **Customizable Layout & Styling**:
  - Display modes: **Text Headers** (`CPU`, `RAM`), **Symbolic Icons** (`⚙`, `🖴`), or **Compact Mode** (brackets only).
  - Dynamic drag/move metric ordering.
  - Panel box positioning (Left, Center, Right) and centered Ubuntu date/clock repositioning.
  - Custom brackets, delimiters, spacing, update intervals (1–5s), and yellow/red warning thresholds.

## Compatibility

- **GNOME Shell**: `45`, `46`, `47`, `48`, `49`, `50`, and `51`
- **Display Server**: Wayland & X11
- **Platform**: Linux (x86_64, aarch64)

## Installation

### Method 1: GNOME Extensions Website (Recommended)
Install with one click from the official [GNOME Extensions - RezMon](https://extensions.gnome.org/extension/6952/rezmon/) page.

### Method 2: From Source
```bash
git clone https://github.com/ezyway/RezMon.git
cd RezMon
make install
```
*(If `make` is unavailable, see the zero-dependency bash install in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).)*

## Detailed Documentation

For in-depth guides, telemetry architecture, and customization details, see the `docs/` folder:

| Guide | Description |
| :--- | :--- |
| 📖 [**Hardware & GPU Guide**](docs/HARDWARE_GPU.md) | Multi-GPU handling, NVIDIA D3cold sleep, AMD/Intel sysfs, thermal sensors, and network routing. |
| 🎨 [**Configuration & Styling**](docs/CONFIGURATION.md) | Display styles (Text, Icons, Compact), metric ordering, panel & clock repositioning, and alert colors. |
| 🛠️ [**Development & Packaging**](docs/DEVELOPMENT.md) | Makefile targets, bash build steps without make, EGO packaging rules, and code verification. |
| 🌐 [**Translations (i18n)**](docs/TRANSLATIONS.md) | Contributing new language translations via Gettext PO files and compiling locales. |

## Credits & License

- Based on the [System Monitor Tray Indicator](https://github.com/michaelknap/gnome-system-monitor-indicator) by Michael Knap.
- Licensed under the [MIT License](LICENSE).
