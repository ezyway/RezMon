'use strict';

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { readFile } from '../utils/file.js';

let detectedGPUs = null;
let cachedPkgTempPath = null;

function getPackageTemp() {
    if (cachedPkgTempPath && GLib.file_test(cachedPkgTempPath, GLib.FileTest.EXISTS)) {
        const raw = readFile(cachedPkgTempPath);
        if (raw) {
            const val = parseFloat(raw.trim());
            if (Number.isFinite(val)) return val / 1000;
        }
    }

    const tzBase = '/sys/class/thermal';
    const tzDir = Gio.File.new_for_path(tzBase);
    const preferred = ['x86_pkg_temp', 'coretemp', 'cpu_thermal', 'cpu-thermal', 'soc_thermal'];
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
                if (name.startsWith('thermal_zone')) zones.push(name);
            }
            zones.sort();
            for (const pref of preferred) {
                for (const z of zones) {
                    const type = readFile(`${tzBase}/${z}/type`);
                    if (type && type.trim().toLowerCase() === pref) {
                        const path = `${tzBase}/${z}/temp`;
                        if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
                            cachedPkgTempPath = path;
                            const raw = readFile(path);
                            if (raw) {
                                const val = parseFloat(raw.trim());
                                if (Number.isFinite(val)) return val / 1000;
                            }
                        }
                    }
                }
            }
        }
    } catch (e) {}

    return null;
}

function scanGPUs() {
    if (detectedGPUs) return detectedGPUs;

    let nvidiaCard = null;
    let amdCard = null;
    let intelCard = null;

    const drmDir = Gio.File.new_for_path('/sys/class/drm');
    if (drmDir.query_exists(null)) {
        try {
            const enumerator = drmDir.enumerate_children(
                'standard::name',
                Gio.FileQueryInfoFlags.NONE,
                null
            );
            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                const name = info.get_name();
                if (/^card\d+$/.test(name)) {
                    const devPath = `/sys/class/drm/${name}/device`;
                    const uevent = readFile(`${devPath}/uevent`);
                    let driver = '';
                    if (uevent) {
                        for (const line of uevent.split('\n')) {
                            if (line.startsWith('DRIVER=')) {
                                driver = line.split('=')[1].trim().toLowerCase();
                            }
                        }
                    }

                    if (driver === 'nvidia') {
                        nvidiaCard = { name, path: `/sys/class/drm/${name}`, devPath, driver };
                    } else if (driver === 'amdgpu') {
                        amdCard = { name, path: `/sys/class/drm/${name}`, devPath, driver };
                    } else if (driver === 'i915' || driver === 'xe') {
                        intelCard = { name, path: `/sys/class/drm/${name}`, devPath, driver };
                    }
                }
            }
        } catch (e) {}
    }

    const hasNvidiaSmi = GLib.find_program_in_path('nvidia-smi') !== null;

    detectedGPUs = {
        nvidia: nvidiaCard || (hasNvidiaSmi ? { driver: 'nvidia' } : null),
        amd: amdCard,
        intel: intelCard,
        hasNvidiaSmi,
    };

    return detectedGPUs;
}

