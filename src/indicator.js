'use strict';

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import { Button } from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { PopupMenuItem } from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { updateCPU } from './metrics/cpu.js';
import { updateGPU } from './metrics/gpu.js';
import { updateRAM } from './metrics/ram.js';
import { updateSWAP } from './metrics/swap.js';
import { updateDisk } from './metrics/disk.js';
import { updateNET } from './metrics/net.js';

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

        const monitorItem = new PopupMenuItem("System Monitor");

        monitorItem.connect('activate', () => {
            try {
                const app = Gio.AppInfo.create_from_commandline(
                    "gnome-system-monitor",
                    null,
                    Gio.AppInfoCreateFlags.NONE
                );
                if (app)
                    app.launch([], null);
            } catch (e) {
                logError(e);
            }
        });

        this.menu.addMenuItem(monitorItem);

        const settingsItem = new PopupMenuItem("Open Settings");

        settingsItem.connect('activate', () => {
            this._extension.openPreferences();
        });

        this.menu.addMenuItem(settingsItem);
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

        const metricUpdaters = {
            cpu: () => {
                if (!this.showCPU) return null;
                const cpu = updateCPU(this);
                return this._formatCPU(cpu);
            },
            gpu: () => {
                if (!this.showGPU) return null;
                const gpu = updateGPU(this);
                return this._formatGPU(gpu);
            },
            ram: () => {
                if (!this.showRAM) return null;
                const ram = updateRAM(this);
                return this._formatRAM(ram);
            },
            swap: () => {
                if (!this.showSWAP) return null;
                const swap = updateSWAP(this);
                return this._formatSWAP(swap);
            },
            disk: () => {
                if (!this.showDisk) return null;
                const disk = updateDisk(this);
                return this._formatDisk(disk);
            },
            net: () => {
                if (!this.showNET) return null;
                const net = updateNET(this);
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

    destroy() {
        this.stop();

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }

        super.destroy();
    }
}

GObject.registerClass({ GTypeName: 'RezMonIndicator' }, RezMonIndicator);