# RezMon Roadmap & Enhancement Plan (v22+)

> Comprehensive architectural roadmap, feature proposals, UI/UX polish, and GNOME Shell 45–51 modernization targets for **RezMon (Resource Monitor)**.

---

## Table of Contents

1. [Completed Foundation (v21 Audit Review)](#1-completed-foundation-v21-audit-review)
2. [New Resource Metrics & Sensors](#2-new-resource-metrics--sensors)
   - [2.1 Swap Memory Monitoring](#21-swap-memory-monitoring)
   - [2.2 Disk I/O & Storage Utilization](#22-disk-io--storage-utilization)
   - [2.3 GPU Utilization & VRAM Tracking](#23-gpu-utilization--vram-tracking)
   - [2.4 Temperature Unit Selection (Celsius vs Fahrenheit)](#24-temperature-unit-selection-celsius-vs-fahrenheit)
3. [UI, UX & Panel Customization](#3-ui-ux--panel-customization)
   - [3.1 Compact / Minimalist Mode (Hide Metric Tags)](#31-compact--minimalist-mode-hide-metric-tags)
   - [3.2 Symbolic Icons Option](#32-symbolic-icons-option)
   - [3.3 Panel Position & Ordering (Left, Center, Right)](#33-panel-position--ordering-left-center-right)
   - [3.4 Customizable Metric Ordering](#34-customizable-metric-ordering)
   - [3.5 Rich Hover Tooltip](#35-rich-hover-tooltip)
4. [Dropdown Menu Dashboard & Utilities](#4-dropdown-menu-dashboard--utilities)
   - [4.1 Detailed System Summary Dashboard](#41-detailed-system-summary-dashboard)
   - [4.2 Top Resource Consumers (Process Snapshot)](#42-top-resource-consumers-process-snapshot)
   - [4.3 Dynamic Terminal System Monitor Launchers (`btop`, `htop`, `resources`)](#43-dynamic-terminal-system-monitor-launchers-btop-htop-resources)
5. [Network & Data Accuracy Enhancements](#5-network--data-accuracy-enhancements)
   - [5.1 Interface Selection (Auto vs Specific Interface / VPN)](#51-interface-selection-auto-vs-specific-interface--vpn)
   - [5.2 Independent Up/Down Scaling & Fractional Decimals](#52-independent-updown-scaling--fractional-decimals)
   - [5.3 Cumulative Session Traffic Counters](#53-cumulative-session-traffic-counters)
6. [Internationalization, CI/CD & Code Quality](#6-internationalization-cicd--code-quality)
   - [6.1 Gettext Internationalization (i18n / Localization)](#61-gettext-internationalization-i18n--localization)
   - [6.2 Automated GitHub Actions CI & Packaging](#62-automated-github-actions-ci--packaging)
   - [6.3 Developer Tooling & Makefile Targets](#63-developer-tooling--makefile-targets)
7. [Prioritized Implementation Matrix](#7-prioritized-implementation-matrix)

---

## 1. Completed Foundation (v21 Audit Review)

The core stability and performance overhaul has been completed and merged into `main`:
- **Stability Fixes:** Fixed unbounded network formatting `while` loop, eliminated multi-gigabyte startup spikes, cleaned up zombie background timers and signal memory leaks, and prevented `NaN` / `lo` loopback errors.
- **Performance Overhaul:** Eliminated synchronous subprocess forks (`bash -c "ip route..."`), gated procfs reads behind metric toggles, optimized file I/O with `GLib.file_get_contents` and shared `TextDecoder`, and added early-exit `/proc/meminfo` parsing.
- **UI & Settings:** Added alert threshold `Adw.SpinRow` controls, CPU temperature & RAM threshold coloring, Pango markup sanitization, fallback panel label, System Monitor launcher, and EGO-compliant build rules.

---

## 2. New Resource Metrics & Sensors

### 2.1 Swap Memory Monitoring (Completed)
* **Target Files:** `src/schemas/...gschema.xml`, `src/metrics/swap.js`, `src/prefs.js`, `src/indicator.js`
* **Status:** Implemented as a dedicated metric section (`SWAP`) with toggles for `show-swap`, `swap-used`, `swap-free`, and `swap-percent`, `/proc/meminfo` parsing, and alert threshold coloring.

### 2.2 Disk I/O & Storage Utilization
* **Target Files:** `src/metrics/disk.js`, `src/schemas/...gschema.xml`, `src/indicator.js`
* **Motivation:**
  Disk bottlenecks (e.g., heavy file indexing, package upgrades, Docker builds) frequently cause UI stutter that CPU/RAM monitors do not explain.
* **Proposed Implementation:**
  - Create `src/metrics/disk.js` parsing `/proc/diskstats` for sectors read/written on the primary root storage device.
  - Compute read/write transfer rates (e.g., `DISK[R: 12MB/s | W: 45MB/s]` or root partition free space `DISK[45G free]`).
  - Provide a toggle in settings under a new **Disk** preferences page.

### 2.3 GPU Utilization & VRAM Tracking (Completed)
* **Target Files:** `src/metrics/gpu.js`, `src/schemas/...gschema.xml`, `src/prefs.js`, `src/indicator.js`
* **Status:** Implemented and integrated with Multi-GPU selection (Auto, Dedicated, Integrated), D3cold sleep preservation for laptop hybrid graphics, Intel iGPU sysfs RC6 residency & package thermal fallback, AMD DRM sysfs, NVIDIA SMI metrics, and threshold coloring for temperature and VRAM.

### 2.4 Temperature Unit Selection (Celsius vs Fahrenheit)
* **Target Files:** `src/schemas/...gschema.xml`, `src/indicator.js`, `src/prefs.js`
* **Motivation:**
  Celsius is standard in Linux, but many users in North America and international regions prefer Fahrenheit.
* **Proposed Implementation:**
  - Add `temp-unit` enum key in `gschema.xml`: `'celsius'` (default) or `'fahrenheit'`.
  - In `_formatCPU()`: if `this.tempUnit === 'fahrenheit'`, convert via `(temp * 9/5) + 32` and append `℉`.
  - Update `temp-warn-threshold` and `temp-crit-threshold` in settings to adapt to the active unit.

---

## 3. UI, UX & Panel Customization

### 3.1 Compact / Minimalist Mode (Hide Metric Tags)
* **Target Files:** `src/indicator.js`, `src/prefs.js`, `src/schemas/...gschema.xml`
* **Motivation:**
  On compact laptop displays (13"–14") or setups with centered GNOME dash docks, horizontal top bar real estate is precious. Displaying `CPU`, `RAM`, and `NET` tags takes up ~12–16 characters of unnecessary horizontal padding.
* **Proposed Implementation:**
  - Add boolean key `compact-mode` in schema (default: `false`).
  - When enabled, format strings without tag prefixes:
    - Normal: `CPU[12% | 3.50GHz]  RAM[4.5G]  NET[↓ 02 | ↑ 00]MB/s`
    - Compact: `[12% | 3.50GHz]  [4.5G]  [↓ 02 | ↑ 00]MB/s`

### 3.2 Symbolic Icons Option
* **Target Files:** `src/indicator.js`, `src/prefs.js`
* **Motivation:**
  Adhering to GNOME Human Interface Guidelines (HIG), symbolic monochrome icons provide a cleaner, integrated visual aesthetic.
* **Proposed Implementation:**
  - Add appearance choice: `label-style` (`'text'`, `'icons'`, `'none'`).
  - When `'icons'` is selected, replace text headers with embedded Pango icon characters or St.Icon widgets (`cpu-symbolic`, `drive-harddisk-symbolic`, `network-transmit-receive-symbolic`).

### 3.3 Panel Position & Ordering (Left, Center, Right)
* **Target Files:** `src/extension.js`, `src/prefs.js`, `src/schemas/...gschema.xml`
* **Motivation:**
  `Main.panel.addToStatusArea('RezMon', this._indicator)` currently places the indicator into the right status area at default index. Users often prefer centering system stats or grouping them on the left next to Workspaces.
* **Proposed Implementation:**
  - Add `panel-position` setting (`'right'`, `'center'`, `'left'`) and `panel-priority` (integer index).
  - Re-attach indicator dynamically when this setting changes without requiring extension restart.

### 3.4 Customizable Metric Ordering
* **Target Files:** `src/indicator.js`, `src/prefs.js`
* **Motivation:**
  Users have different priorities (e.g. network engineers want `NET` first; developers want `RAM` first).
* **Proposed Implementation:**
  - Add string array key `metric-order` in schema: `['cpu', 'ram', 'net']`.
  - Iterate through `this.metricOrder` dynamically in `_updateMetrics()`.

### 3.5 Rich Hover Tooltip
* **Target Files:** `src/indicator.js`
* **Motivation:**
  Top bar space only shows abbreviated metrics. Hovering with the mouse cursor should reveal detailed context without opening menus.
* **Proposed Implementation:**
  - Attach a tooltip to `this` or `this.box` using `Clutter.Actor` hover signals or St.Tooltip:
    ```
    Model: AMD Ryzen 7 7840HS (16 Cores) @ 3.80 GHz
    CPU Load: 14% | Package Temp: 48°C
    Memory: 18.2 GB / 31.2 GB (58% Used)
    Network: wlp1s0 (192.168.1.105) | Gateway: 192.168.1.1
    ```

---

## 4. Dropdown Menu Dashboard & Utilities

### 4.1 Detailed System Summary Dashboard
* **Target Files:** `src/indicator.js`
* **Motivation:**
  The panel dropdown menu currently contains only "System Monitor" and "Open Settings". The dropdown popup is ideal for displaying a clean, read-only system summary card.
* **Proposed Layout:**
  ```
  +-------------------------------------------------+
  | RezMon Quick Status                             |
  +-------------------------------------------------+
  | CPU:  Intel Core i7-13700H (14 cores, 20 threads)|
  | Clock: 4.20 GHz max | Core Temp: 54°C            |
  |                                                 |
  | Memory:                                         |
  | [████████████░░░░░░░░░░░░░░░░░░] 8.2G / 16.0G   |
  | Swap: 0.2G / 8.0G | Buffers/Cached: 4.1G        |
  |                                                 |
  | Network:                                        |
  | Interface: wlp0s20f3 (WiFi)                     |
  | Local IP: 192.168.1.42                          |
  | Session Total: ↓ 1.4 GB | ↑ 320 MB              |
  +-------------------------------------------------+
  | [ Launch System Monitor ]  [ Extension Settings ]|
  +-------------------------------------------------+
  ```

### 4.2 Top Resource Consumers (Process Snapshot)
* **Target Files:** `src/indicator.js`, `src/metrics/top.js`
* **Motivation:**
  When a user notices CPU or RAM spike to 100%, clicking the indicator should immediately identify which process is causing the spike (e.g. `chrome`, `cargo`, `docker`) without opening heavy external tools.
* **Proposed Implementation:**
  - Read top 3 CPU and RAM consumers on dropdown menu open (deferred until menu is toggled, zero background overhead).
  - Display process names and PID/percentage directly in the menu.

### 4.3 Dynamic Terminal System Monitor Launchers (`btop`, `htop`, `resources`)
* **Target Files:** `src/indicator.js`
* **Motivation:**
  Many advanced users use CLI monitors like `btop` or `htop`, or Flatpak apps like `Resources` (`net.lutris.Resources` / `resources`).
* **Proposed Implementation:**
  - Check for existence via `GLib.find_program_in_path()` for `btop`, `htop`, or `resources`.
  - Add quick-launch items in the menu for available terminal or graphical tools.

---

## 5. Network & Data Accuracy Enhancements

### 5.1 Interface Selection (Auto vs Specific Interface / VPN)
* **Target Files:** `src/metrics/net.js`, `src/schemas/...gschema.xml`, `src/prefs.js`
* **Motivation:**
  Currently, RezMon always monitors the default gateway interface. Users working through VPN tunnels (`tun0`, `wg0`), container interfaces (`docker0`), or secondary NICs cannot monitor that traffic.
* **Proposed Implementation:**
  - Add schema key `net-interface` (default: `'auto'`).
  - In `prefs.js`, populate an `Adw.ComboRow` with `'Auto (Default Route)'` plus all detected interfaces from `/proc/net/dev`.
  - In `updateNET()`, if `net-interface !== 'auto'`, track the user-specified interface.

### 5.2 Independent Up/Down Scaling & Fractional Decimals
* **Target Files:** `src/indicator.js`
* **Motivation:**
  Currently, download and upload share a single unit suffix. If upload is 2.5 MB/s and download is 400 KB/s, download is divided by 1024, resulting in `0.39 MB/s`, which `toFixed(0)` truncates to `↓ 00 MB/s`.
* **Proposed Implementation:**
  - Option A: Format each direction with its own unit when units differ: `↓ 400KB/s | ↑ 2.5MB/s`.
  - Option B: Use 1 decimal place (`toFixed(1)`) whenever the value is `< 10` (e.g. `↓ 0.4 | ↑ 2.5 MB/s`).

### 5.3 Cumulative Session Traffic Counters
* **Target Files:** `src/metrics/net.js`, `src/indicator.js`
* **Motivation:**
  Users on metered cellular data or limited internet connections want to know total data consumed during the session.
* **Proposed Implementation:**
  - Track `state.session_rx_bytes` and `state.session_tx_bytes` accumulated over time.
  - Surface in the hover tooltip and dropdown menu.

---

## 6. Internationalization, CI/CD & Code Quality

### 6.1 Gettext Internationalization (i18n / Localization)
* **Target Files:** `po/`, `src/extension.js`, `src/prefs.js`, `src/indicator.js`
* **Motivation:**
  Currently, all UI labels ("Show CPU", "Usage %", "Temperature", "Open Settings", etc.) are hardcoded in English. GNOME Extensions review encourages `gettext` domains.
* **Proposed Implementation:**
  - Initialize `Gettext` using `Extension.initTranslations()`.
  - Wrap UI strings with `_("...")`.
  - Add template `po/rezmon.pot` and `Makefile` target `make pot` / `make mo`.

### 6.2 Automated GitHub Actions CI & Packaging
* **Target Files:** `.github/workflows/ci.yml`, `.github/workflows/release.yml`
* **Motivation:**
  Automates code linting, syntax verification, schema validation, and release zip generation on every PR and git tag.
* **Proposed Workflow:**
  - Lint with ESLint (using GNOME Shell environment preset).
  - Validate XML schema with `xmllint` and compile with `glib-compile-schemas`.
  - Test module imports via `gjs -m`.
  - Build release zip and attach to GitHub Release assets.

### 6.3 Developer Tooling & Makefile Targets
* **Target Files:** `Makefile`
* **Additions:**
  - `make test`: Executes test suite under `gjs`.
  - `make lint`: Runs ESLint / syntax checks across `src/`.
  - `make pot`: Extracts gettext translatable strings into `po/rezmon.pot`.
  - `make clean`: Cleans build artifacts and zip bundles.

---

## 7. Prioritized Implementation Matrix

| Phase | Milestone | Features Included | Effort / Impact |
| :--- | :--- | :--- | :--- |
| **Phase 1** | **Quick Wins & Visual Polish** | • Temperature Unit (°C vs °F)<br>• Compact Mode (Hide tags)<br>• Fractional decimal / independent net units | **Low Effort / High User Impact** |
| **Phase 2** | **New Metric Expansions** | • Swap Memory monitoring (`swap-used`, `swap-percent`)<br>• Network interface selector (Auto vs VPN/tun0)<br>• Disk I/O throughput | **Medium Effort / High Utility** |
| **Phase 3** | **Interactive Dropdown & Tooltip** | • System overview card in dropdown popup<br>• Informative hover tooltip<br>• Terminal monitor launchers (`btop`/`htop`) | **Medium Effort / Major UX Upgrade** |
| **Phase 4** | **Hardware & Power Metrics** | • GPU monitoring (Completed: Intel/AMD sysfs, NVIDIA SMI, multi-GPU)<br>• Power profile / governor status | **Medium Effort / Niche Hardware** |
| **Phase 5** | **Ecosystem & Community** | • Gettext i18n localization (`po/`)<br>• GitHub Actions CI/CD workflow<br>• Full JSDoc / ESLint integration | **Low Effort / Long-term Quality** |

---

*Roadmap maintained for RezMon (GNOME Shell 45–51 compatibility).*
