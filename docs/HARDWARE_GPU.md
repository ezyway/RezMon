# Hardware & Telemetry Architecture

RezMon is engineered for high-performance, battery-conscious system monitoring on Linux and GNOME Shell. It relies directly on Linux kernel interfaces (`/proc` and `/sys`) to deliver accurate hardware telemetry with zero background daemon overhead and zero compositor stutters.

---

## 1. Multi-GPU & VRAM Architecture

RezMon supports discrete and integrated GPUs across **NVIDIA**, **AMD Radeon**, and **Intel Graphics**.

### GPU Device Selection Modes
In the extension preferences under the **GPU** page, you can choose how GPUs are tracked:
- **Auto (Dedicated when Active)** *(Default)*: Prioritizes discrete graphics (NVIDIA or AMD dGPU) when actively processing workloads, but seamlessly falls back to integrated graphics (Intel Iris/Xe or AMD APU) when the discrete GPU enters power-saving sleep.
- **Dedicated GPU**: Exclusively monitors discrete graphics.
- **Integrated GPU**: Exclusively monitors integrated graphics.

### NVIDIA Graphics
- **Asynchronous Telemetry**: RezMon queries `nvidia-smi` asynchronously via `Gio.Subprocess`, eliminating main-thread blocking and frame drops in Wayland desktop animations.
- **D3cold Power Preservation**: On hybrid laptops (NVIDIA Optimus), executing commands against a sleeping discrete GPU would spin up the dGPU, draining battery. RezMon checks the PCI device power state at `/sys/bus/pci/drivers/nvidia/*/power/runtime_status`:
  - When the status is `suspended`, RezMon displays `(D3cold Sleep)` without spawning `nvidia-smi`.
  - Only when the GPU wakes up to handle graphics workloads does active polling resume.
- **Tracked NVIDIA Metrics**: Core usage %, core clock (MHz/GHz), package temperature (℃/℉), and VRAM (Used, Free, %).

### AMD Radeon Graphics
- **DRM Sysfs Telemetry**: Reads GPU engine load directly from `/sys/class/drm/card*/device/gpu_busy_percent`.
- **Clock & Thermal**: Reads graphics clock frequency from `current_gfxclk` and temperature sensors via `/sys/class/drm/card*/device/hwmon/`.
- **VRAM Tracking**:
  - Discrete AMD cards: Reads dedicated video memory from `mem_info_vram_used` and `mem_info_vram_total`.
  - Integrated APUs: Automatically calculates shared UMA DRM GEM memory allocation against system memory.

### Intel Graphics (i915 & Xe)
- **RC6 Residency Usage**: In modern Intel integrated GPUs without a raw busy percentage sysfs node, RezMon samples the hardware power management RC6 residency (`rc6_residency_ms`) over elapsed monotonic time to compute engine activity:
  $$\text{Usage \%} = \frac{\Delta t - \Delta \text{RC6}}{\Delta t} \times 100$$
- **Frequency**: Tracks active and current GPU frequency from `gt_act_freq_mhz` or `gt_cur_freq_mhz`.
- **VRAM**: Supports Intel discrete cards with dedicated Local Memory (`lmem_total_bytes`) as well as integrated graphics using Linux DRM GEM shared RAM.

---

## 2. CPU Telemetry & Thermal Discovery

RezMon collects CPU statistics with minimal kernel context switching:

- **CPU Usage %**: Evaluates the cumulative work and idle jiffies in `/proc/stat` across ticks using monotonic intervals:
  $$\text{CPU Usage} = \frac{\Delta \text{Used}}{\Delta \text{Total}} \times 100$$
- **Clock Speed (GHz)**:
  1. Queries the active kernel cpufreq interface at `/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq` or `/sys/devices/system/cpu/cpufreq/policy0/scaling_cur_freq`.
  2. If unavailable, averages core frequencies across `/proc/cpuinfo`.
- **Thermal Sensor Discovery**:
  RezMon scans system thermal zones and caches the optimal sensor path to prevent repetitive sysfs disk traversal:
  1. Preferred package sensors: `x86_pkg_temp`, `coretemp`, `k10temp`, `cpu_thermal`, `soc_thermal`.
  2. Generic fallback: `/sys/class/thermal/thermal_zone*/temp`.
  3. Hardware monitor fallback: `/sys/class/hwmon/hwmon*/temp*_input`.

---

## 3. Memory & SWAP Telemetry

- **RAM**: Parsed via `/proc/meminfo` in a single pass with early exit once `MemTotal` and `MemAvailable` are found. Used memory is accurately computed as:
  $$\text{Used RAM} = \text{MemTotal} - \text{MemAvailable}$$
- **SWAP**: Reads `SwapTotal` and `SwapFree`. If swap is disabled or no swapfile exists, SWAP metrics are cleanly hidden from both the status bar and the dropdown dashboard.

---

## 4. Disk I/O Throughput & Storage Capacity

- **Real-Time Throughput**: Computes read and write data rates by sampling 512-byte sector deltas in `/proc/diskstats`.
- **Physical Device Filtering**: Discovers and caches block devices in `/sys/block`, filtering out virtual loopbacks (`loop*`), memory-backed disks (`ram*`), and swap devices (`zram*`) to measure only physical storage drives (NVMe, SSD, HDD).
- **Storage Capacity**: Queries the root filesystem (`/`) through `GFile.query_filesystem_info` to report used space, free space, and storage percentage.

---

## 5. Network Interface Routing & Telemetry

- **Default Route Priority**: Parses `/proc/net/route` and evaluates route metric flags to identify the system's primary default gateway interface (prioritizing active Wi-Fi or Ethernet over secondary virtual bridges).
- **Interface Selection**: Users can bind monitoring to a specific network interface (e.g., `wlp0s20f3`, `enp7s0`, or VPN tunnels such as `tun0`, `wg0`).
- **Throughput Rates**: Computes RX/TX byte deltas from `/proc/net/dev`. Independent scaling formats download and upload speeds with 1-decimal fractional precision for low speeds below 10 (e.g. `1.5 MB/s`).