function queryNvidia(gpus) {
    if (!gpus.nvidia || !gpus.hasNvidiaSmi) return null;

    // Check runtime power status to avoid waking sleeping dGPU on battery
    if (gpus.nvidia.devPath) {
        const runtimeStatus = readFile(`${gpus.nvidia.devPath}/power/runtime_status`);
        if (runtimeStatus && runtimeStatus.trim().toLowerCase() === 'suspended') {
            return {
                sleeping: true,
                name: 'NVIDIA',
                usage: 0,
                clock: 0,
                temp: null,
                vramUsed: 0,
                vramFree: 0,
                vramPercent: 0,
            };
        }
    }

    try {
        const [ok, out] = GLib.spawn_command_line_sync(
            'nvidia-smi --query-gpu=utilization.gpu,temperature.gpu,clocks.current.graphics,memory.used,memory.total --format=csv,noheader,nounits'
        );

        if (!ok || !out) return null;

        const text = new TextDecoder('utf-8').decode(out).trim();
        const parts = text.split(',').map(s => s.trim());
        if (parts.length < 5) return null;

        const usage = parseFloat(parts[0]);
        const temp = parseFloat(parts[1]);
        const clockMhz = parseFloat(parts[2]);
        const memUsedMib = parseFloat(parts[3]);
        const memTotalMib = parseFloat(parts[4]);

        const vramUsedG = memUsedMib / 1024;
        const vramTotalG = memTotalMib / 1024;
        const vramFreeG = Math.max(0, vramTotalG - vramUsedG);
        const vramPercent = memTotalMib > 0 ? (memUsedMib / memTotalMib) * 100 : 0;

        return {
            sleeping: false,
            name: 'NVIDIA',
            usage: Number.isFinite(usage) ? usage : 0,
            temp: Number.isFinite(temp) ? temp : null,
            clock: Number.isFinite(clockMhz) ? clockMhz : null,
            vramUsed: Number.isFinite(vramUsedG) ? vramUsedG : null,
            vramFree: Number.isFinite(vramFreeG) ? vramFreeG : null,
            vramPercent: Number.isFinite(vramPercent) ? vramPercent : null,
        };
    } catch (e) {
        return null;
    }
}

function queryAmd(gpus) {
    if (!gpus.amd) return null;
    const dev = gpus.amd.devPath;
    const path = gpus.amd.path;

    let usage = null;
    const busy = (dev ? readFile(`${dev}/gpu_busy_percent`) : null) ||
                 (path ? readFile(`${path}/gpu_busy_percent`) : null);
    if (busy) {
        const val = parseFloat(busy.trim());
        if (Number.isFinite(val)) usage = Math.min(100, Math.max(0, val));
    }
    if (usage === null) usage = 0;

    let clock = null;
    const clk = (dev ? readFile(`${dev}/current_gfxclk`) : null) ||
                (path ? readFile(`${path}/current_gfxclk`) : null);
    if (clk) {
        const val = parseFloat(clk.trim());
        if (Number.isFinite(val)) clock = val;
    }

    let temp = null;
    const hwmonPath = dev ? `${dev}/hwmon` : `${path}/hwmon`;
    const hwmonDir = Gio.File.new_for_path(hwmonPath);
    if (hwmonDir.query_exists(null)) {
        try {
            const enumerator = hwmonDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                const hName = info.get_name();
                const tempFile = readFile(`${hwmonPath}/${hName}/temp1_input`);
                if (tempFile) {
                    const raw = parseFloat(tempFile.trim());
                    if (Number.isFinite(raw)) {
                        temp = raw / 1000;
                        break;
                    }
                }
            }
        } catch (e) {}
    }
    if (temp === null) {
        temp = getPackageTemp();
    }

    let vramUsed = null;
    let vramFree = null;
    let vramPercent = null;
    const usedBytes = dev ? readFile(`${dev}/mem_info_vram_used`) : null;
    const totalBytes = dev ? readFile(`${dev}/mem_info_vram_total`) : null;
    if (usedBytes && totalBytes) {
        const u = parseFloat(usedBytes.trim());
        const t = parseFloat(totalBytes.trim());
        if (Number.isFinite(u) && Number.isFinite(t) && t > 0) {
            vramUsed = u / (1024 * 1024 * 1024);
            const totalG = t / (1024 * 1024 * 1024);
            vramFree = Math.max(0, totalG - vramUsed);
            vramPercent = (u / t) * 100;
        }
    }

    return {
        sleeping: false,
        name: 'AMD',
        usage,
        clock,
        temp,
        vramUsed,
        vramFree,
        vramPercent,
    };
}

