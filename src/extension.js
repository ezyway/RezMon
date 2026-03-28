/*
 * Author: AZZlOl
 * Description: Displays CPU(use percentage, average clock speed, temp), RAM(Used, Free),
 * NET(Download, Upload) usage on the top bar.
 * Version: 20
 * GNOME Shell Tested: 50
 * GNOME Shell Supported: 45, 46, 47, 48, 49, 50
 * GitHub: https://github.com/ezyway/RezMon
 * 
 * Credits: Michael Knap - System Monitor Tray Indicator - https://github.com/michaelknap/gnome-system-monitor-indicator
 * License: MIT License
 */

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { panel } from 'resource:///org/gnome/shell/ui/main.js';

import { RezMonIndicator } from './indicator.js';

export default class RezMonExtension extends Extension {

    _indicator;

    enable() {
        const settings = this.getSettings('org.gnome.shell.extensions.rezmon');

        this._indicator = new RezMonIndicator(this, settings);

        panel.addToStatusArea('RezMon', this._indicator);
    }

    disable() {
        this._indicator.stop();
        this._indicator.destroy();
        this._indicator = undefined;
    }
}