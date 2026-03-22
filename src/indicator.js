'use strict';

import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import { Button } from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { PopupMenuItem } from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { updateCPU } from './metrics/cpu.js';
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

        // ✅ enable markup
        this.label.clutter_text.set_use_markup(true);

        this.box.add_child(this.label);
        this.add_child(this.box);

        this._initValues();
        this._bindSettings();
        this._buildMenu();

        this._updateMetrics();
    }

    _initValues() {

        this.prev_time = Date.now() / 1000;
        this.prev_tx_bytes = 0;
        this.prev_rx_bytes = 0;

        this.prev_used = 0;
        this.prev_total = 0;
    }

    _buildMenu() {

        this.menu.removeAll();

        const settingsItem = new PopupMenuItem("Open Settings");

        settingsItem.connect('activate', () => {
            this._extension.openPreferences();
        });

        this.menu.addMenuItem(settingsItem);
    }

    _bindSettings() {
        this._settings.connect('changed', () => {
            this._reloadSettings();
        });

        this._reloadSettings();
    }

    _reloadSettings() {

        // visibility
        this.showCPU = this._settings.get_boolean('show-cpu');
        this.showRAM = this._settings.get_boolean('show-ram');
        this.showNET = this._settings.get_boolean('show-net');

        // cpu toggles
        this.cpuUsage = this._settings.get_boolean('cpu-usage');
        this.cpuClock = this._settings.get_boolean('cpu-clock');
        this.cpuTemp  = this._settings.get_boolean('cpu-temp');

        // ram toggles
        this.ramUsed = this._settings.get_boolean('ram-used');
        this.ramFree = this._settings.get_boolean('ram-free');
        this.ramPercent = this._settings.get_boolean('ram-percent');

        // net toggles
        this.netDown = this._settings.get_boolean('net-down');
        this.netUp   = this._settings.get_boolean('net-up');

        // appearance
        this.b_open = this._settings.get_string("b-open");
        this.b_close = this._settings.get_string("b-close");
        this.delimiter = this._settings.get_string("delimiter");

        const spacingMap = {
            small: "  ",
            normal: "    ",
            wide: "        "
        };

        this.spacing = spacingMap[this._settings.get_string("spacing")] || "    ";

        // thresholds
        this.warnThreshold = this._settings.get_int('warn-threshold') || 70;
        this.critThreshold = this._settings.get_int('crit-threshold') || 90;

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

        // this.label.set_text(parts.join(this.spacing));
        this.label.clutter_text.set_markup(parts.join(this.spacing));
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

    /*
    ------------------------
    FORMATTERS
    ------------------------
    */

    _formatCPU(cpu) {

        if (!cpu) return "";

        const values = [];

        if (this.cpuUsage && cpu.usage !== null) {
            const color = this._getColor(cpu.usage);

            if (color)
                values.push(`<span foreground="${color}">${cpu.usage.toFixed(0)}%</span>`);
            else
                values.push(`${cpu.usage.toFixed(0)}%`);
        }

        if (this.cpuClock && cpu.clock !== null)
            values.push(`${cpu.clock.toFixed(2)}GHz`);

        if (this.cpuTemp && cpu.temp !== null)
            values.push(`${cpu.temp.toFixed(0)}℃`);

        if (values.length === 0) return "";

        return `CPU${this.b_open}${values.join(` ${this.delimiter} `)}${this.b_close}`;
    }

    _formatRAM(ram) {

        if (!ram) return "";

        const values = [];

        if (this.ramUsed)
            values.push(`${ram.used.toFixed(1)}G`);

        if (this.ramFree)
            values.push(`${ram.free.toFixed(1)}G`);

        if (this.ramPercent) {
            const color = this._getColor(ram.percent);

            if (color)
                values.push(`<span foreground="${color}">${ram.percent.toFixed(0)}%</span>`);
            else
                values.push(`${ram.percent.toFixed(0)}%`);
        }

        if (values.length === 0) return "";

        return `RAM${this.b_open}${values.join(` ${this.delimiter} `)}${this.b_close}`;
    }

    _formatNET(net) {

        if (!net) return "";

        let tx = net.up;
        let rx = net.down;

        const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
        let u = 0;

        while (tx > 99 || rx > 99) {
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
        if (this._timeout)
            GLib.source_remove(this._timeout);

        this._timeout = undefined;
    }
}

GObject.registerClass({ GTypeName: 'RezMonIndicator' }, RezMonIndicator);