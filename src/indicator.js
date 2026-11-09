'use strict';

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';

import { Button } from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { PopupMenuItem, PopupBaseMenuItem, PopupSeparatorMenuItem } from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

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
            text: _("Loading..."),
            y_align: Clutter.ActorAlign.CENTER,
            style: 'margin-right: 12px;',
        });

        this.label.clutter_text.set_use_markup(true);

        this.box.add_child(this.label);
        this.add_child(this.box);

        this._initValues();
        this._bindSettings();
        this._buildMenu();

        this._loadCpuHardwareInfo();
        this._refreshTopProcesses();
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
        this._dashboardItem.set_style('width: 360px; min-width: 360px; max-width: 360px;');
        this._dashboardLabel = new St.Label({
            style: 'padding: 6px 10px; width: 360px; min-width: 360px; max-width: 360px; font-size: 9.5pt; line-height: 1.45;',
        });
        this._dashboardLabel.clutter_text.set_use_markup(true);
        this._dashboardLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        this._dashboardItem.add_child(this._dashboardLabel);
        this.menu.addMenuItem(this._dashboardItem);

        if (this.menu && this.menu.box) {
            this.menu.box.set_style('min-width: 360px; max-width: 360px;');
        }

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
        const settingsItem = new PopupMenuItem(_("Open Settings"));
        settingsItem.connect('activate', () => {
            this._extension.openPreferences();
        });
        this.menu.addMenuItem(settingsItem);

        // Update dashboard and cadence whenever menu opens or closes
        this.menu.connectObject('open-state-changed', (menu, isOpen) => {
            if (isOpen) {
                this._menuTicks = 0;
                this._updateMetrics();
                this._refreshTopProcesses();
                this._restartLoop(1);
            } else {
                this._menuTicks = 0;
                this._restartLoop(this.interval);
            }
        }, this);
    }

    _refreshTopProcesses() {
        getTopProcesses().then((top) => {
            this._topProcesses = top;
            if (this.menu && this.menu.isOpen) {
                this._updateDashboard();
            }
        }).catch(() => {});
    }

    _getAvailableMonitors() {
        const monitors = [];

        // Graphical Monitors
        if (GLib.find_program_in_path('gnome-system-monitor')) {
            monitors.push({
                name: _('GNOME System Monitor'),
                launch: () => this._launchApp('gnome-system-monitor'),
            });
        }
        if (GLib.find_program_in_path('resources')) {
            monitors.push({
                name: _('Resources Monitor'),
                launch: () => this._launchApp('resources'),
            });
        }
        if (GLib.find_program_in_path('mission-center') || GLib.find_program_in_path('io.missioncenter.MissionCenter')) {
            const bin = GLib.find_program_in_path('mission-center') ? 'mission-center' : 'io.missioncenter.MissionCenter';
            monitors.push({
                name: _('Mission Center'),
                launch: () => this._launchApp(bin),
            });
        }

        // Terminal Monitors
        if (GLib.find_program_in_path('btop')) {
            monitors.push({
                name: _('btop (Terminal)'),
                launch: () => this._launchTerminal('btop'),
            });
        }
        if (GLib.find_program_in_path('htop')) {
            monitors.push({
                name: _('htop (Terminal)'),
                launch: () => this._launchTerminal('htop'),
            });
        }

        // Fallback default
        if (monitors.length === 0) {
            monitors.push({
                name: _('System Monitor'),
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
            if (app) {
                const context = global.create_app_launch_context(0, -1);
                app.launch([], context);
            }
        } catch (e) {
            logError(e);
        }
    }

    _launchTerminal(cmd) {
        const terminals = [
            { bin: 'ptyxis', arg: '--' },
            { bin: 'kgx', arg: '-e' },
            { bin: 'gnome-terminal', arg: '--' },
            { bin: 'kitty', arg: '-e' },
            { bin: 'alacritty', arg: '-e' },
            { bin: 'wezterm', arg: 'start --' },
            { bin: 'foot', arg: '' },
            { bin: 'x-terminal-emulator', arg: '-e' },
            { bin: 'xterm', arg: '-e' },
        ];
        for (const t of terminals) {
            if (GLib.find_program_in_path(t.bin)) {
                const fullCmd = t.arg ? `${t.bin} ${t.arg} ${cmd}` : `${t.bin} ${cmd}`;
                this._launchApp(fullCmd);
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
        const cpu = this._lastMetrics?.cpu || { usage: 0, clock: null, temp: null };
        const cpuInfo = this._getCpuHardwareInfo();
        const cpuPct = Number.isFinite(cpu?.usage) ? Math.round(cpu.usage) : 0;
        const cpuBar = this._makeProgressBar(cpuPct, 14);
        const cpuClock = Number.isFinite(cpu?.clock) ? `  │  ${cpu.clock.toFixed(2)} GHz` : '';
        const cpuTemp = Number.isFinite(cpu?.temp) ? `  │  ${this._formatTemperature(cpu.temp)}` : '';
        lines.push(`<b>${this.symbolCpu || '⚡'} CPU</b>  <span alpha="70%">${GLib.markup_escape_text(cpuInfo.model, -1)}</span>`);
        lines.push(`  <span font_family="monospace">${cpuBar}</span> <b>${cpuPct}%</b>${cpuClock}${cpuTemp}`);

        // Memory (RAM)
        const ram = this._lastMetrics?.ram;
        if (ram) {
            const ramPct = Number.isFinite(ram.percent) ? Math.round(ram.percent) : 0;
            const ramFreePct = Number.isFinite(ram.freePercent) ? Math.round(ram.freePercent) : 0;
            const ramBar = this._makeProgressBar(ramPct, 14);
            const ramUsed = (ram.used || 0).toFixed(1);
            const ramTotal = ((ram.used || 0) + (ram.free || 0)).toFixed(1);
            const ramFree = (ram.free || 0).toFixed(1);
            lines.push(``);
            lines.push(`<b>${this.symbolRam || '🧠'} RAM</b>  <b>${ramUsed} GB</b> / ${ramTotal} GB (<span alpha="70%">Free: ${ramFree} GB</span>)`);
            lines.push(`  <span font_family="monospace">${ramBar}</span> <b>${ramPct}%</b> used  │  <b>${ramFreePct}%</b> free`);
        }

        // SWAP
        const swap = this._lastMetrics?.swap;
        if (swap && swap.hasSwap) {
            const swapPct = Number.isFinite(swap.percent) ? Math.round(swap.percent) : 0;
            const swapFreePct = Number.isFinite(swap.freePercent) ? Math.round(swap.freePercent) : 0;
            const swapBar = this._makeProgressBar(swapPct, 14);
            const swapUsed = (swap.used || 0).toFixed(1);
            const swapTotal = ((swap.used || 0) + (swap.free || 0)).toFixed(1);
            lines.push(``);
            lines.push(`<b>${this.symbolSwap || '⇄'} SWAP</b>  <b>${swapUsed} GB</b> / ${swapTotal} GB`);
            lines.push(`  <span font_family="monospace">${swapBar}</span> <b>${swapPct}%</b> used  │  <b>${swapFreePct}%</b> free`);
        }

        // GPU
        const gpu = this._lastMetrics?.gpu;
        if (gpu) {
            const gpuTitle = gpu.name ? GLib.markup_escape_text(gpu.name, -1) : 'GPU';
            lines.push(``);
            if (gpu.sleeping) {
                lines.push(`<b>${this.symbolGpu || '🎮'} GPU</b>  ${this.b_open}Sleep${this.b_close}`);
            } else {
                const gpuPct = Number.isFinite(gpu.usage) ? Math.round(gpu.usage) : 0;
                const gpuBar = this._makeProgressBar(gpuPct, 14);
                const gpuTemp = Number.isFinite(gpu.temp) ? `  │  ${this._formatTemperature(gpu.temp)}` : '';
                const vram = Number.isFinite(gpu.vramUsed) ? `  │  VRAM: <b>${gpu.vramUsed.toFixed(1)}G</b>` : '';
                lines.push(`<b>${this.symbolGpu || '🎮'} GPU</b>  <span alpha="70%">${gpuTitle}</span>`);
                lines.push(`  <span font_family="monospace">${gpuBar}</span> <b>${gpuPct}%</b>${gpuTemp}${vram}`);
            }
        }

        // Storage / Root Filesystem
        const disk = this._lastMetrics?.disk;
        if (disk) {
            const diskPct = Number.isFinite(disk.spacePercent) ? Math.round(disk.spacePercent) : 0;
            const diskBar = this._makeProgressBar(diskPct, 14);
            const usedStr = this._formatDiskCapacity(disk.spaceUsed || 0);
            const totalStr = this._formatDiskCapacity((disk.spaceUsed || 0) + (disk.spaceFree || 0));
            const rRate = this._formatDataRate(disk.read || 0);
            const wRate = this._formatDataRate(disk.write || 0);
            lines.push(``);
            lines.push(`<b>${this.symbolDisk || '💽'} Storage (/)</b>  <b>${usedStr}</b> / ${totalStr}`);
            lines.push(`  <span font_family="monospace">${diskBar}</span> <b>${diskPct}%</b>  │  I/O: R ${rRate}  W ${wRate}`);
        }

        // Network
        const net = this._lastMetrics?.net;
        if (net) {
            const iface = this.prev_iface || 'Active';
            const down = this._formatDataRate(net.down || 0);
            const up = this._formatDataRate(net.up || 0);
            lines.push(``);
            lines.push(`<b>${this.symbolNet || '📶'} Network (${GLib.markup_escape_text(iface, -1)})</b>  ↓ <b>${down}</b>  │  ↑ <b>${up}</b>`);
        }

        // Top Resource Consumers (Vertical list)
        lines.push(``);
        lines.push(`<b>Active Processes</b>`);
        if (this._topProcesses && (this._topProcesses.topCpu?.length > 0 || this._topProcesses.topMem?.length > 0)) {
            if (this._topProcesses.topCpu?.length > 0) {
                lines.push(`  <span alpha="70%">Top CPU:</span>`);
                for (const p of this._topProcesses.topCpu) {
                    const name = p.name.length > 18 ? `${p.name.substring(0, 17)}…` : p.name;
                    const paddedName = name.padEnd(19, ' ');
                    const pct = `${Math.round(p.cpu)}%`.padStart(4, ' ');
                    lines.push(`    <span font_family="monospace">• ${GLib.markup_escape_text(paddedName, -1)} <b>${pct}</b></span>`);
                }
            }
            if (this._topProcesses.topMem?.length > 0) {
                lines.push(`  <span alpha="70%">Top Memory:</span>`);
                for (const p of this._topProcesses.topMem) {
                    const name = p.name.length > 18 ? `${p.name.substring(0, 17)}…` : p.name;
                    const paddedName = name.padEnd(19, ' ');
                    const pct = `${p.mem.toFixed(1)}%`.padStart(5, ' ');
                    lines.push(`    <span font_family="monospace">• ${GLib.markup_escape_text(paddedName, -1)} <b>${pct}</b></span>`);
                }
            }
        } else {
            lines.push(`  <span alpha="50%">Fetching active processes…</span>`);
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
        this.ramFreePercent = this._settings.get_boolean('ram-free-percent');

        // swap toggles
        this.swapUsed = this._settings.get_boolean('swap-used');
        this.swapFree = this._settings.get_boolean('swap-free');
        this.swapPercent = this._settings.get_boolean('swap-percent');
        this.swapFreePercent = this._settings.get_boolean('swap-free-percent');

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

        // custom metric icons
        this.symbolCpu = this._settings.get_string('symbol-cpu') || '⚡';
        this.symbolGpu = this._settings.get_string('symbol-gpu') || '🎮';
        this.symbolRam = this._settings.get_string('symbol-ram') || '🧠';
        this.symbolSwap = this._settings.get_string('symbol-swap') || '⇄';
        this.symbolDisk = this._settings.get_string('symbol-disk') || '💽';
        this.symbolNet = this._settings.get_string('symbol-net') || '📶';

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

        this._restartLoop(this.menu && this.menu.isOpen ? 1 : this.interval);
    }

    _restartLoop(interval = this.interval) {

        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = null;
        }

        const sec = Math.max(1, interval || 1);
        this._timeout = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT_IDLE,
            sec,
            () => {
                if (this.menu && this.menu.isOpen) {
                    this._menuTicks = (this._menuTicks || 0) + 1;
                    if (this._menuTicks % 3 === 0) {
                        this._refreshTopProcesses();
                    }
                }
                this._updateMetrics();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    async _updateMetrics() {
        if (this._destroyed || this._isUpdating)
            return;
        this._isUpdating = true;

        try {
            if (!this._lastMetrics)
                this._lastMetrics = {};

            const isMenuOpen = !!(this.menu && this.menu.isOpen);

            const [cpu, gpu, ram, swap, disk, net] = await Promise.all([
                (isMenuOpen || this.showCPU) ? updateCPU(this, { force: isMenuOpen }) : Promise.resolve(null),
                (isMenuOpen || this.showGPU) ? updateGPU(this) : Promise.resolve(null),
                (isMenuOpen || this.showRAM) ? updateRAM(this) : Promise.resolve(null),
                (isMenuOpen || this.showSWAP) ? updateSWAP(this, { force: isMenuOpen }) : Promise.resolve(null),
                (isMenuOpen || this.showDisk) ? updateDisk(this, { force: isMenuOpen }) : Promise.resolve(null),
                (isMenuOpen || this.showNET) ? updateNET(this) : Promise.resolve(null),
            ]);

            if (this._destroyed)
                return;

            if (cpu !== null) this._lastMetrics.cpu = cpu;
            if (gpu !== null) this._lastMetrics.gpu = gpu;
            if (ram !== null) this._lastMetrics.ram = ram;
            if (swap !== null) this._lastMetrics.swap = swap;
            if (disk !== null) this._lastMetrics.disk = disk;
            if (net !== null) this._lastMetrics.net = net;

            const parts = [];

        const formatters = {
            cpu: () => (this.showCPU && this._lastMetrics.cpu) ? this._formatCPU(this._lastMetrics.cpu) : null,
            gpu: () => (this.showGPU && this._lastMetrics.gpu) ? this._formatGPU(this._lastMetrics.gpu) : null,
            ram: () => (this.showRAM && this._lastMetrics.ram) ? this._formatRAM(this._lastMetrics.ram) : null,
            swap: () => (this.showSWAP && this._lastMetrics.swap) ? this._formatSWAP(this._lastMetrics.swap) : null,
            disk: () => (this.showDisk && this._lastMetrics.disk) ? this._formatDisk(this._lastMetrics.disk) : null,
            net: () => (this.showNET && this._lastMetrics.net) ? this._formatNET(this._lastMetrics.net) : null,
        };

        const currentOrder = this.metricOrder || ['cpu', 'gpu', 'ram', 'swap', 'disk', 'net'];
        for (const metric of currentOrder) {
            const fmt = formatters[metric];
            if (fmt) {
                const formatted = fmt();
                if (formatted)
                    parts.push(formatted);
            }
        }

        if (parts.length > 0)
            this.label.clutter_text.set_markup(parts.join(this.spacing));
        else
            this.label.clutter_text.set_markup("RezMon");

        if (isMenuOpen) {
            this._updateDashboard();
        }
    } catch (e) {
        logError(e);
    } finally {
        this._isUpdating = false;
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

        const symbols = {
            cpu: this.symbolCpu || "⚡",
            gpu: this.symbolGpu || "🎮",
            ram: this.symbolRam || "🧠",
            swap: this.symbolSwap || "⇄",
            disk: this.symbolDisk || "💽",
            net: this.symbolNet || "📶"
        };

        if (this.labelStyle === 'symbol') {
            return symbols[type] || "";
        }

        if (this.labelStyle === 'both') {
            const both = {
                cpu: `${symbols.cpu} CPU`,
                gpu: `${symbols.gpu} GPU`,
                ram: `${symbols.ram} RAM`,
                swap: `${symbols.swap} SWAP`,
                disk: `${symbols.disk} DISK`,
                net: `${symbols.net} NET`
            };
            return both[type] || "";
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

        if (this.ramFreePercent && Number.isFinite(ram.freePercent)) {
            if (ramColor)
                values.push(`<span foreground="${ramColor}">${ram.freePercent.toFixed(0)}%</span>`);
            else
                values.push(`${ram.freePercent.toFixed(0)}%`);
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

        if (this.swapFreePercent && Number.isFinite(swap.freePercent)) {
            if (swapColor)
                values.push(`<span foreground="${swapColor}">${swap.freePercent.toFixed(0)}%</span>`);
            else
                values.push(`${swap.freePercent.toFixed(0)}%`);
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

        const rx = (net && Number.isFinite(net.down)) ? Math.max(0, net.down) : 0;
        const tx = (net && Number.isFinite(net.up)) ? Math.max(0, net.up) : 0;

        const formatRate = (bytes) => {
            if (!Number.isFinite(bytes) || bytes <= 0) {
                return { valStr: '00', unit: 'B/s' };
            }
            const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
            let u = 0;
            let val = bytes;
            while (val > 999 && u < units.length - 1) {
                val /= 1024;
                u++;
            }
            let valStr;
            if (val < 10 && u > 0)
                valStr = val.toFixed(1);
            else
                valStr = val.toFixed(0).padStart(2, '0');
            return { valStr, unit: units[u] };
        };

        const down = formatRate(rx);
        const up = formatRate(tx);

        if (this.netDown && this.netUp) {
            if (down.unit === up.unit) {
                return `${this._getPrefix('net')}${this.b_open}↓ ${down.valStr} ${this.delimiter} ↑ ${up.valStr}${this.b_close}${down.unit}`;
            } else {
                return `${this._getPrefix('net')}${this.b_open}↓ ${down.valStr} ${down.unit} ${this.delimiter} ↑ ${up.valStr} ${up.unit}${this.b_close}`;
            }
        } else if (this.netDown) {
            return `${this._getPrefix('net')}${this.b_open}↓ ${down.valStr}${this.b_close}${down.unit}`;
        } else if (this.netUp) {
            return `${this._getPrefix('net')}${this.b_open}↑ ${up.valStr}${this.b_close}${up.unit}`;
        }

        return "";
    }

    stop() {
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = null;
        }
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

    async _loadCpuHardwareInfo() {
        let model = 'CPU';
        let cores = 0;
        try {
            const lines = await readFileLines('/proc/cpuinfo');
            for (const line of lines) {
                if (line.startsWith('model name')) {
                    if (model === 'CPU') {
                        const parts = line.split(':');
                        if (parts[1]) {
                            model = parts[1]
                                .trim()
                                .replace(/\(R\)|\(TM\)/gi, '')
                                .replace(/\s+CPU\s*@.*/gi, '')
                                .replace(/\s+Processor\s*@.*/gi, '')
                                .replace(/\s+\d+-Core Processor.*/gi, '')
                                .replace(/\s+/g, ' ')
                                .trim();
                            if (model.length > 25) {
                                model = `${model.substring(0, 24)}…`;
                            }
                        }
                    }
                } else if (line.startsWith('processor')) {
                    cores++;
                }
            }
        } catch (_) {}

        this._cpuHwInfo = { model: model || 'CPU', cores: cores || 1 };
    }

    _getCpuHardwareInfo() {
        return this._cpuHwInfo || { model: 'CPU', cores: 1 };
    }

    destroy() {
        this._destroyed = true;
        this.stop();

        if (this.menu) {
            this.menu.disconnectObject(this);
        }

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }

        super.destroy();
    }
}

GObject.registerClass({ GTypeName: 'RezMonIndicator' }, RezMonIndicator);