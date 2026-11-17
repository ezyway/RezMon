'use strict';

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';

import { Button } from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { Ornament, PopupMenuItem, PopupBaseMenuItem, PopupSeparatorMenuItem } from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { readFileLines } from './utils/file.js';
import { updateCPU } from './metrics/cpu.js';
import { filterSelectedGpus, listGPUs, updateGPU } from './metrics/gpu.js';
import { updateRAM } from './metrics/ram.js';
import { updateSWAP } from './metrics/swap.js';
import { updateDisk } from './metrics/disk.js';
import { updateNET } from './metrics/net.js';
import { getTopProcesses } from './metrics/top.js';

const POPUP_MENU_WIDTH = 420;
const POPUP_MENU_FONT_SIZE = '8pt';
const POPUP_DASH_SIDE_MARGIN = 10;

function createBoxLayout(params = {}) {
    const vertical = params.vertical;
    const rest = { ...params };
    delete rest.vertical;

    const box = new St.BoxLayout(rest);
    if (vertical === undefined)
        return box;

    try {
        box.orientation = vertical
            ? Clutter.Orientation.VERTICAL
            : Clutter.Orientation.HORIZONTAL;
    } catch (_) {
        box.vertical = vertical;
    }
    return box;
}

export class RezMonIndicator extends Button {

    _init(extension, settings) {
        super._init(0, "RezMon", false);
        this.menu?.setSourceAlignment(0);

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
        this._loadGpuInventory();
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

        this._detectedGpus = [];
        this._dashboardGpuSlots = null;
        this._dash = null;
        this._topProcesses = { topCpu: [], topMem: [] };
    }

