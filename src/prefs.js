'use strict';

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class RezMonPreferences extends ExtensionPreferences {

    fillPreferencesWindow(window) {

        const settings = this.getSettings('org.gnome.shell.extensions.rezmon');

        /*
        --------------------
        GENERAL PAGE
        --------------------
        */

        const generalPage = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-system-symbolic'
        });
        window.add(generalPage);

        const generalGroup = new Adw.PreferencesGroup();
        generalPage.add(generalGroup);

        generalGroup.add(this._createSwitchRow("Show CPU", settings, "show-cpu"));
        generalGroup.add(this._createSwitchRow("Show RAM", settings, "show-ram"));
        generalGroup.add(this._createSwitchRow("Show NET", settings, "show-net"));

        /*
        --------------------
        CPU PAGE
        --------------------
        */

        const cpuPage = new Adw.PreferencesPage({
            title: 'CPU',
            icon_name: 'utilities-system-monitor-symbolic'
        });
        window.add(cpuPage);

        const cpuGroup = new Adw.PreferencesGroup({ title: "Details" });
        cpuPage.add(cpuGroup);

        cpuGroup.add(this._createSwitchRow("Usage %", settings, "cpu-usage"));
        cpuGroup.add(this._createSwitchRow("Clock", settings, "cpu-clock"));
        cpuGroup.add(this._createSwitchRow("Temperature", settings, "cpu-temp"));

        /*
        --------------------
        RAM PAGE
        --------------------
        */

        const ramPage = new Adw.PreferencesPage({
            title: 'RAM',
            icon_name: 'drive-harddisk-symbolic'
        });
        window.add(ramPage);

        const ramGroup = new Adw.PreferencesGroup({ title: "Details" });
        ramPage.add(ramGroup);

        ramGroup.add(this._createSwitchRow("Used", settings, "ram-used"));
        ramGroup.add(this._createSwitchRow("Free", settings, "ram-free"));
        ramGroup.add(this._createSwitchRow("Percent", settings, "ram-percent"));

        /*
        --------------------
        NETWORK PAGE
        --------------------
        */

        const netPage = new Adw.PreferencesPage({
            title: 'Network',
            icon_name: 'network-workgroup-symbolic'
        });
        window.add(netPage);

        const netGroup = new Adw.PreferencesGroup({ title: "Details" });
        netPage.add(netGroup);

        netGroup.add(this._createSwitchRow("Download", settings, "net-down"));
        netGroup.add(this._createSwitchRow("Upload", settings, "net-up"));

        /*
        --------------------
        APPEARANCE PAGE
        --------------------
        */

        const appearancePage = new Adw.PreferencesPage({
            title: 'Appearance',
            icon_name: 'preferences-desktop-theme-symbolic'
        });
        window.add(appearancePage);

        const appearanceGroup = new Adw.PreferencesGroup();
        appearancePage.add(appearanceGroup);

        appearanceGroup.add(this._createComboRow(
            "Brackets",
            settings,
            ["( )", "[ ]", "{ }"],
            ["()", "[]", "{}"],
            (value) => {
                settings.set_string("b-open", value[0]);
                settings.set_string("b-close", value[1]);
            },
            () => settings.get_string("b-open") + settings.get_string("b-close")
        ));

        appearanceGroup.add(this._createComboRow(
            "Delimiter",
            settings,
            ["|", "-", "~", "/", "\\", ":", ";", "+", "=", "space"],
            ["|", "-", "~", "/", "\\", ":", ";", "+", "=", " "],
            (value) => settings.set_string("delimiter", value),
            () => settings.get_string("delimiter")
        ));

        appearanceGroup.add(this._createComboRow(
            "Spacing",
            settings,
            ["Small", "Normal", "Wide"],
            ["small", "normal", "wide"],
            (value) => settings.set_string("spacing", value),
            () => settings.get_string("spacing")
        ));

        /*
        --------------------
        ADVANCED PAGE
        --------------------
        */

        const advancedPage = new Adw.PreferencesPage({
            title: 'Advanced',
            icon_name: 'applications-system-symbolic'
        });
        window.add(advancedPage);

        const advancedGroup = new Adw.PreferencesGroup();
        advancedPage.add(advancedGroup);

        advancedGroup.add(this._createComboRow(
            "Update Interval (sec)",
            settings,
            ["1", "2", "3", "4", "5"],
            [1, 2, 3, 4, 5],
            (value) => settings.set_int("update-interval", value),
            () => settings.get_int("update-interval")
        ));
    }

    _createSwitchRow(title, settings, key) {
        const row = new Adw.SwitchRow({ title });
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _createComboRow(title, settings, labels, values, onChange, getValue) {

        const row = new Adw.ComboRow({ title });

        const model = new Gtk.StringList();
        labels.forEach(l => model.append(l));

        row.model = model;

        const updateSelected = () => {
            const current = getValue();
            const index = values.findIndex(v => v === current);
            row.selected = index >= 0 ? index : 0;
        };

        updateSelected();

        row.connect('notify::selected', () => {
            const value = values[row.selected];
            onChange(value);
        });

        return row;
    }
}