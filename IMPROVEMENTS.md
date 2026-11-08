# RezMon Roadmap & Enhancement Plan (v22+)

> Architectural roadmap, pending feature proposals, and GNOME Shell 45–51 modernization targets for **RezMon (Resource Monitor)**.

---

## Table of Contents

1. [Network & Data Accuracy Enhancements](#1-network--data-accuracy-enhancements)
   - [1.1 Cumulative Session Traffic Counters](#11-cumulative-session-traffic-counters)
2. [Internationalization, CI/CD & Code Quality](#2-internationalization-cicd--code-quality)
   - [2.1 Gettext Internationalization (i18n / Localization)](#21-gettext-internationalization-i18n--localization)
   - [2.2 Automated GitHub Actions CI & Packaging](#22-automated-github-actions-ci--packaging)
   - [2.3 Developer Tooling & Makefile Targets](#23-developer-tooling--makefile-targets)
3. [Prioritized Implementation Matrix](#3-prioritized-implementation-matrix)
4. [Completed Features & Enhancements](#4-completed-features--enhancements)

---

## 1. Network & Data Accuracy Enhancements

### 1.1 Cumulative Session Traffic Counters
* **Target Files:** `src/metrics/net.js`, `src/indicator.js`
* **Motivation:**
  Users on metered cellular data or limited internet connections want to know total data consumed during the session.
* **Proposed Implementation:**
  - Track `state.session_rx_bytes` and `state.session_tx_bytes` accumulated over time.
  - Surface in the hover tooltip and dropdown menu.

---

## 2. Internationalization, CI/CD & Code Quality

### 2.1 Gettext Internationalization (i18n / Localization)
* **Target Files:** `po/`, `src/extension.js`, `src/prefs.js`, `src/indicator.js`
* **Motivation:**
  Currently, all UI labels ("Show CPU", "Usage %", "Temperature", "Open Settings", etc.) are hardcoded in English. GNOME Extensions review encourages `gettext` domains.
* **Proposed Implementation:**
  - Initialize `Gettext` using `Extension.initTranslations()`.
  - Wrap UI strings with `_("...")`.
  - Add template `po/rezmon.pot` and `Makefile` target `make pot` / `make mo`.

### 2.2 Automated GitHub Actions CI & Packaging
* **Target Files:** `.github/workflows/ci.yml`, `.github/workflows/release.yml`
* **Motivation:**
  Automates code linting, syntax verification, schema validation, and release zip generation on every PR and git tag.
* **Proposed Workflow:**
  - Lint with ESLint (using GNOME Shell environment preset).
  - Validate XML schema with `xmllint` and compile with `glib-compile-schemas`.
  - Test module imports via `gjs -m`.
  - Build release zip and attach to GitHub Release assets.

### 2.3 Developer Tooling & Makefile Targets
* **Target Files:** `Makefile`
* **Additions:**
  - `make test`: Executes test suite under `gjs`.
  - `make lint`: Runs ESLint / syntax checks across `src/`.
  - `make pot`: Extracts gettext translatable strings into `po/rezmon.pot`.
  - `make clean`: Cleans build artifacts and zip bundles.

---

## 3. Prioritized Implementation Matrix

| Phase | Focus Area | Pending Milestone Features | Status |
| :--- | :--- | :--- | :--- |
| **Phase 1** | **Network Accuracy** | Interface Selection (`tun0`/VPN), Independent Up/Down Scaling & Fractional Decimals | Ready to Implement |
| **Phase 2** | **Data Tracking** | Cumulative Session Data Counters (session RX/TX) | Planned |
| **Phase 3** | **i18n & Automation** | Gettext Localization (`po/`), GitHub Actions CI/CD, Makefile developer targets | Planned |

---

## 4. Completed Features & Enhancements

- **v21 Audit & Foundation Overhaul**: Fixed unbounded network loop hang, eliminated multi-gigabyte memory spikes, removed sync bash forks, and optimized file I/O with early-exit procfs parsing.
- **Swap Memory Monitoring (2.1)**: Dedicated SWAP metric section with used/free/percentage tracking, `/proc/meminfo` parsing, and alert threshold coloring.
- **Disk I/O & Storage Utilization (2.2)**: Real-time physical block device read/write throughput rates via `/proc/diskstats`, root (`/`) storage tracking, and threshold warning alerts.
- **GPU Utilization & VRAM Tracking (2.3)**: Multi-GPU support (Auto/Dedicated/Integrated), Intel RC6 sysfs, AMD DRM sysfs, NVIDIA SMI, VRAM tracking, and laptop D3cold sleep preservation.
- **Temperature Unit Selection (2.4)**: Choice of Celsius (`℃`) or Fahrenheit (`℉`) across CPU and GPU sensors with automatic conversion and alert threshold handling.
- **Compact / Minimalist Mode (3.1)**: Minimal bracket display option hiding metric tags to maximize status bar space.
- **Symbolic Icons Option (3.2)**: Modern Unicode indicator mode (`⚙`, `🖥`, `🖴`, `⇄`, `💾`, `🌐`) as a compact visual alternative to text headers.
- **Panel Position & Clock Repositioning (3.3)**: Position RezMon in Left/Center/Right panel boxes with order priority, plus Ubuntu centered clock repositioning with safe restore on extension disable.
- **Customizable Metric Ordering (3.4)**: Dynamic metric sequence evaluation with an interactive move up/down UI in General preferences and one-click reset to default.
- **Rich Hover Tooltip (3.5)**: Instant multiline hardware overview card on hover with CPU/GPU/RAM/SWAP/Disk/Network details, live updates, and non-blocking click-through.
- **Dropdown System Summary Dashboard (4.1)**: Embedded live quick status overview card in the popup menu with progress bars and CPU/RAM/SWAP/GPU/Disk/Network telemetry.
- **Top Resource Consumers (4.2)**: On-demand asynchronous snapshot of top 3 CPU and Memory processes displayed in the menu with zero background overhead.
- **Dynamic System Monitor Launchers (4.3)**: Automatic runtime discovery and launching of graphical monitors (Resources, GNOME System Monitor, Mission Center) and CLI tools (btop, htop) via terminal emulator.
- **Network Interface Selection (5.1)**: User selection of monitored network interfaces (Auto/Default Route, Wi-Fi, Ethernet, VPN tunnels) with live sysfs discovery and offline fallback.
- **Independent Network Scaling & Fractional Decimals (5.2)**: Independent unit scaling for upload and download rates with 1-decimal fractional precision for small values below 10.

---

*Roadmap maintained for RezMon (GNOME Shell 45–51 compatibility).*
