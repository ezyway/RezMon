'use strict';

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import { Button } from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { PopupMenuItem, PopupBaseMenuItem, PopupSeparatorMenuItem } from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { uiGroup } from 'resource:///org/gnome/shell/ui/main.js';

import { readFileLines } from './utils/file.js';
import { updateCPU } from './metrics/cpu.js';
import { updateGPU } from './metrics/gpu.js';
import { updateRAM } from './metrics/ram.js';
import { updateSWAP } from './metrics/swap.js';
import { updateDisk } from './metrics/disk.js';
import { updateNET } from './metrics/net.js';
import { getTopProcesses } from './metrics/top.js';

export class RezMonIndicator extends Button {

    _init(extension, settings) {
        super._init(0, "RezMon", false);

        this._extension = extension;
        this._settings = settings;

        this.box = new St.BoxLayout();

        this.label = new St.Label({
            text: "Loading...",
            y_align: Clutter.ActorAlign.CENTER,
            style: 'margin-right: 12px;',
        });

        this.label.clutter_text.set_use_markup(true);

        this.box.add_child(this.label);
        this.add_child(this.box);

        this._initValues();
        this._bindSettings();
        this._buildMenu();
        this._initTooltip();

        this._updateMetrics();
    }

    _initValues() {

        this.prev_time = null;
        this.prev_tx_bytes = 0;
        this.prev_rx_bytes = 0;
        this.prev_iface = null;

        this.prev_used = 0;
        this.prev_total = 0;

        this.prev_disk_read = 0;
        this.prev_disk_write = 0;
        this.prev_disk_time = 0;
    }

