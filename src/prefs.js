'use strict';

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { readFileLines } from './utils/file.js';

export default class RezMonPreferences extends ExtensionPreferences {

    async fillPreferencesWindow(window) {
        this.initTranslations();

        const settings = this.getSettings('org.gnome.shell.extensions.rezmon');

        /*
        --------------------
        GENERAL PAGE
        --------------------
        */

        const generalPage = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic'
        });
        window.add(generalPage);

        const generalGroup = new Adw.PreferencesGroup({ title: _("Toggle Components") });
        generalPage.add(generalGroup);

        generalGroup.add(this._createSwitchRow(_("Show CPU"), settings, "show-cpu"));
        generalGroup.add(this._createSwitchRow(_("Show GPU"), settings, "show-gpu"));
        generalGroup.add(this._createSwitchRow(_("Show RAM"), settings, "show-ram"));
        generalGroup.add(this._createSwitchRow(_("Show SWAP"), settings, "show-swap"));
        generalGroup.add(this._createSwitchRow(_("Show DISK"), settings, "show-disk"));
        generalGroup.add(this._createSwitchRow(_("Show NET"), settings, "show-net"));

        const orderGroup = new Adw.PreferencesGroup({
            title: _("Metric Display Order"),
            description: _("Reorder how metrics appear on the top bar")
        });
        generalPage.add(orderGroup);

        this._orderRows = [];
        this._buildOrderRows(orderGroup, settings);

        /*
        --------------------
        CPU PAGE
        --------------------
        */

        const cpuPage = new Adw.PreferencesPage({
            title: _('CPU'),
            icon_name: 'utilities-system-monitor-symbolic'
        });
        window.add(cpuPage);

        const cpuGroup = new Adw.PreferencesGroup({ title: _("CPU Settings") });
        cpuPage.add(cpuGroup);

        cpuGroup.add(this._createSwitchRow(_("Usage %"), settings, "cpu-usage"));
        cpuGroup.add(this._createSwitchRow(_("Clock"), settings, "cpu-clock"));
        cpuGroup.add(this._createSwitchRow(_("Temperature"), settings, "cpu-temp"));

        /*
        --------------------
        GPU PAGE
        --------------------
        */

        const gpuPage = new Adw.PreferencesPage({
            title: _('GPU'),
            icon_name: 'video-display-symbolic'
        });
        window.add(gpuPage);

        const gpuGroup = new Adw.PreferencesGroup({ title: _("GPU Settings") });
        gpuPage.add(gpuGroup);

        gpuGroup.add(this._createComboRow(
            _("GPU Device"),
            settings,
            [_("Auto (Dedicated when Active)"), _("Dedicated GPU"), _("Integrated GPU")],
            ["auto", "dedicated", "integrated"],
            (value) => settings.set_string("gpu-device", value),
            () => settings.get_string("gpu-device")
        ));

        gpuGroup.add(this._createSwitchRow(_("Usage %"), settings, "gpu-usage"));
        gpuGroup.add(this._createSwitchRow(_("Clock"), settings, "gpu-clock"));
        gpuGroup.add(this._createSwitchRow(_("Temperature"), settings, "gpu-temp"));
        gpuGroup.add(this._createSwitchRow(_("VRAM Used"), settings, "gpu-vram-used"));
        gpuGroup.add(this._createSwitchRow(_("VRAM Free"), settings, "gpu-vram-free"));
        gpuGroup.add(this._createSwitchRow(_("VRAM Percent"), settings, "gpu-vram-percent"));

        /*
        --------------------
        RAM PAGE
        --------------------
        */

        const ramPage = new Adw.PreferencesPage({
            title: _('RAM'),
            icon_name: 'drive-harddisk-symbolic'
        });
        window.add(ramPage);

        const ramGroup = new Adw.PreferencesGroup({ title: _("RAM Settings") });
        ramPage.add(ramGroup);

        ramGroup.add(this._createSwitchRow(_("Used"), settings, "ram-used"));
        ramGroup.add(this._createSwitchRow(_("Free"), settings, "ram-free"));
        ramGroup.add(this._createSwitchRow(_("Percent"), settings, "ram-percent"));

        /*
        --------------------
        SWAP PAGE
        --------------------
        */

        const swapPage = new Adw.PreferencesPage({
            title: _('SWAP'),
            icon_name: 'drive-harddisk-symbolic'
        });
        window.add(swapPage);

        const swapGroup = new Adw.PreferencesGroup({ title: _("SWAP Settings") });
        swapPage.add(swapGroup);

        swapGroup.add(this._createSwitchRow(_("Used"), settings, "swap-used"));
        swapGroup.add(this._createSwitchRow(_("Free"), settings, "swap-free"));
        swapGroup.add(this._createSwitchRow(_("Percent"), settings, "swap-percent"));

        /*
        --------------------
        DISK PAGE
        --------------------
        */

        const diskPage = new Adw.PreferencesPage({
            title: _('Disk'),
            icon_name: 'drive-harddisk-symbolic'
        });
        window.add(diskPage);

        const diskGroup = new Adw.PreferencesGroup({ title: _("Disk Settings") });
        diskPage.add(diskGroup);

        diskGroup.add(this._createSwitchRow(_("Read Rate"), settings, "disk-read"));
        diskGroup.add(this._createSwitchRow(_("Write Rate"), settings, "disk-write"));
        diskGroup.add(this._createSwitchRow(_("Space Used"), settings, "disk-space-used"));
        diskGroup.add(this._createSwitchRow(_("Space Free"), settings, "disk-space-free"));
        diskGroup.add(this._createSwitchRow(_("Space %"), settings, "disk-space-percent"));

        /*
        --------------------
        NETWORK PAGE
        --------------------
        */

        const netPage = new Adw.PreferencesPage({
            title: _('Network'),
            icon_name: 'network-workgroup-symbolic'
        });
        window.add(netPage);

        const netGroup = new Adw.PreferencesGroup({ title: _("Network Settings") });
        netPage.add(netGroup);

        const ifaces = ['auto'];
        const labels = [_('Auto (Default Route)')];
        try {
            const lines = await readFileLines('/proc/net/dev');
            for (let i = 2; i < lines.length; i++) {
                const line = lines[i].trim();
                const colon = line.indexOf(':');
                if (colon > 0) {
                    const iface = line.substring(0, colon).trim();
                    if (iface && iface !== 'lo') {
                        ifaces.push(iface);
                        labels.push(iface);
                    }
                }
            }
        } catch (_) {}

        const savedIface = settings.get_string('net-interface');
        if (savedIface && !ifaces.includes(savedIface)) {
            ifaces.push(savedIface);
            labels.push(`${savedIface} ` + _('(Offline)'));
        }

        netGroup.add(this._createComboRow(
            _("Monitored Interface"),
            settings,
            labels,
            ifaces,
            (val) => settings.set_string("net-interface", val),
            () => settings.get_string("net-interface")
        ));

        netGroup.add(this._createSwitchRow(_("Download"), settings, "net-down"));
        netGroup.add(this._createSwitchRow(_("Upload"), settings, "net-up"));

        /*
        --------------------
        APPEARANCE PAGE
        --------------------
        */

        const appearancePage = new Adw.PreferencesPage({
            title: _('Appearance'),
            icon_name: 'preferences-desktop-theme-symbolic'
        });
        window.add(appearancePage);

        const appearanceGroup = new Adw.PreferencesGroup({ title: _("Appearance Settings") });
        appearancePage.add(appearanceGroup);

        appearanceGroup.add(this._createComboRow(
            _("Brackets"),
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
            _("Delimiter"),
            settings,
            ["|", "-", "~", "/", "\\", ":", ";", "+", "=", _("space")],
            ["|", "-", "~", "/", "\\", ":", ";", "+", "=", " "],
            (value) => settings.set_string("delimiter", value),
            () => settings.get_string("delimiter")
        ));

        appearanceGroup.add(this._createComboRow(
            _("Spacing"),
            settings,
            [_("Small"), _("Normal"), _("Wide")],
            ["small", "normal", "wide"],
            (value) => settings.set_string("spacing", value),
            () => settings.get_string("spacing")
        ));

        appearanceGroup.add(this._createComboRow(
            _("Temperature Unit"),
            settings,
            [_("Celsius (°C)"), _("Fahrenheit (°F)")],
            ["celsius", "fahrenheit"],
            (value) => settings.set_string("temp-unit", value),
            () => settings.get_string("temp-unit")
        ));

        appearanceGroup.add(this._createComboRow(
            _("Label Style"),
            settings,
            [
                _("Symbols (⚡, 🎮, 🧠, ...)"),
                _("Text (CPU, GPU, RAM, ...)"),
                _("Symbols & Text (⚡ CPU, ...)"),
                _("None (Compact)")
            ],
            ["symbol", "text", "both", "none"],
            (value) => settings.set_string("label-style", value),
            () => settings.get_string("label-style")
        ));

        /*
        --------------------
        CUSTOM METRIC ICONS
        --------------------
        */

        const iconGroup = new Adw.PreferencesGroup({
            title: _("Custom Metric Icons / Symbols"),
            description: _("Select or customize the symbol used for each metric"),
        });
        appearancePage.add(iconGroup);

        const cpuPresets = [
            { label: _("⚡  Lightning (Default)"), value: "⚡" },
            { label: _("⚙  Gear"), value: "⚙" },
            { label: _("🔲  Processor Die"), value: "🔲" },
            { label: _("⎈  Processor Core"), value: "⎈" },
            { label: _("💻  Computer"), value: "💻" },
            { label: _("🖥  Desktop"), value: "🖥" },
        ];

        const gpuPresets = [
            { label: _("🎮  Gamepad (Default)"), value: "🎮" },
            { label: _("🖥  Display Monitor"), value: "🖥" },
            { label: _("🎬  Clapper / Video"), value: "🎬" },
            { label: _("🖼  Frame / Graphics"), value: "🖼" },
            { label: _("🕹  Joystick"), value: "🕹" },
        ];

        const ramPresets = [
            { label: _("🧠  Brain (Default)"), value: "🧠" },
            { label: _("🗄  Memory Bank"), value: "🗄" },
            { label: _("▮  Memory Stick"), value: "▮" },
            { label: _("▤  Matrix"), value: "▤" },
            { label: _("📦  Storage Blocks"), value: "📦" },
        ];

        const swapPresets = [
            { label: _("⇄  Horizontal Arrows (Default)"), value: "⇄" },
            { label: _("⇅  Vertical Arrows"), value: "⇅" },
            { label: _("⇆  Left-Right Arrows"), value: "⇆" },
            { label: _("⇋  Exchange Harpoons"), value: "⇋" },
        ];

        const diskPresets = [
            { label: _("💽  Drive Disc (Default)"), value: "💽" },
            { label: _("🖴  Hard Disk"), value: "🖴" },
            { label: _("💾  Floppy Disk"), value: "💾" },
            { label: _("📁  Folder / Storage"), value: "📁" },
            { label: _("🗄  Filing Cabinet"), value: "🗄" },
        ];

        const netPresets = [
            { label: _("📶  Signal Bars (Default)"), value: "📶" },
            { label: _("🌐  Globe"), value: "🌐" },
            { label: _("⇅  Upload / Download"), value: "⇅" },
            { label: _("📡  Satellite"), value: "📡" },
            { label: _("🖧  LAN Network"), value: "🖧" },
        ];

        const selectors = [];
        const addSelector = (title, key, presets, defaultVal) => {
            const s = this._createIconSelectorRow(title, key, presets, defaultVal, settings);
            iconGroup.add(s.row);
            iconGroup.add(s.entryRow);
            selectors.push(s);
        };

        addSelector(_("CPU Icon"), "symbol-cpu", cpuPresets, "⚡");
        addSelector(_("GPU Icon"), "symbol-gpu", gpuPresets, "🎮");
        addSelector(_("RAM Icon"), "symbol-ram", ramPresets, "🧠");
        addSelector(_("SWAP Icon"), "symbol-swap", swapPresets, "⇄");
        addSelector(_("Disk Icon"), "symbol-disk", diskPresets, "💽");
        addSelector(_("Network Icon"), "symbol-net", netPresets, "📶");

        const resetIconsRow = new Adw.ActionRow({
            title: _("Reset Icons to Defaults"),
            subtitle: _("Revert all metric symbols back to: ⚡ 🎮 🧠 ⇄ 💽 📶"),
        });

        const resetIconsButton = new Gtk.Button({
            label: _("Reset"),
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });

        resetIconsButton.connect('clicked', () => {
            settings.set_string('symbol-cpu', '⚡');
            settings.set_string('symbol-gpu', '🎮');
            settings.set_string('symbol-ram', '🧠');
            settings.set_string('symbol-swap', '⇄');
            settings.set_string('symbol-disk', '💽');
            settings.set_string('symbol-net', '📶');
            selectors.forEach(s => s.updateState());
        });

        resetIconsRow.add_suffix(resetIconsButton);
        iconGroup.add(resetIconsRow);

        /*
        --------------------
        ADVANCED PAGE
        --------------------
        */

        const advancedPage = new Adw.PreferencesPage({
            title: _('Misc'),
            icon_name: 'applications-system-symbolic'
        });
        window.add(advancedPage);

        const advancedGroup = new Adw.PreferencesGroup({ title: _("Misc Settings") });
        advancedPage.add(advancedGroup);

        advancedGroup.add(this._createComboRow(
            _("Update Interval (sec)"),
            settings,
            ["1", "2", "3", "4", "5"],
            [1, 2, 3, 4, 5],
            (value) => settings.set_int("update-interval", value),
            () => settings.get_int("update-interval")
        ));

        const positionGroup = new Adw.PreferencesGroup({
            title: _("Panel & Clock Position"),
            description: _("Customize positions on the top status bar")
        });
        advancedPage.add(positionGroup);

        positionGroup.add(this._createComboRow(
            _("Panel Position"),
            settings,
            [_("Right (Default)"), _("Center"), _("Left")],
            ["right", "center", "left"],
            (value) => settings.set_string("panel-position", value),
            () => settings.get_string("panel-position")
        ));

        positionGroup.add(this._createSpinRow(
            _("Panel Order Index / Priority"),
            settings,
            "panel-priority",
            0, 30, 1
        ));

        positionGroup.add(this._createComboRow(
            _("Clock Position"),
            settings,
            [_("Center (Default)"), _("Right"), _("Left")],
            ["center", "right", "left"],
            (value) => settings.set_string("clock-position", value),
            () => settings.get_string("clock-position")
        ));

        const alertGroup = new Adw.PreferencesGroup({ title: _("Alert Thresholds") });
        advancedPage.add(alertGroup);

        alertGroup.add(this._createSpinRow(
            _("Usage Warning Threshold (%)"),
            settings,
            "warn-threshold",
            1, 100, 1
        ));

        alertGroup.add(this._createSpinRow(
            _("Usage Critical Threshold (%)"),
            settings,
            "crit-threshold",
            1, 100, 1
        ));

        alertGroup.add(this._createSpinRow(
            _("Temperature Warning Threshold (℃)"),
            settings,
            "temp-warn-threshold",
            30, 120, 1
        ));

        alertGroup.add(this._createSpinRow(
            _("Temperature Critical Threshold (℃)"),
            settings,
            "temp-crit-threshold",
            30, 120, 1
        ));
    }

    _createSpinRow(title, settings, key, lower, upper, step) {
        const adj = new Gtk.Adjustment({
            lower,
            upper,
            step_increment: step,
            page_increment: step * 5,
        });
        const row = new Adw.SpinRow({
            title,
            adjustment: adj,
            numeric: true,
        });
        settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        return row;
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

    _createIconSelectorRow(title, key, presets, defaultVal, settings) {
        const row = new Adw.ComboRow({ title });
        const labels = presets.map(p => p.label);
        labels.push(_("Custom…"));
        const values = presets.map(p => p.value);

        const model = new Gtk.StringList();
        labels.forEach(l => model.append(l));
        row.model = model;

        const entryRow = new Adw.EntryRow({
            title: `${title} ` + _("(Custom Symbol)"),
            show_apply_button: true,
        });

        const updateState = () => {
            const currentVal = settings.get_string(key) || defaultVal;
            const presetIdx = values.indexOf(currentVal);
            if (presetIdx >= 0) {
                row.selected = presetIdx;
                entryRow.set_visible(false);
                entryRow.text = currentVal;
            } else {
                row.selected = values.length; // "Custom…"
                entryRow.set_visible(true);
                entryRow.text = currentVal;
            }
        };

        updateState();

        row.connect('notify::selected', () => {
            if (row.selected < values.length) {
                const selectedVal = values[row.selected];
                settings.set_string(key, selectedVal);
                entryRow.set_visible(false);
                entryRow.text = selectedVal;
            } else {
                entryRow.set_visible(true);
            }
        });

        entryRow.connect('apply', () => {
            const txt = entryRow.text.trim();
            if (txt) {
                settings.set_string(key, txt);
            }
        });

        entryRow.connect('notify::text', () => {
            const txt = entryRow.text.trim();
            if (txt) {
                settings.set_string(key, txt);
            }
        });

        return { row, entryRow, updateState };
    }

    _buildOrderRows(orderGroup, settings) {
        if (this._orderRows) {
            for (const row of this._orderRows) {
                orderGroup.remove(row);
            }
        }
        this._orderRows = [];

        const metricLabels = {
            cpu: _("CPU"),
            gpu: _("GPU"),
            ram: _("RAM"),
            swap: _("SWAP"),
            disk: _("Disk"),
            net: _("Network"),
        };

        const defaultOrder = ['cpu', 'gpu', 'ram', 'swap', 'disk', 'net'];
        let currentOrder = settings.get_strv('metric-order');
        if (!currentOrder || currentOrder.length === 0)
            currentOrder = [...defaultOrder];

        for (const m of defaultOrder) {
            if (!currentOrder.includes(m))
                currentOrder.push(m);
        }

        currentOrder.forEach((metricKey, idx) => {
            const label = metricLabels[metricKey] || metricKey.toUpperCase();
            const row = new Adw.ActionRow({
                title: `${idx + 1}.  ${label}`,
            });

            const upButton = new Gtk.Button({
                icon_name: 'go-up-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
                sensitive: idx > 0,
            });

            upButton.connect('clicked', () => {
                const order = [...currentOrder];
                const tmp = order[idx];
                order[idx] = order[idx - 1];
                order[idx - 1] = tmp;
                settings.set_strv('metric-order', order);
                this._buildOrderRows(orderGroup, settings);
            });

            const downButton = new Gtk.Button({
                icon_name: 'go-down-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
                sensitive: idx < currentOrder.length - 1,
            });

            downButton.connect('clicked', () => {
                const order = [...currentOrder];
                const tmp = order[idx];
                order[idx] = order[idx + 1];
                order[idx + 1] = tmp;
                settings.set_strv('metric-order', order);
                this._buildOrderRows(orderGroup, settings);
            });

            row.add_suffix(upButton);
            row.add_suffix(downButton);
            orderGroup.add(row);
            this._orderRows.push(row);
        });

        const resetRow = new Adw.ActionRow({
            title: _("Reset to Default Order"),
        });
        const resetBtn = new Gtk.Button({
            label: _("Reset"),
            valign: Gtk.Align.CENTER,
        });
        resetBtn.connect('clicked', () => {
            settings.set_strv('metric-order', defaultOrder);
            this._buildOrderRows(orderGroup, settings);
        });
        resetRow.add_suffix(resetBtn);
        orderGroup.add(resetRow);
        this._orderRows.push(resetRow);
    }
}
