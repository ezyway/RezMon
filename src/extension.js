/*
 * Author: AZZlOl
 * Description: Displays CPU(use percentage, average clock speed, temp), RAM(Used, Free),
 * NET(Download, Upload) usage on the top bar.
 * Version: 22
 * GNOME Shell Tested: 51
 * GNOME Shell Supported: 45, 46, 47, 48, 49, 50, 51
 * GitHub: https://github.com/ezyway/RezMon
 * 
 * Credits: Michael Knap - System Monitor Tray Indicator - https://github.com/michaelknap/gnome-system-monitor-indicator
 * License: MIT License
 */

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import { panel } from 'resource:///org/gnome/shell/ui/main.js';

import { RezMonIndicator } from './indicator.js';

export default class RezMonExtension extends Extension {

    _indicator = null;
    _settings = null;
    _settingsSignals = [];
    _originalClockBox = null;
    _originalClockIndex = 0;

    enable() {
        this.initTranslations();
        this._settings = this.getSettings('org.gnome.shell.extensions.rezmon');
        this._indicator = new RezMonIndicator(this, this._settings);

        // Record original clock location before modifying positions
        const dateMenu = panel.statusArea.dateMenu;
        if (dateMenu && dateMenu.container) {
            const parent = dateMenu.container.get_parent();
            if (parent) {
                this._originalClockBox = parent;
                this._originalClockIndex = parent.get_children().indexOf(dateMenu.container);
            }
        }

        const pos = this._settings.get_string('panel-position') || 'right';
        const priority = this._settings.get_int('panel-priority');

        panel.addToStatusArea('RezMon', this._indicator, priority, pos);

        // Apply clock position if requested
        this._applyClockPosition();

        // Listen for setting changes
        this._settingsSignals.push(
            this._settings.connect('changed::panel-position', () => this._applyIndicatorPosition()),
            this._settings.connect('changed::panel-priority', () => this._applyIndicatorPosition()),
            this._settings.connect('changed::clock-position', () => this._applyClockPosition())
        );
    }

    _applyIndicatorPosition() {
        if (!this._indicator || !this._indicator.container)
            return;

        const pos = this._settings.get_string('panel-position') || 'right';
        const priority = this._settings.get_int('panel-priority');
        this._moveContainerToBox(this._indicator.container, pos, priority);
    }

    _applyClockPosition() {
        const dateMenu = panel.statusArea.dateMenu;
        if (!dateMenu || !dateMenu.container)
            return;

        const clockPos = this._settings.get_string('clock-position') || 'center';
        const boxes = {
            left: panel._leftBox,
            center: panel._centerBox,
            right: panel._rightBox,
        };
        const targetBox = boxes[clockPos] || panel._centerBox;
        const container = dateMenu.container;
        const currentParent = container.get_parent();

        if (currentParent === targetBox)
            return;

        if (currentParent)
            currentParent.remove_child(container);

        // For left: index 1 (after activities / workspace pill) if available, else 0
        // For right: index 0 (leftmost on right side)
        // For center: index 0
        const targetIndex = (clockPos === 'left' && targetBox.get_n_children() > 0) ? 1 : 0;
        targetBox.insert_child_at_index(container, targetIndex);
    }

    _moveContainerToBox(container, boxName, priority = 0) {
        if (!container)
            return;

        const boxes = {
            left: panel._leftBox,
            center: panel._centerBox,
            right: panel._rightBox,
        };
        const targetBox = boxes[boxName] || panel._rightBox;
        const currentParent = container.get_parent();

        if (currentParent)
            currentParent.remove_child(container);

        const nChildren = targetBox.get_n_children();
        const idx = Math.min(Math.max(0, priority), nChildren);
        targetBox.insert_child_at_index(container, idx);
    }

    disable() {
        // Disconnect settings signals
        if (this._settings) {
            for (const id of this._settingsSignals) {
                this._settings.disconnect(id);
            }
            this._settingsSignals = [];
        }

        // Restore clock to original position
        if (this._originalClockBox) {
            const dateMenu = panel.statusArea.dateMenu;
            if (dateMenu && dateMenu.container) {
                const container = dateMenu.container;
                const currentParent = container.get_parent();
                if (currentParent !== this._originalClockBox) {
                    if (currentParent)
                        currentParent.remove_child(container);
                    const idx = Math.min(
                        Math.max(0, this._originalClockIndex ?? 0),
                        this._originalClockBox.get_n_children()
                    );
                    this._originalClockBox.insert_child_at_index(container, idx);
                }
            }
            this._originalClockBox = null;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        this._settings = null;
    }
}
