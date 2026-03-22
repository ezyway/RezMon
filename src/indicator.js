'use strict';

import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import { Button } from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { PopupMenuItem } from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as ExtensionUtils from 'resource:///org/gnome/shell/misc/extensionUtils.js';

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

        this.box.add_child(this.label);
        this.add_child(this.box);

        this._initValues();
        this._bindSettings();
        this._buildMenu();

        this._updateMetrics();
    }

    _initValues() {

        this.feature_functions = [
            updateCPU,
            updateRAM,
            updateNET
        ];

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

    _openPrefs() {
        try {
            this._settings._extension.openPreferences();
        } catch (e) {
            logError(e, 'Failed to open preferences');
        }
    }

    _bindSettings() {

        this._settings.connect('changed', () => {
            this._reloadSettings();
        });

        this._reloadSettings();
    }

    _reloadSettings() {

        this.feature_activations = [
            this._settings.get_boolean('show-cpu'),
            this._settings.get_boolean('show-ram'),
            this._settings.get_boolean('show-net')
        ];

        this.b_open = this._settings.get_string("b-open");
        this.b_close = this._settings.get_string("b-close");
        this.delimiter = this._settings.get_string("delimiter");

        const spacingMap = {
            small: "  ",
            normal: "    ",
            wide: "        "
        };

        this.spacing = spacingMap[this._settings.get_string("spacing")] || "    ";

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

        const updated = [];

        for (let i = 0; i < this.feature_activations.length; i++) {
            if (this.feature_activations[i]) {
                updated.push(this.feature_functions[i](this));
            }
        }

        this._writeStatus(updated);
    }

    _writeStatus(values) {

        let output = "";

        for (const v of values) {
            if (v)
                output += v + this.spacing;
        }

        this.label.set_text(output.trim());
    }

    stop() {
        if (this._timeout)
            GLib.source_remove(this._timeout);

        this._timeout = undefined;
    }
}

GObject.registerClass({ GTypeName: 'RezMonIndicator' }, RezMonIndicator);