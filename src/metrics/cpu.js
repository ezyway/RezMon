import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { readFileLines } from '../utils/file.js';

let cachedThermalPath = undefined;

function findThermalPath() {
    const preferredTypes = ['x86_pkg_temp', 'coretemp', 'k10temp', 'cpu_thermal', 'cpu-thermal', 'soc_thermal'];
    const tzBase = '/sys/class/thermal';
    const tzDir = Gio.File.new_for_path(tzBase);

    try {
        if (tzDir.query_exists(null)) {
            const enumerator = tzDir.enumerate_children(
                'standard::name',
                Gio.FileQueryInfoFlags.NONE,
                null
            );
            let info;
            const zones = [];
            while ((info = enumerator.next_file(null)) !== null) {
                const name = info.get_name();
                if (name.startsWith('thermal_zone')) {
                    zones.push(name);
                }
            }
            zones.sort((a, b) => {
                const numA = parseInt(a.replace('thermal_zone', ''), 10) || 0;
                const numB = parseInt(b.replace('thermal_zone', ''), 10) || 0;
                return numA - numB;
            });

            // 1. Look for preferred type
            for (const pref of preferredTypes) {
                for (const zone of zones) {
                    const typePath = `${tzBase}/${zone}/type`;
                    const typeLines = readFileLines(typePath);
                    if (typeLines.length > 0 && typeLines[0].trim().toLowerCase() === pref) {
                        const tempPath = `${tzBase}/${zone}/temp`;
                        if (GLib.file_test(tempPath, GLib.FileTest.EXISTS)) {
                            return tempPath;
                        }
                    }
                }
            }

            // 2. Fallback to any thermal_zone temp
            for (const zone of zones) {
                const tempPath = `${tzBase}/${zone}/temp`;
                if (GLib.file_test(tempPath, GLib.FileTest.EXISTS)) {
                    return tempPath;
                }
            }
        }
    } catch (e) {}

    // 3. Fallback to /sys/class/hwmon
    const hwmonBase = '/sys/class/hwmon';
    const hwmonDir = Gio.File.new_for_path(hwmonBase);
    try {
        if (hwmonDir.query_exists(null)) {
            const enumerator = hwmonDir.enumerate_children(
                'standard::name',
                Gio.FileQueryInfoFlags.NONE,
                null
            );
            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                const name = info.get_name();
                if (name.startsWith('hwmon')) {
                    const nameFile = `${hwmonBase}/${name}/name`;
                    const nameLines = readFileLines(nameFile);
                    if (nameLines.length > 0) {
                        const devName = nameLines[0].trim().toLowerCase();
                        if (['coretemp', 'k10temp', 'cpu'].some(p => devName.includes(p))) {
                            for (let i = 1; i <= 5; i++) {
                                const inputPath = `${hwmonBase}/${name}/temp${i}_input`;
                                if (GLib.file_test(inputPath, GLib.FileTest.EXISTS)) {
                                    return inputPath;
                                }
                            }
                        }
                    }
                }
            }
        }
    } catch (e) {}

    const defaultZone = '/sys/class/thermal/thermal_zone0/temp';
    if (GLib.file_test(defaultZone, GLib.FileTest.EXISTS)) {
        return defaultZone;
    }

    return null;
}

function getThermalPath() {
    if (cachedThermalPath !== undefined) {
        return cachedThermalPath;
    }
    cachedThermalPath = findThermalPath();
    return cachedThermalPath;
}

function getCPUClock() {
    // 1. Try standard Linux cpufreq sysfs interface (scaling_cur_freq in kHz)
    const freqPaths = [
        '/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq',
        '/sys/devices/system/cpu/cpufreq/policy0/scaling_cur_freq'
    ];
    for (const p of freqPaths) {
        if (GLib.file_test(p, GLib.FileTest.EXISTS)) {
            const lines = readFileLines(p);
            if (lines.length > 0 && lines[0].trim() !== '') {
                const khz = parseInt(lines[0].trim(), 10);
                if (Number.isFinite(khz) && khz > 0) {
                    return khz / 1000000;
                }
            }
        }
    }

    // 2. Fall back to /proc/cpuinfo
    try {
        const lines = readFileLines('/proc/cpuinfo');
        let mhz = 0;
        let count = 0;

        for (const line of lines) {
            const f = line.trim().split(/\s+/);
            if (f[0] === 'cpu' && f[1] === 'MHz' && f.length >= 4) {
                const val = parseFloat(f[3]);
                if (Number.isFinite(val)) {
                    mhz += val;
                    count++;
                }
            }
        }

        if (count > 0) {
            const ghz = (mhz / count) / 1000;
            if (Number.isFinite(ghz)) {
                return ghz;
            }
        }
    } catch (e) {}

    return null;
}

export function updateCPU(state) {

    let cpu_usage = null;
    let ghz_value = null;
    let cpu_temp = null;

    try {
        const lines = readFileLines('/proc/stat');

        for (const line of lines) {
            const fields = line.trim().split(/\s+/);

            if (fields[0] === 'cpu') {
                const nums = fields.slice(1).map(Number);

                const idle = nums[3];
                const iowait = nums[4] || 0;

                const total = nums.slice(0, 4).reduce((a, b) => a + b, 0) + iowait;
                const used = total - idle - iowait;

                const total_diff = total - state.prev_total;
                const used_diff = used - state.prev_used;

                if (total_diff > 0)
                    cpu_usage = ((used_diff / total_diff) * 100);

                state.prev_total = total;
                state.prev_used = used;

                break;
            }
        }
    } catch (e) { logError(e); }

    ghz_value = getCPUClock();

    const thermalPath = getThermalPath();
    if (thermalPath) {
        try {
            const lines = readFileLines(thermalPath);
            if (lines.length > 0 && lines[0].trim() !== '') {
                const raw = parseInt(lines[0].trim(), 10);
                if (Number.isFinite(raw)) {
                    cpu_temp = raw / 1000;
                }
            }
        } catch (e) {}
    }

    return {
        usage: cpu_usage,
        clock: ghz_value,
        temp: cpu_temp
    };
}