    _buildMenu() {

        this.menu.removeAll();

        // 1. Dashboard summary card
        this._dashboardItem = new PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'rezmon-menu-dashboard',
        });
        this._dashboardLabel = new St.Label({
            style: 'padding: 4px 6px; min-width: 320px; font-size: 9.5pt; line-height: 1.4;',
        });
        this._dashboardLabel.clutter_text.set_use_markup(true);
        this._dashboardItem.add_child(this._dashboardLabel);
        this.menu.addMenuItem(this._dashboardItem);

        // 2. Separator
        this.menu.addMenuItem(new PopupSeparatorMenuItem());

        // 3. Dynamic System Monitor Launchers
        const monitors = this._getAvailableMonitors();
        for (const mon of monitors) {
            const item = new PopupMenuItem(mon.name);
            item.connect('activate', () => mon.launch());
            this.menu.addMenuItem(item);
        }

        // 4. Open Settings
        const settingsItem = new PopupMenuItem("Open Settings");
        settingsItem.connect('activate', () => {
            this._extension.openPreferences();
        });
        this.menu.addMenuItem(settingsItem);

        // Update dashboard whenever menu opens
        this.menu.connectObject('open-state-changed', (menu, isOpen) => {
            if (isOpen) {
                this._updateDashboard();
                getTopProcesses().then((top) => {
                    this._topProcesses = top;
                    this._updateDashboard();
                }).catch(() => {});
            }
        }, this);
    }

    _getAvailableMonitors() {
        const monitors = [];

        // Graphical Monitors
        if (GLib.find_program_in_path('gnome-system-monitor')) {
            monitors.push({
                name: 'GNOME System Monitor',
                launch: () => this._launchApp('gnome-system-monitor'),
            });
        }
        if (GLib.find_program_in_path('resources')) {
            monitors.push({
                name: 'Resources Monitor',
                launch: () => this._launchApp('resources'),
            });
        }
        if (GLib.find_program_in_path('mission-center') || GLib.find_program_in_path('io.missioncenter.MissionCenter')) {
            const bin = GLib.find_program_in_path('mission-center') ? 'mission-center' : 'io.missioncenter.MissionCenter';
            monitors.push({
                name: 'Mission Center',
                launch: () => this._launchApp(bin),
            });
        }

        // Terminal Monitors
        if (GLib.find_program_in_path('btop')) {
            monitors.push({
                name: 'btop (Terminal)',
                launch: () => this._launchTerminal('btop'),
            });
        }
        if (GLib.find_program_in_path('htop')) {
            monitors.push({
                name: 'htop (Terminal)',
                launch: () => this._launchTerminal('htop'),
            });
        }

        // Fallback default
        if (monitors.length === 0) {
            monitors.push({
                name: 'System Monitor',
                launch: () => this._launchApp('gnome-system-monitor'),
            });
        }

        return monitors;
    }

    _launchApp(cmdLine) {
        try {
            const app = Gio.AppInfo.create_from_commandline(
                cmdLine,
                null,
                Gio.AppInfoCreateFlags.NONE
            );
            if (app)
                app.launch([], null);
        } catch (e) {
            logError(e);
        }
    }

    _launchTerminal(cmd) {
        const terminals = [
            { bin: 'ptyxis', arg: '--' },
            { bin: 'kgx', arg: '-e' },
            { bin: 'gnome-terminal', arg: '--' },
            { bin: 'x-terminal-emulator', arg: '-e' },
            { bin: 'xterm', arg: '-e' },
        ];
        for (const t of terminals) {
            if (GLib.find_program_in_path(t.bin)) {
                this._launchApp(`${t.bin} ${t.arg} ${cmd}`);
                return true;
            }
        }
        return false;
    }

    _updateDashboard() {
        if (!this._dashboardLabel) return;
        const markup = this._generateDashboardMarkup();
        this._dashboardLabel.clutter_text.set_markup(markup);
    }

    _makeProgressBar(percent, length = 14) {
        const clamped = Math.max(0, Math.min(100, Math.round(percent)));
        const filled = Math.round((clamped / 100) * length);
        const empty = length - filled;
        return '█'.repeat(filled) + '░'.repeat(empty);
    }

    _generateDashboardMarkup() {
        const lines = [];

        // Title
        lines.push(`<b><big>System Status Overview</big></b>`);
        lines.push(``);

        // CPU
        const cpu = this._lastMetrics?.cpu || updateCPU(this);
        const cpuInfo = this._getCpuHardwareInfo();
        const cpuPct = Number.isFinite(cpu?.usage) ? Math.round(cpu.usage) : 0;
        const cpuBar = this._makeProgressBar(cpuPct, 14);
        const cpuClock = Number.isFinite(cpu?.clock) ? `  │  ${cpu.clock.toFixed(2)} GHz` : '';
        const cpuTemp = Number.isFinite(cpu?.temp) ? `  │  ${this._formatTemperature(cpu.temp)}` : '';
        lines.push(`<b>CPU</b>  <span alpha="70%">${GLib.markup_escape_text(cpuInfo.model, -1)}</span>`);
        lines.push(`  <span font_family="monospace">${cpuBar}</span> <b>${cpuPct}%</b>${cpuClock}${cpuTemp}`);

        // Memory (RAM)
        const ram = this._lastMetrics?.ram || updateRAM(this);
        if (ram) {
            const ramPct = Number.isFinite(ram.percent) ? Math.round(ram.percent) : 0;
            const ramBar = this._makeProgressBar(ramPct, 14);
            const ramUsed = (ram.used || 0).toFixed(1);
            const ramTotal = ((ram.used || 0) + (ram.free || 0)).toFixed(1);
            const ramFree = (ram.free || 0).toFixed(1);
            lines.push(``);
            lines.push(`<b>RAM</b>  <b>${ramUsed} GB</b> / ${ramTotal} GB (<span alpha="70%">Free: ${ramFree} GB</span>)`);
            lines.push(`  <span font_family="monospace">${ramBar}</span> <b>${ramPct}%</b>`);
        }

        // SWAP
        const swap = this._lastMetrics?.swap || updateSWAP(this);
        if (swap && swap.hasSwap) {
            const swapPct = Number.isFinite(swap.percent) ? Math.round(swap.percent) : 0;
            const swapBar = this._makeProgressBar(swapPct, 14);
            const swapUsed = (swap.used || 0).toFixed(1);
            const swapTotal = ((swap.used || 0) + (swap.free || 0)).toFixed(1);
            lines.push(``);
            lines.push(`<b>SWAP</b>  <b>${swapUsed} GB</b> / ${swapTotal} GB`);
            lines.push(`  <span font_family="monospace">${swapBar}</span> <b>${swapPct}%</b>`);
        }

        // GPU
        const gpu = this._lastMetrics?.gpu || updateGPU(this);
        if (gpu) {
            const gpuTitle = gpu.name ? GLib.markup_escape_text(gpu.name, -1) : 'GPU';
            lines.push(``);
            if (gpu.sleeping) {
                lines.push(`<b>GPU</b>  <span alpha="70%">${gpuTitle}</span> <span alpha="50%">(D3cold Sleep)</span>`);
            } else {
                const gpuPct = Number.isFinite(gpu.usage) ? Math.round(gpu.usage) : 0;
                const gpuBar = this._makeProgressBar(gpuPct, 14);
                const gpuTemp = Number.isFinite(gpu.temp) ? `  │  ${this._formatTemperature(gpu.temp)}` : '';
                const vram = Number.isFinite(gpu.vramUsed) ? `  │  VRAM: <b>${gpu.vramUsed.toFixed(1)}G</b>` : '';
                lines.push(`<b>GPU</b>  <span alpha="70%">${gpuTitle}</span>`);
                lines.push(`  <span font_family="monospace">${gpuBar}</span> <b>${gpuPct}%</b>${gpuTemp}${vram}`);
            }
        }

        // Storage / Root Filesystem
        const disk = this._lastMetrics?.disk || updateDisk(this);
        if (disk) {
            const diskPct = Number.isFinite(disk.spacePercent) ? Math.round(disk.spacePercent) : 0;
            const diskBar = this._makeProgressBar(diskPct, 14);
            const usedStr = this._formatDiskCapacity(disk.spaceUsed || 0);
            const totalStr = this._formatDiskCapacity((disk.spaceUsed || 0) + (disk.spaceFree || 0));
            const rRate = this._formatDataRate(disk.read || 0);
            const wRate = this._formatDataRate(disk.write || 0);
            lines.push(``);
            lines.push(`<b>Storage (/)</b>  <b>${usedStr}</b> / ${totalStr}`);
            lines.push(`  <span font_family="monospace">${diskBar}</span> <b>${diskPct}%</b>  │  I/O: R ${rRate}  W ${wRate}`);
        }

        // Network
        const net = this._lastMetrics?.net || updateNET(this);
        if (net) {
            const iface = this.prev_iface || 'Active';
            const down = this._formatDataRate(net.down || 0);
            const up = this._formatDataRate(net.up || 0);
            lines.push(``);
            lines.push(`<b>Network (${GLib.markup_escape_text(iface, -1)})</b>  ↓ <b>${down}</b>  │  ↑ <b>${up}</b>`);
        }

        // Top Resource Consumers
        if (this._topProcesses) {
            lines.push(``);
            lines.push(`<b>Top Consumers</b>`);
            if (this._topProcesses.topCpu && this._topProcesses.topCpu.length > 0) {
                const cpuItems = this._topProcesses.topCpu.map(p =>
                    `<span alpha="75%">${GLib.markup_escape_text(p.name, -1)}</span> <b>${Math.round(p.cpu)}%</b>`
                );
                lines.push(`  CPU: ${cpuItems.join('  │  ')}`);
            }
            if (this._topProcesses.topMem && this._topProcesses.topMem.length > 0) {
                const memItems = this._topProcesses.topMem.map(p =>
                    `<span alpha="75%">${GLib.markup_escape_text(p.name, -1)}</span> <b>${p.mem.toFixed(1)}%</b>`
                );
                lines.push(`  RAM: ${memItems.join('  │  ')}`);
            }
        }

        return lines.join('\n');
    }

    _bindSettings() {
        this._settingsChangedId = this._settings.connect('changed', () => {
            this._reloadSettings();
        });

        this._reloadSettings();
    }

    _reloadSettings() {

        // visibility
        this.showCPU = this._settings.get_boolean('show-cpu');
        this.showGPU = this._settings.get_boolean('show-gpu');
        this.showRAM = this._settings.get_boolean('show-ram');
        this.showSWAP = this._settings.get_boolean('show-swap');
        this.showDisk = this._settings.get_boolean('show-disk');
        this.showNET = this._settings.get_boolean('show-net');

        // cpu toggles
        this.cpuUsage = this._settings.get_boolean('cpu-usage');
        this.cpuClock = this._settings.get_boolean('cpu-clock');
        this.cpuTemp  = this._settings.get_boolean('cpu-temp');

        // gpu toggles
        this.gpuDevice = this._settings.get_string('gpu-device');
        this.gpuUsage = this._settings.get_boolean('gpu-usage');
        this.gpuClock = this._settings.get_boolean('gpu-clock');
        this.gpuTemp  = this._settings.get_boolean('gpu-temp');
        this.gpuVramUsed = this._settings.get_boolean('gpu-vram-used');
        this.gpuVramFree = this._settings.get_boolean('gpu-vram-free');
        this.gpuVramPercent = this._settings.get_boolean('gpu-vram-percent');

        // ram toggles
        this.ramUsed = this._settings.get_boolean('ram-used');
        this.ramFree = this._settings.get_boolean('ram-free');
        this.ramPercent = this._settings.get_boolean('ram-percent');

        // swap toggles
        this.swapUsed = this._settings.get_boolean('swap-used');
        this.swapFree = this._settings.get_boolean('swap-free');
        this.swapPercent = this._settings.get_boolean('swap-percent');

        // disk toggles
        this.diskRead = this._settings.get_boolean('disk-read');
        this.diskWrite = this._settings.get_boolean('disk-write');
        this.diskSpaceUsed = this._settings.get_boolean('disk-space-used');
        this.diskSpaceFree = this._settings.get_boolean('disk-space-free');
        this.diskSpacePercent = this._settings.get_boolean('disk-space-percent');

        // net toggles
        this.netInterface = this._settings.get_string('net-interface') || 'auto';
        this.netDown = this._settings.get_boolean('net-down');
        this.netUp   = this._settings.get_boolean('net-up');

        // appearance
        const raw_b_open = this._settings.get_string("b-open") || "";
        const raw_b_close = this._settings.get_string("b-close") || "";
        const raw_delimiter = this._settings.get_string("delimiter") || "";

        this.b_open = GLib.markup_escape_text(raw_b_open, -1);
        this.b_close = GLib.markup_escape_text(raw_b_close, -1);
        this.delimiter = GLib.markup_escape_text(raw_delimiter, -1);

        const spacingMap = {
            small: "  ",
            normal: "    ",
            wide: "        "
        };

        this.spacing = spacingMap[this._settings.get_string("spacing")] || "    ";
        this.tempUnit = this._settings.get_string("temp-unit") || "celsius";
        this.labelStyle = this._settings.get_string("label-style") || "text";

        // metric ordering
        const savedOrder = this._settings.get_strv('metric-order');
        const defaultOrder = ['cpu', 'gpu', 'ram', 'swap', 'disk', 'net'];
        this.metricOrder = (savedOrder && savedOrder.length > 0) ? [...savedOrder] : [...defaultOrder];
        for (const m of defaultOrder) {
            if (!this.metricOrder.includes(m))
                this.metricOrder.push(m);
        }

        // thresholds
        this.warnThreshold = this._settings.get_int('warn-threshold') || 70;
        this.critThreshold = this._settings.get_int('crit-threshold') || 90;

        this.tempWarnThreshold = this._settings.get_int('temp-warn-threshold') || 75;
        this.tempCritThreshold = this._settings.get_int('temp-crit-threshold') || 85;

        this.interval = this._settings.get_int("update-interval") || 1;
        this.showTooltip = this._settings.get_boolean('show-tooltip');
        if (!this.showTooltip)
            this._hideTooltip();

        this._restartLoop();
    }

    _restartLoop() {

        if (this._timeout)
            GLib.source_remove(this._timeout);

        this._timeout = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT_IDLE,
            this.interval,
            () => {
                this._updateMetrics();
                return true;
            }
        );
    }

    _updateMetrics() {

        const parts = [];

        if (!this._lastMetrics)
            this._lastMetrics = {};

        const metricUpdaters = {
            cpu: () => {
                if (!this.showCPU) return null;
                const cpu = updateCPU(this);
                this._lastMetrics.cpu = cpu;
                return this._formatCPU(cpu);
            },
            gpu: () => {
                if (!this.showGPU) return null;
                const gpu = updateGPU(this);
                this._lastMetrics.gpu = gpu;
                return this._formatGPU(gpu);
            },
            ram: () => {
                if (!this.showRAM) return null;
                const ram = updateRAM(this);
                this._lastMetrics.ram = ram;
                return this._formatRAM(ram);
            },
            swap: () => {
                if (!this.showSWAP) return null;
                const swap = updateSWAP(this);
                this._lastMetrics.swap = swap;
                return this._formatSWAP(swap);
            },
            disk: () => {
                if (!this.showDisk) return null;
                const disk = updateDisk(this);
                this._lastMetrics.disk = disk;
                return this._formatDisk(disk);
            },
            net: () => {
                if (!this.showNET) return null;
                const net = updateNET(this);
                this._lastMetrics.net = net;
                return this._formatNET(net);
            },
        };

        const currentOrder = this.metricOrder || ['cpu', 'gpu', 'ram', 'swap', 'disk', 'net'];
        for (const metric of currentOrder) {
            const updater = metricUpdaters[metric];
            if (updater) {
                const formatted = updater();
                if (formatted)
                    parts.push(formatted);
            }
        }

        if (parts.length > 0)
            this.label.clutter_text.set_markup(parts.join(this.spacing));
        else
            this.label.clutter_text.set_markup("RezMon");

        if (this._tooltipActor && this._tooltipActor.visible) {
            const markup = this._generateTooltipMarkup();
            if (markup)
                this._tooltipActor.clutter_text.set_markup(markup);
        }
    }

    /*
    ------------------------
    COLOR HELPER
    ------------------------
    */

    _getColor(value) {

        if (value === null || value === undefined)
            return null;

        if (value >= this.critThreshold)
            return "#ff5555"; // red

        if (value >= this.warnThreshold)
            return "#f1c40f"; // yellow

        return null;
    }

    _getTempColor(value) {

        if (value === null || value === undefined)
            return null;

        if (value >= this.tempCritThreshold)
            return "#ff5555"; // red

        if (value >= this.tempWarnThreshold)
            return "#f1c40f"; // yellow

        return null;
    }

    _formatTemperature(tempC) {

        if (!Number.isFinite(tempC))
            return null;

        const color = this._getTempColor(tempC);
        let val = tempC;
        let sym = "℃";

        if (this.tempUnit === 'fahrenheit') {
            val = (tempC * 9 / 5) + 32;
            sym = "℉";
        }

        const text = `${val.toFixed(0)}${sym}`;

        if (color)
            return `<span foreground="${color}">${text}</span>`;

        return text;
    }

    /*
    ------------------------
    FORMATTERS
    ------------------------
    */

    _getPrefix(type) {

        if (this.labelStyle === 'none')
            return "";

        if (this.labelStyle === 'symbol') {
            const symbols = {
                cpu: "⚙",
                gpu: "🖥",
                ram: "🖴",
                swap: "⇄",
                disk: "💾",
                net: "🌐"
            };
            return symbols[type] || "";
        }

        const text = {
            cpu: "CPU",
            gpu: "GPU",
            ram: "RAM",
            swap: "SWAP",
            disk: "DISK",
            net: "NET"
        };
        return text[type] || "";
    }

    _formatCPU(cpu) {

        if (!cpu) return "";

        const values = [];

        if (this.cpuUsage && Number.isFinite(cpu.usage)) {
            const color = this._getColor(cpu.usage);

            if (color)
                values.push(`<span foreground="${color}">${cpu.usage.toFixed(0)}%</span>`);
            else
                values.push(`${cpu.usage.toFixed(0)}%`);
        }

        if (this.cpuClock && Number.isFinite(cpu.clock))
            values.push(`${cpu.clock.toFixed(2)}GHz`);

        if (this.cpuTemp) {
            const tempStr = this._formatTemperature(cpu.temp);
            if (tempStr)
                values.push(tempStr);
        }

        if (values.length === 0) return "";

        return `${this._getPrefix('cpu')}${this.b_open}${values.join(` ${this.delimiter} `)}${this.b_close}`;
    }

    _formatGPU(gpu) {

        if (!gpu) return "";

        if (gpu.sleeping)
            return `${this._getPrefix('gpu')}${this.b_open}Sleep${this.b_close}`;

        const values = [];

        if (this.gpuUsage) {
            const usage = Number.isFinite(gpu.usage) ? gpu.usage : 0;
            const color = this._getColor(usage);

            if (color)
                values.push(`<span foreground="${color}">${usage.toFixed(0)}%</span>`);
            else
                values.push(`${usage.toFixed(0)}%`);
        }

        if (this.gpuClock && Number.isFinite(gpu.clock)) {
            if (gpu.clock >= 1000)
                values.push(`${(gpu.clock / 1000).toFixed(2)}GHz`);
            else
                values.push(`${gpu.clock.toFixed(0)}MHz`);
        }

        if (this.gpuTemp) {
            const tempStr = this._formatTemperature(gpu.temp);
            if (tempStr)
                values.push(tempStr);
        }

        const vramColor = Number.isFinite(gpu.vramPercent) ? this._getColor(gpu.vramPercent) : null;

        if (this.gpuVramUsed && Number.isFinite(gpu.vramUsed)) {
            if (vramColor && !this.gpuVramPercent)
                values.push(`<span foreground="${vramColor}">${gpu.vramUsed.toFixed(1)}G</span>`);
            else
                values.push(`${gpu.vramUsed.toFixed(1)}G`);
        }

        if (this.gpuVramFree && Number.isFinite(gpu.vramFree))
            values.push(`${gpu.vramFree.toFixed(1)}G`);

        if (this.gpuVramPercent && Number.isFinite(gpu.vramPercent)) {
            if (vramColor)
                values.push(`<span foreground="${vramColor}">${gpu.vramPercent.toFixed(0)}%</span>`);
            else
                values.push(`${gpu.vramPercent.toFixed(0)}%`);
        }

        if (values.length === 0) {
            if (this.gpuVramUsed || this.gpuVramFree || this.gpuVramPercent)
                return `${this._getPrefix('gpu')}${this.b_open}Shared${this.b_close}`;
            if (this.gpuUsage || this.gpuClock || this.gpuTemp)
                return `${this._getPrefix('gpu')}${this.b_open}${gpu.name || 'Active'}${this.b_close}`;
            return "";
        }

        return `${this._getPrefix('gpu')}${this.b_open}${values.join(` ${this.delimiter} `)}${this.b_close}`;
    }

    _formatRAM(ram) {

        if (!ram) return "";

        const values = [];
        const ramColor = Number.isFinite(ram.percent) ? this._getColor(ram.percent) : null;

        if (this.ramUsed && Number.isFinite(ram.used)) {
            if (ramColor && !this.ramPercent)
                values.push(`<span foreground="${ramColor}">${ram.used.toFixed(1)}G</span>`);
            else
                values.push(`${ram.used.toFixed(1)}G`);
        }

        if (this.ramFree && Number.isFinite(ram.free))
            values.push(`${ram.free.toFixed(1)}G`);

        if (this.ramPercent && Number.isFinite(ram.percent)) {
            if (ramColor)
                values.push(`<span foreground="${ramColor}">${ram.percent.toFixed(0)}%</span>`);
            else
                values.push(`${ram.percent.toFixed(0)}%`);
        }

        if (values.length === 0) return "";

        return `${this._getPrefix('ram')}${this.b_open}${values.join(` ${this.delimiter} `)}${this.b_close}`;
    }

    _formatSWAP(swap) {

        if (!swap || !swap.hasSwap) return "";

        const values = [];
        const swapColor = Number.isFinite(swap.percent) ? this._getColor(swap.percent) : null;

        if (this.swapUsed && Number.isFinite(swap.used)) {
            if (swapColor && !this.swapPercent)
                values.push(`<span foreground="${swapColor}">${swap.used.toFixed(1)}G</span>`);
            else
                values.push(`${swap.used.toFixed(1)}G`);
        }

        if (this.swapFree && Number.isFinite(swap.free))
            values.push(`${swap.free.toFixed(1)}G`);

        if (this.swapPercent && Number.isFinite(swap.percent)) {
            if (swapColor)
                values.push(`<span foreground="${swapColor}">${swap.percent.toFixed(0)}%</span>`);
            else
                values.push(`${swap.percent.toFixed(0)}%`);
        }

        if (values.length === 0) return "";

        return `${this._getPrefix('swap')}${this.b_open}${values.join(` ${this.delimiter} `)}${this.b_close}`;
    }

    _formatDisk(disk) {

        if (!disk) return "";

        const values = [];

        const formatRate = (bytesPerSec) => {
            const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
            let u = 0;
            let rate = bytesPerSec;
            while (rate > 999 && u < units.length - 1) {
                rate /= 1024;
                u++;
            }
            return `${rate.toFixed(0).padStart(2, '0')}${units[u]}`;
        };

        if (this.diskRead) {
            values.push(`R: ${formatRate(disk.read || 0)}`);
        }

        if (this.diskWrite) {
            values.push(`W: ${formatRate(disk.write || 0)}`);
        }

        const formatSpace = (gb) => {
            if (gb >= 1024)
                return `${(gb / 1024).toFixed(1)}T`;
            return `${gb.toFixed(1)}G`;
        };

        const spaceColor = Number.isFinite(disk.spacePercent) ? this._getColor(disk.spacePercent) : null;

        if (this.diskSpaceUsed && Number.isFinite(disk.spaceUsed)) {
            if (spaceColor && !this.diskSpacePercent)
                values.push(`<span foreground="${spaceColor}">${formatSpace(disk.spaceUsed)}</span>`);
            else
                values.push(`${formatSpace(disk.spaceUsed)}`);
        }

        if (this.diskSpaceFree && Number.isFinite(disk.spaceFree)) {
            values.push(`${formatSpace(disk.spaceFree)}`);
        }

        if (this.diskSpacePercent && Number.isFinite(disk.spacePercent)) {
            if (spaceColor)
                values.push(`<span foreground="${spaceColor}">${disk.spacePercent.toFixed(0)}%</span>`);
            else
                values.push(`${disk.spacePercent.toFixed(0)}%`);
        }

        if (values.length === 0) return "";

        return `${this._getPrefix('disk')}${this.b_open}${values.join(` ${this.delimiter} `)}${this.b_close}`;
    }

    _formatNET(net) {

        if (!net) return "";

        let tx = (net && Number.isFinite(net.up)) ? Math.max(0, net.up) : 0;
        let rx = (net && Number.isFinite(net.down)) ? Math.max(0, net.down) : 0;

        const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
        let u = 0;

        while (((this.netUp && tx > 999) || (this.netDown && rx > 999)) && u < units.length - 1) {
            tx /= 1024;
            rx /= 1024;
            u++;
        }

        const values = [];

        if (this.netDown)
            values.push(`↓ ${rx.toFixed(0).padStart(2, '0')}`);

        if (this.netUp)
            values.push(`↑ ${tx.toFixed(0).padStart(2, '0')}`);

        if (values.length === 0) return "";

        return `${this._getPrefix('net')}${this.b_open}${values.join(` ${this.delimiter} `)}${this.b_close}${units[u]}`;
    }

    stop() {
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = null;
        }
    }

    _initTooltip() {
        this._tooltipActor = null;
        this._tooltipTimer = 0;
        this._lastMetrics = {};

        this.connect('notify::hover', () => {
            if (this.hover && this.showTooltip && !(this.menu && this.menu.isOpen)) {
                if (this._tooltipTimer)
                    GLib.source_remove(this._tooltipTimer);
                this._tooltipTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
                    this._showTooltip();
                    this._tooltipTimer = 0;
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                this._hideTooltip();
            }
        });

        this.menu.connectObject('open-state-changed', (menu, isOpen) => {
            if (isOpen)
                this._hideTooltip();
        }, this);
    }

    _showTooltip() {
        if (!this.showTooltip || (this.menu && this.menu.isOpen))
            return;

        if (!this._tooltipActor) {
            this._tooltipActor = new St.Label({
                style_class: 'rezmon-tooltip',
                style: 'background-color: rgba(28, 28, 32, 0.96); ' +
                       'color: #ffffff; ' +
                       'border: 1px solid rgba(255, 255, 255, 0.15); ' +
                       'border-radius: 10px; ' +
                       'padding: 12px 16px; ' +
                       'font-size: 10.5pt; ' +
                       'box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);',
                reactive: false,
            });
            this._tooltipActor.clutter_text.set_use_markup(true);
            uiGroup.add_child(this._tooltipActor);
        }

        const markup = this._generateTooltipMarkup();
        if (!markup)
            return;

        this._tooltipActor.clutter_text.set_markup(markup);
        this._tooltipActor.opacity = 0;
        this._tooltipActor.show();

        const extents = this.get_transformed_extents();
        const [, width] = this._tooltipActor.get_preferred_width(-1);

        const centerX = extents.get_x() + (extents.get_width() / 2);
        const stageWidth = global.stage.width;
        const x = Math.max(12, Math.min(Math.floor(centerX - (width / 2)), stageWidth - width - 12));
        const y = extents.get_y() + extents.get_height() + 8;

        this._tooltipActor.set_position(x, y);

        this._tooltipActor.remove_all_transitions();
        this._tooltipActor.ease({
            opacity: 255,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _hideTooltip() {
        if (this._tooltipTimer) {
            GLib.source_remove(this._tooltipTimer);
            this._tooltipTimer = 0;
        }

        if (this._tooltipActor && this._tooltipActor.visible) {
            this._tooltipActor.remove_all_transitions();
            this._tooltipActor.ease({
                opacity: 0,
                duration: 120,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (this._tooltipActor)
                        this._tooltipActor.hide();
                },
            });
        }
    }

    _generateTooltipMarkup() {
        const sections = [];

        // CPU
        const cpu = this._lastMetrics?.cpu || updateCPU(this);
        const cpuInfo = this._getCpuHardwareInfo();
        let cpuText = `<b>CPU</b>  <span alpha="70%">${GLib.markup_escape_text(cpuInfo.model, -1)} (${cpuInfo.cores} Cores)</span>\n`;
        const cpuParts = [];
        if (cpu && Number.isFinite(cpu.usage))
            cpuParts.push(`Usage: <b>${Math.round(cpu.usage)}%</b>`);
        if (cpu && Number.isFinite(cpu.clock))
            cpuParts.push(`Clock: <b>${cpu.clock.toFixed(2)} GHz</b>`);
        if (cpu && Number.isFinite(cpu.temp))
            cpuParts.push(`Temp: <b>${this._formatTemperature(cpu.temp)}</b>`);
        cpuText += `  ${cpuParts.length > 0 ? cpuParts.join('  │  ') : '<span alpha="60%">No data</span>'}`;
        sections.push(cpuText);

        // GPU
        const gpu = this._lastMetrics?.gpu || updateGPU(this);
        if (gpu) {
            const gpuTitle = gpu.name ? GLib.markup_escape_text(gpu.name, -1) : 'GPU';
            let gpuText = `<b>GPU</b>  <span alpha="70%">${gpuTitle}</span>\n`;
            if (gpu.sleeping) {
                gpuText += `  <span alpha="60%">(Power Saving / D3cold Sleep)</span>`;
            } else {
                const gpuParts = [];
                if (Number.isFinite(gpu.usage))
                    gpuParts.push(`Usage: <b>${Math.round(gpu.usage)}%</b>`);
                if (Number.isFinite(gpu.clock))
                    gpuParts.push(`Clock: <b>${gpu.clock} MHz</b>`);
                if (Number.isFinite(gpu.temp))
                    gpuParts.push(`Temp: <b>${this._formatTemperature(gpu.temp)}</b>`);
                if (Number.isFinite(gpu.vramUsed)) {
                    const totalV = Number.isFinite(gpu.vramFree) ? (gpu.vramUsed + gpu.vramFree).toFixed(1) : null;
                    const pct = Number.isFinite(gpu.vramPercent) ? Math.round(gpu.vramPercent) : null;
                    if (totalV && pct !== null)
                        gpuParts.push(`VRAM: <b>${gpu.vramUsed.toFixed(1)}G/${totalV}G (${pct}%)</b>`);
                    else
                        gpuParts.push(`VRAM: <b>${gpu.vramUsed.toFixed(1)} GB</b>`);
                }
                gpuText += `  ${gpuParts.length > 0 ? gpuParts.join('  │  ') : '<span alpha="60%">Active</span>'}`;
            }
            sections.push(gpuText);
        }

        // Memory (RAM & SWAP)
        const ram = this._lastMetrics?.ram || updateRAM(this);
        const swap = this._lastMetrics?.swap || updateSWAP(this);
        let memText = `<b>Memory</b>\n`;
        if (ram) {
            const totalR = ((ram.used || 0) + (ram.free || 0)).toFixed(1);
            memText += `  RAM: <b>${(ram.used || 0).toFixed(1)}G</b> / ${totalR}G (<b>${Math.round(ram.percent || 0)}%</b>)  │  Free: <b>${(ram.free || 0).toFixed(1)}G</b>\n`;
        }
        if (swap && swap.hasSwap) {
            const totalS = ((swap.used || 0) + (swap.free || 0)).toFixed(1);
            memText += `  SWAP: <b>${(swap.used || 0).toFixed(1)}G</b> / ${totalS}G (<b>${Math.round(swap.percent || 0)}%</b>)  │  Free: <b>${(swap.free || 0).toFixed(1)}G</b>`;
        } else if (swap && !swap.hasSwap) {
            memText += `  SWAP: <span alpha="60%">No swap configured</span>`;
        }
        sections.push(memText);

        // Storage / Disk
        const disk = this._lastMetrics?.disk || updateDisk(this);
        if (disk) {
            const totalD = this._formatDiskCapacity((disk.spaceUsed || 0) + (disk.spaceFree || 0));
            const usedD = this._formatDiskCapacity(disk.spaceUsed || 0);
            const freeD = this._formatDiskCapacity(disk.spaceFree || 0);
            let diskText = `<b>Disk & Storage</b>  <span alpha="70%">(Root /)</span>\n`;
            diskText += `  Space: <b>${usedD}</b> / ${totalD} (<b>${Math.round(disk.spacePercent || 0)}%</b>)  │  Free: <b>${freeD}</b>\n`;
            const rRate = this._formatDataRate(disk.read || 0);
            const wRate = this._formatDataRate(disk.write || 0);
            diskText += `  I/O: Read: <b>${rRate}</b>  │  Write: <b>${wRate}</b>`;
            sections.push(diskText);
        }

        // Network
        const net = this._lastMetrics?.net || updateNET(this);
        if (net) {
            const iface = this.prev_iface || 'Active';
            let netText = `<b>Network</b>  <span alpha="70%">(${GLib.markup_escape_text(iface, -1)})</span>\n`;
            const down = this._formatDataRate(net.down || 0);
            const up = this._formatDataRate(net.up || 0);
            netText += `  Speed: ↓ <b>${down}</b>  │  ↑ <b>${up}</b>`;
            sections.push(netText);
        }

        return sections.join('\n\n');
    }

    _formatDataRate(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return '0 B/s';
        const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
        let u = 0;
        let val = bytes;
        while (val >= 1024 && u < units.length - 1) {
            val /= 1024;
            u++;
        }
        return `${val < 10 && u > 0 ? val.toFixed(1) : Math.round(val)} ${units[u]}`;
    }

    _formatDiskCapacity(gb) {
        if (!Number.isFinite(gb)) return '0 GB';
        if (gb >= 1000)
            return `${(gb / 1024).toFixed(1)} TB`;
        return `${gb.toFixed(1)} GB`;
    }

    _getCpuHardwareInfo() {
        if (this._cpuHwInfo)
            return this._cpuHwInfo;

        let model = 'CPU';
        let cores = 0;
        try {
            const lines = readFileLines('/proc/cpuinfo');
            for (const line of lines) {
                if (line.startsWith('model name')) {
                    if (model === 'CPU') {
                        const parts = line.split(':');
                        if (parts[1])
                            model = parts[1].trim().replace(/\s+/g, ' ');
                    }
                } else if (line.startsWith('processor')) {
                    cores++;
                }
            }
        } catch (_) {}

        this._cpuHwInfo = { model, cores: cores || 1 };
        return this._cpuHwInfo;
    }

    destroy() {
        this.stop();
        this._hideTooltip();

        if (this._tooltipActor) {
            if (this._tooltipActor.get_parent())
                this._tooltipActor.get_parent().remove_child(this._tooltipActor);
            this._tooltipActor.destroy();
            this._tooltipActor = null;
        }

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }

        super.destroy();
    }
}

GObject.registerClass({ GTypeName: 'RezMonIndicator' }, RezMonIndicator);