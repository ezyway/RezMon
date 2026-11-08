'use strict';

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { readFile, readFileLines } from '../utils/file.js';

let detectedGPUs = null;

async function getSharedVram() {
    let memTotalKb = 0;
    let shmemKb = 0;

    const lines = await readFileLines('/proc/meminfo');
    for (const line of lines) {
        if (line.startsWith('MemTotal:')) {
            memTotalKb = parseInt(line.split(/\s+/)[1], 10) || 0;
        } else if (line.startsWith('Shmem:')) {
            shmemKb = parseInt(line.split(/\s+/)[1], 10) || 0;
        }
        if (memTotalKb > 0 && shmemKb > 0) break;
    }

    if (memTotalKb > 0) {
        // In Linux UMA graphics, DRM GEM memory is capped at 50% of system RAM
        const totalKb = memTotalKb / 2;
        const usedKb = shmemKb;
        const freeKb = Math.max(0, totalKb - usedKb);

        const vramUsed = usedKb / (1024 * 1024);
        const vramFree = freeKb / (1024 * 1024);
        const vramPercent = totalKb > 0 ? (usedKb / totalKb) * 100 : 0;

        return {
            vramUsed,
            vramFree,
            vramPercent,
        };
    }

    return {
        vramUsed: null,
        vramFree: null,
        vramPercent: null,
    };
}

async function scanGPUs() {
    if (detectedGPUs) return detectedGPUs;

    let nvidiaCard = null;
    let amdCard = null;
    let intelCard = null;

    const drmDir = Gio.File.new_for_path('/sys/class/drm');
    if (drmDir.query_exists(null)) {
        let enumerator = null;
        try {
            enumerator = drmDir.enumerate_children(
                'standard::name',
                Gio.FileQueryInfoFlags.NONE,
                null
            );
            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                const name = info.get_name();
                if (/^card\d+$/.test(name)) {
                    const devPath = `/sys/class/drm/${name}/device`;
                    const uevent = await readFile(`${devPath}/uevent`);
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
        } catch (e) {
        } finally {
            if (enumerator) {
                try { enumerator.close(null); } catch (_) {}
            }
        }
    }

    const hasNvidiaSmi = GLib.find_program_in_path('nvidia-smi') !== null;

    // Fallback detection for NVIDIA PCI device if not enumerated in DRM card list
    if (!nvidiaCard && hasNvidiaSmi) {
        const pciDir = Gio.File.new_for_path('/sys/bus/pci/drivers/nvidia');
        if (pciDir.query_exists(null)) {
            let enumerator = null;
            try {
                enumerator = pciDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
                let info;
                while ((info = enumerator.next_file(null)) !== null) {
                    const name = info.get_name();
                    if (/^[0-9a-fA-F]{4}:/.test(name)) {
                        nvidiaCard = { name, devPath: `/sys/bus/pci/drivers/nvidia/${name}`, driver: 'nvidia' };
                        break;
                    }
                }
            } catch (_) {
            } finally {
                if (enumerator) {
                    try { enumerator.close(null); } catch (_) {}
                }
            }
        }
    }

    detectedGPUs = {
        nvidia: nvidiaCard || (hasNvidiaSmi ? { driver: 'nvidia' } : null),
        amd: amdCard,
        intel: intelCard,
        hasNvidiaSmi,
    };

    return detectedGPUs;
}

let cachedNvidiaStats = null;
let isNvidiaQuerying = false;

async function queryNvidia(gpus) {
    if (!gpus.nvidia || !gpus.hasNvidiaSmi) return null;

    // Check runtime power status to avoid waking sleeping dGPU on battery
    if (gpus.nvidia.devPath) {
        const runtimeStatus = await readFile(`${gpus.nvidia.devPath}/power/runtime_status`);
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

    // Spawn non-blocking async query if not already in flight
    if (!isNvidiaQuerying) {
        isNvidiaQuerying = true;
        try {
            const proc = new Gio.Subprocess({
                argv: [
                    'nvidia-smi',
                    '--query-gpu=utilization.gpu,temperature.gpu,clocks.current.graphics,memory.used,memory.total',
                    '--format=csv,noheader,nounits'
                ],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
            });

            proc.init(null);
            proc.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    const [, stdout] = proc.communicate_utf8_finish(res);
                    if (stdout) {
                        const parts = stdout.trim().split(',').map(s => s.trim());
                        if (parts.length >= 5) {
                            const usage = parseFloat(parts[0]);
                            const temp = parseFloat(parts[1]);
                            const clockMhz = parseFloat(parts[2]);
                            const memUsedMib = parseFloat(parts[3]);
                            const memTotalMib = parseFloat(parts[4]);

                            const vramUsedG = memUsedMib / 1024;
                            const vramTotalG = memTotalMib / 1024;
                            const vramFreeG = Math.max(0, vramTotalG - vramUsedG);
                            const vramPercent = memTotalMib > 0 ? (memUsedMib / memTotalMib) * 100 : 0;

                            cachedNvidiaStats = {
                                sleeping: false,
                                name: 'NVIDIA',
                                usage: Number.isFinite(usage) ? usage : 0,
                                temp: Number.isFinite(temp) ? temp : null,
                                clock: Number.isFinite(clockMhz) ? clockMhz : null,
                                vramUsed: Number.isFinite(vramUsedG) ? vramUsedG : null,
                                vramFree: Number.isFinite(vramFreeG) ? vramFreeG : null,
                                vramPercent: Number.isFinite(vramPercent) ? vramPercent : null,
                            };
                        }
                    }
                } catch (_) {
                } finally {
                    isNvidiaQuerying = false;
                }
            });
        } catch (_) {
            isNvidiaQuerying = false;
        }
    }

    return cachedNvidiaStats || {
        sleeping: false,
        name: 'NVIDIA',
        usage: 0,
        clock: null,
        temp: null,
        vramUsed: null,
        vramFree: null,
        vramPercent: null,
    };
}