function queryIntel(gpus, state) {
    if (!gpus.intel) return null;
    const path = gpus.intel.path;
    const devPath = gpus.intel.devPath;

    let clock = null;
    const curFreq = readFile(`${path}/gt_act_freq_mhz`) ||
                    readFile(`${path}/gt_cur_freq_mhz`) ||
                    (devPath ? readFile(`${devPath}/gt_act_freq_mhz`) : null);
    if (curFreq) {
        const mhz = parseFloat(curFreq.trim());
        if (Number.isFinite(mhz)) clock = mhz;
    }

    let usage = null;
    const rc6File = readFile(`${path}/power/rc6_residency_ms`) ||
                    readFile(`${path}/gt/gt0/rc6_residency_ms`) ||
                    (devPath ? readFile(`${devPath}/power/rc6_residency_ms`) : null);
    const now = Date.now();
    if (rc6File) {
        const rc6 = parseInt(rc6File.trim(), 10);
        if (Number.isFinite(rc6)) {
            if (state.prev_intel_rc6 !== undefined && state.prev_intel_time) {
                const dt = now - state.prev_intel_time;
                const dRc6 = rc6 - state.prev_intel_rc6;
                if (dt > 0 && dRc6 >= 0) {
                    const activeMs = Math.max(0, dt - dRc6);
                    usage = Math.min(100, Math.max(0, (activeMs / dt) * 100));
                }
            } else {
                usage = 0;
            }
            state.prev_intel_rc6 = rc6;
            state.prev_intel_time = now;
        }
    }
    if (usage === null) usage = 0;

    let temp = null;
    if (devPath) {
        const hwmonDir = Gio.File.new_for_path(`${devPath}/hwmon`);
        if (hwmonDir.query_exists(null)) {
            try {
                const enumerator = hwmonDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
                let info;
                while ((info = enumerator.next_file(null)) !== null) {
                    const hName = info.get_name();
                    const tempFile = readFile(`${devPath}/hwmon/${hName}/temp1_input`);
                    if (tempFile) {
                        const raw = parseFloat(tempFile.trim());
                        if (Number.isFinite(raw)) {
                            temp = raw / 1000;
                            break;
                        }
                    }
                }
            } catch (e) {}
        }
    }
    if (temp === null) {
        temp = getPackageTemp();
    }

    let vramUsed = null;
    let vramFree = null;
    let vramPercent = null;
    const lmemTotal = devPath ? (readFile(`${devPath}/lmem_total_bytes`) || readFile(`${path}/lmem_total_bytes`)) : null;
    const lmemAvail = devPath ? (readFile(`${devPath}/lmem_avail_bytes`) || readFile(`${path}/lmem_avail_bytes`)) : null;
    if (lmemTotal && lmemAvail) {
        const t = parseFloat(lmemTotal.trim());
        const a = parseFloat(lmemAvail.trim());
        if (Number.isFinite(t) && Number.isFinite(a) && t > 0) {
            const u = Math.max(0, t - a);
            vramUsed = u / (1024 * 1024 * 1024);
            vramFree = a / (1024 * 1024 * 1024);
            vramPercent = (u / t) * 100;
        }
    }

    return {
        sleeping: false,
        name: 'Intel',
        usage,
        clock,
        temp,
        vramUsed,
        vramFree,
        vramPercent,
    };
}

export function updateGPU(state) {
    const gpus = scanGPUs();
    const mode = state.gpuDevice || 'auto';

    if (mode === 'integrated') {
        if (gpus.intel) return queryIntel(gpus, state);
        if (gpus.amd) return queryAmd(gpus);
        return null;
    }

    if (mode === 'dedicated') {
        if (gpus.nvidia) return queryNvidia(gpus);
        if (gpus.amd) return queryAmd(gpus);
        return null;
    }

    // Auto mode: prefer dedicated GPU if present
    if (gpus.nvidia) {
        const dgpu = queryNvidia(gpus);
        if (dgpu) return dgpu;
    }

    if (gpus.amd) {
        const dgpu = queryAmd(gpus);
        if (dgpu) return dgpu;
    }

    if (gpus.intel) {
        return queryIntel(gpus, state);
    }

    return null;
}