    _buildMenu() {

        this.menu.removeAll();

        // 1. Dashboard summary card
        this._dashboardItem = new PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'rezmon-menu-dashboard',
        });
        this._dashboardItem.set_style(`font-size: ${POPUP_MENU_FONT_SIZE}; padding: 0;`);
        this._dashboardItem.setOrnament(Ornament.HIDDEN);
        this._dashboardItem.x_expand = true;
        this._dashboardItem.clip_to_allocation = true;
        this._buildDashboard();
        this._dashboardItem.add_child(this._dash.box);
        this.menu.addMenuItem(this._dashboardItem);

        if (this.menu?.actor)
            this.menu.actor.add_style_class_name('rezmon-popup-menu');
        if (this.menu && this.menu.box) {
            this.menu.box.set_style(`min-width: ${POPUP_MENU_WIDTH}px; max-width: ${POPUP_MENU_WIDTH}px; font-size: ${POPUP_MENU_FONT_SIZE};`);
        }

        // 2. Separator
        this.menu.addMenuItem(new PopupSeparatorMenuItem());

        // 3. Dynamic System Monitor Launchers
        const monitors = this._getAvailableMonitors();
        for (const mon of monitors) {
            const item = new PopupMenuItem(mon.name);
            item.set_style(`font-size: ${POPUP_MENU_FONT_SIZE};`);
            item.connect('activate', () => mon.launch());
            this.menu.addMenuItem(item);
        }

        // 4. Open Settings
        const settingsItem = new PopupMenuItem(_("Open Settings"));
        settingsItem.set_style(`font-size: ${POPUP_MENU_FONT_SIZE};`);
        settingsItem.connect('activate', () => {
            this._extension.openPreferences();
        });
        this.menu.addMenuItem(settingsItem);

        // Update dashboard and cadence whenever menu opens or closes
        this.menu.connectObject('open-state-changed', (menu, isOpen) => {
            if (isOpen) {
                menu.setSourceAlignment(0);
                this._dashboardGpuSlots = this._currentGpuSlots();
                this._menuTicks = 0;
                this._updateMetrics();
                this._refreshTopProcesses();
                this._restartLoop(1);
            } else {
                this._dashboardGpuSlots = null;
                this._menuTicks = 0;
                this._restartLoop(this.interval);
            }
        }, this);
    }

    async _loadGpuInventory() {
        try {
            this._detectedGpus = await listGPUs() || [];
        } catch (_) {
            this._detectedGpus = [];
        }
        if (this.menu?.isOpen)
            this._updateDashboard();
    }

    _currentGpuSlots() {
        const detected = Array.isArray(this._detectedGpus) ? this._detectedGpus : [];
        const selected = detected.length
            ? filterSelectedGpus(detected, this.gpuSelected)
            : this._getVisibleGpus();
        return selected.map(gpu => ({
            id: gpu.id,
            index: gpu.index,
            name: gpu.name || 'Unknown GPU',
        }));
    }

    _gpuSlotsForDashboard() {
        const slots = this._currentGpuSlots();
        if (!this.menu?.isOpen)
            return slots;
        if (!Array.isArray(this._dashboardGpuSlots) || this._dashboardGpuSlots.length === 0)
            this._dashboardGpuSlots = slots;
        return this._dashboardGpuSlots;
    }

    _refreshTopProcesses() {
        getTopProcesses().then((top) => {
            if (top?.topCpu?.length || top?.topMem?.length)
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

    _createDashLabel(text = '', styleClass = 'rezmon-dash-text') {
        const label = new St.Label({
            text: text ?? '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: styleClass,
        });
        label.clutter_text.set_line_wrap(false);
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
        return label;
    }

    _createEllipsizeLabel(text = '', styleClass = 'rezmon-dash-sub') {
        const label = this._createDashLabel(text, styleClass);
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        return label;
    }

    _createFlexRow() {
        const row = createBoxLayout({
            vertical: false,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'rezmon-dash-row',
        });
        const left = createBoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'rezmon-dash-left',
            style: 'spacing: 6px;',
        });
        const spacer = new St.Widget({
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            style_class: 'rezmon-dash-spacer',
        });
        const right = createBoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'rezmon-dash-right',
            style: 'spacing: 6px;',
        });
        row.add_child(left);
        row.add_child(spacer);
        row.add_child(right);
        return { row, left, right };
    }

    _addRightSep(right) {
        right.add_child(this._createDashLabel('│', 'rezmon-dash-sep'));
    }

    _createMetricRow() {
        const section = createBoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'rezmon-dash-metric',
            style: 'spacing: 1px;',
        });

        const title = createBoxLayout({
            vertical: false,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'rezmon-dash-title-row',
            style: 'spacing: 6px;',
        });
        const icon = this._createDashLabel('', 'rezmon-dash-icon');
        const name = this._createEllipsizeLabel('', 'rezmon-dash-name');
        name.x_expand = true;
        name.x_align = Clutter.ActorAlign.FILL;
        title.add_child(icon);
        title.add_child(name);

        const { row, left, right } = this._createFlexRow();
        const bar = this._createDashLabel(this._makeProgressBar(0), 'rezmon-dash-bar');
        left.add_child(bar);

        section.add_child(title);
        section.add_child(row);
        return { row: section, left, right, icon, name, bar };
    }

    _createGpuRow() {
        const metric = this._createMetricRow();
        const usage = this._createDashLabel(this._dashPct(NaN), 'rezmon-dash-num');
        const temp = this._createDashLabel('—℃', 'rezmon-dash-num');
        const vram = this._createDashLabel('VRAM —.–G', 'rezmon-dash-num');
        metric.right.add_child(usage);
        this._addRightSep(metric.right);
        metric.right.add_child(temp);
        this._addRightSep(metric.right);
        metric.right.add_child(vram);
        return { ...metric, usage, temp, vram };
    }

    _createProcessRow() {
        const row = createBoxLayout({
            vertical: false,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'rezmon-dash-row rezmon-dash-proc-row',
            style: 'spacing: 6px;',
        });
        const bar = this._createDashLabel(this._makeProgressBar(0), 'rezmon-dash-bar');
        const name = this._createEllipsizeLabel('—', 'rezmon-dash-proc-name');
        name.x_expand = true;
        name.x_align = Clutter.ActorAlign.FILL;
        const pct = this._createDashLabel(this._dashPct(NaN), 'rezmon-dash-pct');
        pct.x_align = Clutter.ActorAlign.END;
        row.add_child(bar);
        row.add_child(name);
        row.add_child(pct);
        return { row, bar, name, pct };
    }

    _buildDashboard() {
        const box = createBoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'rezmon-dashboard',
            style: `font-size: ${POPUP_MENU_FONT_SIZE}; spacing: 3px; margin-left: ${POPUP_DASH_SIDE_MARGIN}px; margin-right: ${POPUP_DASH_SIDE_MARGIN}px;`,
        });
        box.clip_to_allocation = true;

        const heading = this._createDashLabel('System Status Overview', 'rezmon-dash-heading');
        box.add_child(heading);

        const cpu = this._createMetricRow();
        const cpuUsage = this._createDashLabel(this._dashPct(NaN), 'rezmon-dash-num');
        const cpuClock = this._createDashLabel(this._dashClock(NaN), 'rezmon-dash-num');
        const cpuTemp = this._createDashLabel('—℃', 'rezmon-dash-num');
        cpu.right.add_child(cpuUsage);
        this._addRightSep(cpu.right);
        cpu.right.add_child(cpuClock);
        this._addRightSep(cpu.right);
        cpu.right.add_child(cpuTemp);
        box.add_child(cpu.row);

        const ram = this._createMetricRow();
        const ramUsed = this._createDashLabel(this._dashGb(NaN), 'rezmon-dash-num');
        const ramFree = this._createDashLabel(this._dashPct(NaN), 'rezmon-dash-num');
        ram.right.add_child(ramUsed);
        this._addRightSep(ram.right);
        ram.right.add_child(ramFree);
        box.add_child(ram.row);

        const swap = this._createMetricRow();
        const swapUsed = this._createDashLabel(this._dashGb(NaN), 'rezmon-dash-num');
        const swapFree = this._createDashLabel(this._dashPct(NaN), 'rezmon-dash-num');
        swap.right.add_child(swapUsed);
        this._addRightSep(swap.right);
        swap.right.add_child(swapFree);
        box.add_child(swap.row);

        const gpuBox = createBoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'rezmon-dash-gpu-list',
        });
        box.add_child(gpuBox);

        const disk = this._createMetricRow();
        const diskUsed = this._createDashLabel('—.– GB / —.– GB', 'rezmon-dash-num');
        const diskPct = this._createDashLabel(this._dashPct(NaN), 'rezmon-dash-num');
        disk.right.add_child(diskUsed);
        this._addRightSep(disk.right);
        disk.right.add_child(diskPct);
        box.add_child(disk.row);

        const netHead = this._createFlexRow();
        const netIcon = this._createDashLabel(this.symbolNet || '📶', 'rezmon-dash-icon');
        const netName = this._createEllipsizeLabel('Network', 'rezmon-dash-name');
        netHead.left.add_child(netIcon);
        netHead.left.add_child(netName);
        box.add_child(netHead.row);

        const netDown = this._createFlexRow();
        const netDownBar = this._createDashLabel(this._makeProgressBar(0), 'rezmon-dash-bar');
        const netDownLabel = this._createDashLabel('↓', 'rezmon-dash-dir');
        const netDownVal = this._createDashLabel(this._formatDataRate(0), 'rezmon-dash-pct');
        netDown.left.add_child(netDownBar);
        netDown.left.add_child(netDownLabel);
        netDown.right.add_child(netDownVal);
        box.add_child(netDown.row);

        const netUp = this._createFlexRow();
        const netUpBar = this._createDashLabel(this._makeProgressBar(0), 'rezmon-dash-bar');
        const netUpLabel = this._createDashLabel('↑', 'rezmon-dash-dir');
        const netUpVal = this._createDashLabel(this._formatDataRate(0), 'rezmon-dash-pct');
        netUp.left.add_child(netUpBar);
        netUp.left.add_child(netUpLabel);
        netUp.right.add_child(netUpVal);
        box.add_child(netUp.row);

        box.add_child(this._createDashLabel('Active Processes', 'rezmon-dash-heading'));
        box.add_child(this._createDashLabel('Top CPU', 'rezmon-dash-subtitle'));
        const procCpu = [this._createProcessRow(), this._createProcessRow(), this._createProcessRow()];
        for (const proc of procCpu)
            box.add_child(proc.row);

        box.add_child(this._createDashLabel('Top Memory', 'rezmon-dash-subtitle'));
        const procMem = [this._createProcessRow(), this._createProcessRow(), this._createProcessRow()];
        for (const proc of procMem)
            box.add_child(proc.row);

        this._dash = {
            box,
            cpu: { ...cpu, usage: cpuUsage, clock: cpuClock, temp: cpuTemp },
            ram: { ...ram, used: ramUsed, free: ramFree },
            swap: { ...swap, used: swapUsed, free: swapFree },
            gpuBox,
            gpuRows: [],
            disk: { ...disk, used: diskUsed, pct: diskPct },
            net: {
                icon: netIcon,
                name: netName,
                downBar: netDownBar,
                downVal: netDownVal,
                upBar: netUpBar,
                upVal: netUpVal,
            },
            procCpu,
            procMem,
        };
        this._updateDashboard();
    }

    _setDashText(label, text) {
        const value = text ?? '';
        if (!label || label.text === value)
            return;
        label.text = value;
    }

    _syncGpuDashRows(slots) {
        const ids = slots.map(slot => slot.id).join('\0');
        if (this._dash.gpuKey === ids)
            return;

        this._dash.gpuBox.destroy_all_children();
        this._dash.gpuRows = slots.map(() => {
            const row = this._createGpuRow();
            this._dash.gpuBox.add_child(row.row);
            return row;
        });
        this._dash.gpuKey = ids;
    }

    _fillProcessRows(rows, list, kind) {
        for (let i = 0; i < rows.length; i++) {
            const proc = Array.isArray(list) ? list[i] : null;
            const pctVal = kind === 'mem'
                ? (Number.isFinite(proc?.mem) ? proc.mem : 0)
                : (Number.isFinite(proc?.cpu) ? proc.cpu : 0);
            const pct = !proc
                ? this._dashPct(NaN)
                : kind === 'mem'
                    ? `${Number(proc.mem || 0).toFixed(1)}%`
                    : `${Math.round(proc.cpu || 0)}%`;
            this._setDashText(rows[i].bar, this._makeProgressBar(pctVal));
            this._setDashText(rows[i].name, proc?.name || '—');
            this._setDashText(rows[i].pct, pct);
        }
    }

    _updateDashboard() {
        if (!this._dash)
            return;

        const cpu = this._lastMetrics?.cpu || {};
        const ram = this._lastMetrics?.ram || {};
        const swap = this._lastMetrics?.swap || {};
        const disk = this._lastMetrics?.disk || {};
        const net = this._lastMetrics?.net || {};
        const gpuMetrics = new Map(
            (Array.isArray(this._lastMetrics?.gpu) ? this._lastMetrics.gpu : [])
                .filter(gpu => gpu?.id)
                .map(gpu => [gpu.id, gpu])
        );

        const cpuPct = Number.isFinite(cpu.usage) ? cpu.usage : 0;
        this._setDashText(this._dash.cpu.icon, this.symbolCpu || '⚡');
        this._setDashText(this._dash.cpu.name, 'CPU');
        this._setDashText(this._dash.cpu.bar, this._makeProgressBar(cpuPct));
        this._setDashText(this._dash.cpu.usage, this._dashPct(cpu.usage));
        this._setDashText(this._dash.cpu.clock, this._dashClock(cpu.clock));
        this._setDashText(this._dash.cpu.temp, this._dashTemp(cpu.temp));

        const ramUsed = Number.isFinite(ram.used) ? ram.used : null;
        const ramFree = Number.isFinite(ram.free) ? ram.free : null;
        const ramTotal = (ramUsed !== null && ramFree !== null) ? ramUsed + ramFree : null;
        this._setDashText(this._dash.ram.icon, this.symbolRam || '🧠');
        this._setDashText(this._dash.ram.name, 'RAM');
        this._setDashText(this._dash.ram.bar, this._makeProgressBar(ram.percent));
        this._setDashText(this._dash.ram.used, `${this._dashGb(ramUsed)} / ${this._dashGb(ramTotal)}`);
        this._setDashText(this._dash.ram.free, `${this._dashPct(ram.freePercent)} free`);

        const swapUsed = Number.isFinite(swap.used) ? swap.used : null;
        const swapFree = Number.isFinite(swap.free) ? swap.free : null;
        const swapTotal = (swapUsed !== null && swapFree !== null) ? swapUsed + swapFree : null;
        this._setDashText(this._dash.swap.icon, this.symbolSwap || '⇄');
        this._setDashText(this._dash.swap.name, 'SWAP');
        this._setDashText(this._dash.swap.bar, this._makeProgressBar(swap.percent));
        this._setDashText(this._dash.swap.used, `${this._dashGb(swapUsed)} / ${this._dashGb(swapTotal)}`);
        this._setDashText(this._dash.swap.free, `${this._dashPct(swap.freePercent)} free`);

        const gpuSlots = this._gpuSlotsForDashboard();
        this._syncGpuDashRows(gpuSlots);
        gpuSlots.forEach((slot, index) => {
            const widgets = this._dash.gpuRows[index];
            if (!widgets)
                return;
            const gpu = { ...slot, ...(gpuMetrics.get(slot.id) || {}) };
            const idle = Boolean(gpu.sleeping || gpu.unavailable);
            const gpuPct = idle ? 0 : (Number.isFinite(gpu.usage) ? gpu.usage : 0);
            const gpuNo = Number.isInteger(gpu.index) ? `GPU ${gpu.index}` : 'GPU';
            const stateTag = gpu.sleeping ? ' Sleep' : gpu.unavailable ? ' N/A' : '';
            const vramLabel = gpu.vramKind === 'shared' ? 'Shared' : 'VRAM';
            const vram = idle || !Number.isFinite(gpu.vramUsed) ? '—.–' : gpu.vramUsed.toFixed(1);
            const gpuLabel = gpu.name ? `${gpuNo} ${gpu.name}${stateTag}` : `${gpuNo}${stateTag}`;
            this._setDashText(widgets.icon, this.symbolGpu || '🎮');
            this._setDashText(widgets.name, gpuLabel);
            this._setDashText(widgets.bar, this._makeProgressBar(gpuPct));
            this._setDashText(widgets.usage, this._dashPct(gpuPct));
            this._setDashText(widgets.temp, idle ? '—℃' : this._dashTemp(gpu.temp));
            this._setDashText(widgets.vram, `${vramLabel} ${vram}G`);
        });

        const diskTotal = Number.isFinite(disk.spaceUsed) && Number.isFinite(disk.spaceFree)
            ? disk.spaceUsed + disk.spaceFree
            : null;
        this._setDashText(this._dash.disk.icon, this.symbolDisk || '💽');
        this._setDashText(this._dash.disk.name, 'Disk');
        this._setDashText(this._dash.disk.bar, this._makeProgressBar(disk.spacePercent));
        this._setDashText(this._dash.disk.used, `${this._formatDiskCapacity(disk.spaceUsed)} / ${this._formatDiskCapacity(diskTotal)}`);
        this._setDashText(this._dash.disk.pct, `${this._dashPct(disk.spacePercent)} used`);

        const iface = this.prev_iface || 'Active';
        this._setDashText(this._dash.net.icon, this.symbolNet || '📶');
        this._setDashText(this._dash.net.name, `Network (${iface})`);
        this._setDashText(this._dash.net.downBar, this._makeProgressBar(this._netBarPercent(net.down)));
        this._setDashText(this._dash.net.downVal, this._formatDataRate(net.down));
        this._setDashText(this._dash.net.upBar, this._makeProgressBar(this._netBarPercent(net.up)));
        this._setDashText(this._dash.net.upVal, this._formatDataRate(net.up));

        this._fillProcessRows(this._dash.procCpu, this._topProcesses?.topCpu, 'cpu');
        this._fillProcessRows(this._dash.procMem, this._topProcesses?.topMem, 'mem');
    }

    _makeProgressBar(percent, length = 14) {
        const raw = Number.isFinite(percent) ? percent : 0;
        const clamped = Math.max(0, Math.min(100, Math.round(raw)));
        const filled = Math.max(0, Math.min(length, Math.round((clamped / 100) * length)));
        return '█'.repeat(filled) + '░'.repeat(length - filled);
    }

    _netBarPercent(bytesPerSec) {
        const cap = 125000000; // 1 Gbit/s
        const raw = Number.isFinite(bytesPerSec) ? Math.max(0, bytesPerSec) : 0;
        return Math.min(100, (raw / cap) * 100);
    }

    _dashPct(value) {
        if (!Number.isFinite(value))
            return '  —%';
        return `${Math.round(value)}%`.padStart(4, ' ');
    }

    _dashClock(clock) {
        if (!Number.isFinite(clock))
            return '—.—— GHz';
        return `${clock.toFixed(2)} GHz`;
    }

    _dashTemp(tempC) {
        return this._formatTemperature(tempC, false) || '—℃';
    }

    _dashGb(value) {
        if (!Number.isFinite(value))
            return '—.– GB';
        return `${value.toFixed(1)} GB`;
    }

    _bindSettings() {
        this._settingsChangedId = this._settings.connect('changed', () => {
            this._reloadSettings();
        });

        this._reloadSettings();
        this._settingsReady = true;
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
        this.gpuSelected = this._settings.get_strv('gpu-selected');
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
        if (this._settingsReady)
            this._updateMetrics();
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
        if (this._destroyed)
            return;
        if (this._isUpdating) {
            this._metricsPending = true;
            return;
        }
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
            gpu: () => {
                if (!this.showGPU)
                    return null;
                const gpus = this._getVisibleGpus();
                return gpus.length ? this._formatGPU(gpus) : null;
            },
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
        if (this._metricsPending && !this._destroyed) {
            this._metricsPending = false;
            this._updateMetrics();
        }
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

    _formatTemperature(tempC, useColor = true) {

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

        if (useColor && color)
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

    _getVisibleGpus() {
        const gpus = Array.isArray(this._lastMetrics?.gpu) ? this._lastMetrics.gpu : [];
        return filterSelectedGpus(gpus, this.gpuSelected);
    }

    _getGpuPrefix(gpu, multi) {
        if (this.labelStyle === 'none')
            return "";

        if (!multi)
            return this._getPrefix('gpu');

        const index = Number.isInteger(gpu?.index) ? gpu.index : 0;
        const symbol = this.symbolGpu || "🎮";

        if (this.labelStyle === 'symbol')
            return symbol;
        if (this.labelStyle === 'both')
            return `${symbol} GPU${index}`;
        return `GPU${index}`;
    }

    _formatGPU(gpus) {
        if (!Array.isArray(gpus) || gpus.length === 0)
            return "";

        const multi = gpus.length > 1;
        const parts = gpus.map(gpu => this._formatOneGPU(gpu, multi)).filter(Boolean);
        return parts.join(this.spacing);
    }

    _formatOneGPU(gpu, multi) {
        if (!gpu)
            return "";

        const prefix = this._getGpuPrefix(gpu, multi);

        if (gpu.sleeping)
            return `${prefix}${this.b_open}Sleep${this.b_close}`;
        if (gpu.unavailable)
            return `${prefix}${this.b_open}N/A${this.b_close}`;

        const values = [];
        if (multi && this.labelStyle === 'symbol')
            values.push(`GPU${Number.isInteger(gpu.index) ? gpu.index : 0}`);

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
                return `${prefix}${this.b_open}Shared${this.b_close}`;
            if (this.gpuUsage || this.gpuClock || this.gpuTemp) {
                const fallback = gpu.name
                    ? GLib.markup_escape_text(gpu.name, -1)
                    : 'Active';
                return `${prefix}${this.b_open}${fallback}${this.b_close}`;
            }
            return "";
        }

        return `${prefix}${this.b_open}${values.join(` ${this.delimiter} `)}${this.b_close}`;
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
        const num = val < 10 && u > 0 ? val.toFixed(1) : String(Math.round(val));
        return `${num} ${units[u]}`;
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