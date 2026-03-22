'use strict';

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class RezMonPreferences extends ExtensionPreferences {

    fillPreferencesWindow(window) {

        const settings = this.getSettings('org.gnome.shell.extensions.rezmon');

        const page = new Adw.PreferencesPage();
        window.add(page);

        /*
        --------------------
        GENERAL
        --------------------
        */

        const generalGroup = new Adw.PreferencesGroup({
            title: 'General'
        });

        page.add(generalGroup);

        generalGroup.add(this._createSwitchRow("CPU", settings, "show-cpu"));
        generalGroup.add(this._createSwitchRow("RAM", settings, "show-ram"));
        generalGroup.add(this._createSwitchRow("NET", settings, "show-net"));

        /*
        --------------------
        APPEARANCE
        --------------------
        */

        const appearanceGroup = new Adw.PreferencesGroup({
            title: 'Appearance'
        });

        page.add(appearanceGroup);

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
        ADVANCED
        --------------------
        */

        const advancedGroup = new Adw.PreferencesGroup({
            title: 'Advanced'
        });

        page.add(advancedGroup);

        appearanceGroup.add(this._createComboRow(
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