async function queryAmd(gpus) {
    if (!gpus.amd) return null;
    const dev = gpus.amd.devPath;
    const path = gpus.amd.path;

    let usage = null;
    let busy = dev ? await readFile(`${dev}/gpu_busy_percent`) : null;
    if (!busy && path) {
        busy = await readFile(`${path}/gpu_busy_percent`);
    }
    if (busy) {
        const val = parseFloat(busy.trim());
        if (Number.isFinite(val)) usage = Math.min(100, Math.max(0, val));
    }
    if (usage === null) usage = 0;

    let clock = null;
    let clk = dev ? await readFile(`${dev}/current_gfxclk`) : null;
    if (!clk && path) {
        clk = await readFile(`${path}/current_gfxclk`);
    }
    if (clk) {
        const val = parseFloat(clk.trim());
        if (Number.isFinite(val)) clock = val;
    }

    let temp = null;
    const hwmonPath = dev ? `${dev}/hwmon` : `${path}/hwmon`;
    const hwmonDir = Gio.File.new_for_path(hwmonPath);
    if (hwmonDir.query_exists(null)) {
        let enumerator = null;
        try {
            enumerator = hwmonDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                const hName = info.get_name();
                const tempFile = await readFile(`${hwmonPath}/${hName}/temp1_input`);
                if (tempFile) {
                    const raw = parseFloat(tempFile.trim());
                    if (Number.isFinite(raw)) {
                        temp = raw / 1000;
                        break;
                    }
                }
            }
        } catch (e) {
        } finally {
            if (enumerator) {
                try { enumerator.close(null); } catch (_) {}
            }
        }
    }

    let vramUsed = null;
    let vramFree = null;
    let vramPercent = null;
    const usedBytes = dev ? await readFile(`${dev}/mem_info_vram_used`) : null;
    const totalBytes = dev ? await readFile(`${dev}/mem_info_vram_total`) : null;
    if (usedBytes && totalBytes) {
        const u = parseFloat(usedBytes.trim());
        const t = parseFloat(totalBytes.trim());
        if (Number.isFinite(u) && Number.isFinite(t) && t > 0) {
            vramUsed = u / (1024 * 1024 * 1024);
            const totalG = t / (1024 * 1024 * 1024);
            vramFree = Math.max(0, totalG - vramUsed);
            vramPercent = (u / t) * 100;
        }
    } else {
        const shared = await getSharedVram();
        vramUsed = shared.vramUsed;
        vramFree = shared.vramFree;
        vramPercent = shared.vramPercent;
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

async function queryIntel(gpus, state) {
    if (!gpus.intel) return null;
    const path = gpus.intel.path;
    const devPath = gpus.intel.devPath;

    let clock = null;
    let curFreq = path ? await readFile(`${path}/gt_act_freq_mhz`) : null;
    if (!curFreq && path) curFreq = await readFile(`${path}/gt_cur_freq_mhz`);
    if (!curFreq && devPath) curFreq = await readFile(`${devPath}/gt_act_freq_mhz`);
    if (curFreq) {
        const mhz = parseFloat(curFreq.trim());
        if (Number.isFinite(mhz)) clock = mhz;
    }

    let usage = null;
    let rc6File = path ? await readFile(`${path}/power/rc6_residency_ms`) : null;
    if (!rc6File && path) rc6File = await readFile(`${path}/gt/gt0/rc6_residency_ms`);
    if (!rc6File && devPath) rc6File = await readFile(`${devPath}/power/rc6_residency_ms`);
    const now = GLib.get_monotonic_time() / 1000;
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
            let enumerator = null;
            try {
                enumerator = hwmonDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
                let info;
                while ((info = enumerator.next_file(null)) !== null) {
                    const hName = info.get_name();
                    const tempFile = await readFile(`${devPath}/hwmon/${hName}/temp1_input`);
                    if (tempFile) {
                        const raw = parseFloat(tempFile.trim());
                        if (Number.isFinite(raw)) {
                            temp = raw / 1000;
                            break;
                        }
                    }
                }
            } catch (e) {
            } finally {
                if (enumerator) {
                    try { enumerator.close(null); } catch (_) {}
                }
            }
        }
    }

    let vramUsed = null;
    let vramFree = null;
    let vramPercent = null;
    let lmemTotal = devPath ? await readFile(`${devPath}/lmem_total_bytes`) : null;
    if (!lmemTotal && path) lmemTotal = await readFile(`${path}/lmem_total_bytes`);
    let lmemAvail = devPath ? await readFile(`${devPath}/lmem_avail_bytes`) : null;
    if (!lmemAvail && path) lmemAvail = await readFile(`${path}/lmem_avail_bytes`);

    if (lmemTotal && lmemAvail) {
        const t = parseFloat(lmemTotal.trim());
        const a = parseFloat(lmemAvail.trim());
        if (Number.isFinite(t) && Number.isFinite(a) && t > 0) {
            const u = Math.max(0, t - a);
            vramUsed = u / (1024 * 1024 * 1024);
            vramFree = a / (1024 * 1024 * 1024);
            vramPercent = (u / t) * 100;
        }
    } else {
        const shared = await getSharedVram();
        vramUsed = shared.vramUsed;
        vramFree = shared.vramFree;
        vramPercent = shared.vramPercent;
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

export async function updateGPU(state) {
    const gpus = await scanGPUs();
    const mode = state.gpuDevice || 'auto';

    if (mode === 'integrated') {
        if (gpus.intel) return await queryIntel(gpus, state);
        if (gpus.amd) return await queryAmd(gpus);
        return null;
    }

    if (mode === 'dedicated') {
        if (gpus.nvidia) return await queryNvidia(gpus);
        if (gpus.amd) return await queryAmd(gpus);
        return null;
    }

    // Auto mode: prefer active dedicated GPU if present
    if (gpus.nvidia) {
        const dgpu = await queryNvidia(gpus);
        if (dgpu && !dgpu.sleeping) return dgpu;
        if (dgpu && dgpu.sleeping && !gpus.intel && !gpus.amd) return dgpu;
    }

    if (gpus.amd) {
        const dgpu = await queryAmd(gpus);
        if (dgpu && !dgpu.sleeping) return dgpu;
        if (dgpu && dgpu.sleeping && !gpus.intel) return dgpu;
    }

    if (gpus.intel) {
        return await queryIntel(gpus, state);
    }

    if (gpus.amd) {
        return await queryAmd(gpus);
    }

    return null;
}
