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

        if (this.showCPU) {
            const cpu = updateCPU(this);
            const formatted = this._formatCPU(cpu);
            if (formatted) parts.push(formatted);
        }

        if (this.showGPU) {
            const gpu = updateGPU(this);
            const formatted = this._formatGPU(gpu);
            if (formatted) parts.push(formatted);
        }

        if (this.showRAM) {
            const ram = updateRAM(this);
            const formatted = this._formatRAM(ram);
            if (formatted) parts.push(formatted);
        }

        if (this.showNET) {
            const net = updateNET(this);
            const formatted = this._formatNET(net);
            if (formatted) parts.push(formatted);
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

    /*
    ------------------------
    FORMATTERS
    ------------------------
    */

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

        if (this.cpuTemp && Number.isFinite(cpu.temp)) {
            const color = this._getTempColor(cpu.temp);

            if (color)
                values.push(`<span foreground="${color}">${cpu.temp.toFixed(0)}℃</span>`);
            else
                values.push(`${cpu.temp.toFixed(0)}℃`);
        }

        if (values.length === 0) return "";

        return `CPU${this.b_open}${values.join(` ${this.delimiter} `)}${this.b_close}`;
    }

    _formatGPU(gpu) {

        if (!gpu) return "";

        if (gpu.sleeping)
            return `GPU${this.b_open}Sleep${this.b_close}`;

        const values = [];

        if (this.gpuUsage && Number.isFinite(gpu.usage)) {
            const color = this._getColor(gpu.usage);

            if (color)
                values.push(`<span foreground="${color}">${gpu.usage.toFixed(0)}%</span>`);
            else
                values.push(`${gpu.usage.toFixed(0)}%`);
        }

        if (this.gpuClock && Number.isFinite(gpu.clock)) {
            if (gpu.clock >= 1000)
                values.push(`${(gpu.clock / 1000).toFixed(2)}GHz`);
            else
                values.push(`${gpu.clock.toFixed(0)}MHz`);
        }

        if (this.gpuTemp && Number.isFinite(gpu.temp)) {
            const color = this._getTempColor(gpu.temp);

            if (color)
                values.push(`<span foreground="${color}">${gpu.temp.toFixed(0)}℃</span>`);
            else
                values.push(`${gpu.temp.toFixed(0)}℃`);
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

        if (values.length === 0) return "";

        return `GPU${this.b_open}${values.join(` ${this.delimiter} `)}${this.b_close}`;
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

        return `RAM${this.b_open}${values.join(` ${this.delimiter} `)}${this.b_close}`;
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

        return `NET${this.b_open}${values.join(` ${this.delimiter} `)}${this.b_close}${units[u]}`;
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