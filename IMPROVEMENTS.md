# RezMon Roadmap & Enhancement Plan (v22+)

> Architectural roadmap, pending feature proposals, and GNOME Shell 45–51 modernization targets for **RezMon (Resource Monitor)**.

---

## Table of Contents

1. [Dropdown Menu Dashboard & Utilities](#1-dropdown-menu-dashboard--utilities)
   - [1.1 Top Resource Consumers (Process Snapshot)](#11-top-resource-consumers-process-snapshot)
   - [1.2 Dynamic Terminal System Monitor Launchers (`btop`, `htop`, `resources`)](#12-dynamic-terminal-system-monitor-launchers-btop-htop-resources)
2. [Network & Data Accuracy Enhancements](#2-network--data-accuracy-enhancements)
   - [2.1 Interface Selection (Auto vs Specific Interface / VPN)](#21-interface-selection-auto-vs-specific-interface--vpn)
   - [2.2 Independent Up/Down Scaling & Fractional Decimals](#22-independent-updown-scaling--fractional-decimals)
   - [2.3 Cumulative Session Traffic Counters](#23-cumulative-session-traffic-counters)
3. [Internationalization, CI/CD & Code Quality](#3-internationalization-cicd--code-quality)
   - [3.1 Gettext Internationalization (i18n / Localization)](#31-gettext-internationalization-i18n--localization)
   - [3.2 Automated GitHub Actions CI & Packaging](#32-automated-github-actions-ci--packaging)
   - [3.3 Developer Tooling & Makefile Targets](#33-developer-tooling--makefile-targets)
4. [Prioritized Implementation Matrix](#4-prioritized-implementation-matrix)
5. [Completed Features & Enhancements](#5-completed-features--enhancements)

---

## 1. Dropdown Menu Dashboard & Utilities

### 1.1 Top Resource Consumers (Process Snapshot)
* **Target Files:** `src/indicator.js`, `src/metrics/top.js`
* **Motivation:**
  When a user notices CPU or RAM spike to 100%, clicking the indicator should immediately identify which process is causing the spike (e.g. `chrome`, `cargo`, `docker`) without opening heavy external tools.
* **Proposed Implementation:**
  - Read top 3 CPU and RAM consumers on dropdown menu open (deferred until menu is toggled, zero background overhead).
  - Display process names and PID/percentage directly in the menu.

### 1.2 Dynamic Terminal System Monitor Launchers (`btop`, `htop`, `resources`)
* **Target Files:** `src/indicator.js`
* **Motivation:**
  Many advanced users use CLI monitors like `btop` or `htop`, or Flatpak apps like `Resources` (`net.lutris.Resources` / `resources`).
* **Proposed Implementation:**
  - Check for existence via `GLib.find_program_in_path()` for `btop`, `htop`, or `resources`.
  - Add quick-launch items in the menu for available terminal or graphical tools.

---

## 2. Network & Data Accuracy Enhancements

### 2.1 Interface Selection (Auto vs Specific Interface / VPN)
* **Target Files:** `src/metrics/net.js`, `src/schemas/...gschema.xml`, `src/prefs.js`
* **Motivation:**
  Currently, RezMon always monitors the default gateway interface. Users working through VPN tunnels (`tun0`, `wg0`), container interfaces (`docker0`), or secondary NICs cannot monitor that traffic.
* **Proposed Implementation:**
  - Add schema key `net-interface` (default: `'auto'`).
  - In `prefs.js`, populate an `Adw.ComboRow` with `'Auto (Default Route)'` plus all detected interfaces from `/proc/net/dev`.
  - In `updateNET()`, if `net-interface !== 'auto'`, track the user-specified interface.

### 2.2 Independent Up/Down Scaling & Fractional Decimals
* **Target Files:** `src/indicator.js`
* **Motivation:**
  Currently, download and upload share a single unit suffix. If upload is 2.5 MB/s and download is 400 KB/s, download is divided by 1024, resulting in `0.39 MB/s`, which `toFixed(0)` truncates to `↓ 00 MB/s`.
* **Proposed Implementation:**
  - Option A: Format each direction with its own unit when units differ: `↓ 400KB/s | ↑ 2.5MB/s`.
  - Option B: Use 1 decimal place (`toFixed(1)`) whenever the value is `< 10` (e.g. `↓ 0.4 | ↑ 2.5 MB/s`).

### 2.3 Cumulative Session Traffic Counters
* **Target Files:** `src/metrics/net.js`, `src/indicator.js`
* **Motivation:**
  Users on metered cellular data or limited internet connections want to know total data consumed during the session.
* **Proposed Implementation:**
  - Track `state.session_rx_bytes` and `state.session_tx_bytes` accumulated over time.
  - Surface in the hover tooltip and dropdown menu.

---

## 3. Internationalization, CI/CD & Code Quality

### 3.1 Gettext Internationalization (i18n / Localization)
* **Target Files:** `po/`, `src/extension.js`, `src/prefs.js`, `src/indicator.js`
* **Motivation:**
  Currently, all UI labels ("Show CPU", "Usage %", "Temperature", "Open Settings", etc.) are hardcoded in English. GNOME Extensions review encourages `gettext` domains.
* **Proposed Implementation:**
  - Initialize `Gettext` using `Extension.initTranslations()`.
  - Wrap UI strings with `_("...")`.
  - Add template `po/rezmon.pot` and `Makefile` target `make pot` / `make mo`.

### 3.2 Automated GitHub Actions CI & Packaging
* **Target Files:** `.github/workflows/ci.yml`, `.github/workflows/release.yml`
* **Motivation:**
  Automates code linting, syntax verification, schema validation, and release zip generation on every PR and git tag.
* **Proposed Workflow:**
  - Lint with ESLint (using GNOME Shell environment preset).
  - Validate XML schema with `xmllint` and compile with `glib-compile-schemas`.
  - Test module imports via `gjs -m`.
  - Build release zip and attach to GitHub Release assets.

### 3.3 Developer Tooling & Makefile Targets
* **Target Files:** `Makefile`
* **Additions:**
  - `make test`: Executes test suite under `gjs`.
  - `make lint`: Runs ESLint / syntax checks across `src/`.
  - `make pot`: Extracts gettext translatable strings into `po/rezmon.pot`.
  - `make clean`: Cleans build artifacts and zip bundles.

---

## 4. Prioritized Implementation Matrix

| Phase | Focus Area | Pending Milestone Features | Status |
| :--- | :--- | :--- | :--- |
| **Phase 1** | **Network Accuracy** | Interface Selection (`tun0`/VPN), Independent Up/Down Scaling & Fractional Decimals | Ready to Implement |
| **Phase 2** | **Dropdown Dashboard** | Dropdown System Summary Card (Done), Top Resource Consumers (CPU/RAM snapshot) | In Progress |
| **Phase 3** | **Utilities & Launchers** | Dynamic CLI / App Monitor Launchers (`btop`, `htop`, `resources`) | Planned |
| **Phase 4** | **Data Tracking** | Cumulative Session Data Counters (session RX/TX) | Planned |
| **Phase 5** | **i18n & Automation** | Gettext Localization (`po/`), GitHub Actions CI/CD, Makefile developer targets | Planned |

---

## 5. Completed Features & Enhancements

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

---

*Roadmap maintained for RezMon (GNOME Shell 45–51 compatibility).*
