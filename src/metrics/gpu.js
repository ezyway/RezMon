'use strict';

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { readFile } from '../utils/file.js';

const DRIVER_VENDOR = {
    nvidia: 'nvidia',
    nvidia_drm: 'nvidia',
    nouveau: 'nvidia',
    amdgpu: 'amd',
    radeon: 'amd',
    i915: 'intel',
    xe: 'intel',
};

const GENERIC_NAMES = new Set(['NVIDIA', 'AMD', 'Intel Graphics', 'Unknown GPU']);

let detectedGPUs = null;
let detectedSignature = null;
let hasNvidiaSmi = false;
let cachedNvidiaStats = new Map();
let isNvidiaQuerying = false;

export function normalizePciId(pci) {
    if (!pci)
        return '';
    const match = String(pci).trim().toLowerCase().match(
        /([0-9a-f]{4,8}):([0-9a-f]{2}):([0-9a-f]{2})\.([0-9a-f])/
    );
    if (!match)
        return String(pci).trim().toLowerCase();
    const domain = match[1].slice(-4).padStart(4, '0');
    return `${domain}:${match[2].padStart(2, '0')}:${match[3].padStart(2, '0')}.${match[4]}`;
}

export function makeGpuId(pci, drmCard) {
    const normalized = normalizePciId(pci);
    if (normalized)
        return `pci-${normalized}`;
    if (drmCard)
        return `drm-${drmCard}`;
    return 'gpu-unknown';
}

export function parseLspciMmName(line, vendor) {
    if (!line)
        return null;

    const fields = [];
    const re = /"([^"]*)"/g;
    let match;
    while ((match = re.exec(line)) !== null)
        fields.push(match[1]);

    const device = fields[2] || '';
    if (!device)
        return null;

    const bracket = device.match(/\[([^\]]+)\]/);
    let name = (bracket ? bracket[1] : device).trim();
    if (!name)
        return null;

    const prefix = {
        nvidia: 'NVIDIA',
        amd: 'AMD',
        intel: 'Intel',
    }[vendor];

    if (prefix && !name.toLowerCase().includes(prefix.toLowerCase()))
        name = `${prefix} ${name}`;

    return name;
}

export function parseNvidiaSmiOutput(stdout) {
    if (!stdout)
        return [];

    const gpus = [];
    for (const rawLine of stdout.split('\n')) {
        const line = rawLine.trim();
        if (!line)
            continue;

        const parts = line.split(',').map(part => part.trim());
        if (parts.length < 8)
            continue;

        const index = parseInt(parts[0], 10);
        const uuid = parts[1] || '';
        const pci = normalizePciId(parts[2] || '');
        const memTotalMib = parseFloat(parts[parts.length - 1]);
        const memUsedMib = parseFloat(parts[parts.length - 2]);
        const clockMhz = parseFloat(parts[parts.length - 3]);
        const temp = parseFloat(parts[parts.length - 4]);
        const usage = parseFloat(parts[parts.length - 5]);
        const name = parts.slice(3, parts.length - 5).join(', ').trim();

        const vramUsed = Number.isFinite(memUsedMib) ? memUsedMib / 1024 : null;
        const vramTotal = Number.isFinite(memTotalMib) ? memTotalMib / 1024 : null;
        const vramFree = (vramUsed !== null && vramTotal !== null)
            ? Math.max(0, vramTotal - vramUsed)
            : null;
        const vramPercent = (Number.isFinite(memUsedMib) && Number.isFinite(memTotalMib) && memTotalMib > 0)
            ? (memUsedMib / memTotalMib) * 100
            : null;

        gpus.push({
            index: Number.isFinite(index) ? index : null,
            uuid,
            pci,
            name: name || 'NVIDIA',
            usage: Number.isFinite(usage) ? usage : 0,
            temp: Number.isFinite(temp) ? temp : null,
            clock: Number.isFinite(clockMhz) ? clockMhz : null,
            vramUsed,
            vramFree,
            vramPercent,
        });
    }
    return gpus;
}

export function classifyGpuKind(gpu) {
    if (!gpu)
        return 'unknown';
    if (gpu.vendor === 'nvidia')
        return 'dedicated';
    if (gpu.vendor === 'intel')
        return gpu.hasLmem ? 'dedicated' : 'integrated';
    if (gpu.vendor === 'amd') {
        if (gpu.bootVga)
            return 'integrated';
        if (gpu.hasDiscreteVram)
            return 'dedicated';
        return 'integrated';
    }
    return 'unknown';
}

export function sortGpuDevices(gpus) {
    return [...gpus].sort((a, b) => {
        const cardA = cardNumber(a.drmCard);
        const cardB = cardNumber(b.drmCard);
        if (cardA !== null && cardB !== null && cardA !== cardB)
            return cardA - cardB;
        if (cardA !== null && cardB === null)
            return -1;
        if (cardA === null && cardB !== null)
            return 1;
        return (a.pci || '').localeCompare(b.pci || '');
    });
}

export function filterSelectedGpus(gpus, selectedIds) {
    if (!Array.isArray(gpus) || gpus.length === 0)
        return [];
    if (selectedIds === undefined || selectedIds === null)
        return [...gpus];
    if (selectedIds.includes('all'))
        return [...gpus];
    const wanted = new Set(selectedIds);
    return gpus.filter(gpu => wanted.has(gpu.id));
}

export function migrateGpuSelected(oldDevice, gpus) {
    if (!oldDevice || oldDevice === 'auto')
        return ['all'];

    const list = Array.isArray(gpus) ? gpus : [];
    if (oldDevice === 'dedicated') {
        const ids = list.filter(gpu => gpu.kind === 'dedicated').map(gpu => gpu.id);
        return ids.length ? ids : ['all'];
    }
    if (oldDevice === 'integrated') {
        const ids = list.filter(gpu => gpu.kind === 'integrated').map(gpu => gpu.id);
        return ids.length ? ids : ['all'];
    }
    return ['all'];
}

export function applyGpuSelectionMigration(settings, gpus) {
    if (!settings)
        return ['all'];

    try {
        if (settings.get_boolean('gpu-selected-migrated'))
            return settings.get_strv('gpu-selected') || ['all'];

        const migrated = migrateGpuSelected(settings.get_string('gpu-device'), gpus);
        settings.set_strv('gpu-selected', migrated);
        settings.set_boolean('gpu-selected-migrated', true);
        return migrated;
    } catch (_) {
        try {
            return settings.get_strv('gpu-selected') || ['all'];
        } catch {
            return ['all'];
        }
    }
}

export function invalidateGpuCache() {
    detectedGPUs = null;
    detectedSignature = null;
}

export async function listGPUs({ force = false } = {}) {
    const signature = listDrmCardNames().join(',');
    if (force || !detectedGPUs || signature !== detectedSignature) {
        detectedGPUs = await scanGPUs();
        detectedSignature = signature;
    }
    return detectedGPUs;
}

export async function updateGPU(state) {
    const gpus = await listGPUs();

    if (state?._settings)
        applyGpuSelectionMigration(state._settings, gpus);

    const selectedIds = state?.gpuSelected;
    const selected = filterSelectedGpus(gpus, selectedIds);
    if (selected.length === 0)
        return [];

    const nvidiaGpus = selected.filter(gpu => gpu.vendor === 'nvidia');
    const otherGpus = selected.filter(gpu => gpu.vendor !== 'nvidia');

    const [nvidiaResults, otherResults] = await Promise.all([
        queryNvidiaGpus(nvidiaGpus),
        Promise.all(otherGpus.map(gpu =>
            queryOneGpu(gpu, state).catch(() => unavailableGpu(gpu))
        )),
    ]);

    const byId = new Map();
    for (const result of nvidiaResults)
        byId.set(result.id, result);
    for (const result of otherResults)
        byId.set(result.id, result);

    return selected.map(gpu => byId.get(gpu.id) || unavailableGpu(gpu));
}

function cardNumber(drmCard) {
    if (!drmCard)
        return null;
    const match = String(drmCard).match(/^card(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
}

function listDirectoryNames(path) {
    const dir = Gio.File.new_for_path(path);
    if (!dir.query_exists(null))
        return [];

    const names = [];
    let enumerator = null;
    try {
        enumerator = dir.enumerate_children(
            'standard::name',
            Gio.FileQueryInfoFlags.NONE,
            null
        );
        let info;
        while ((info = enumerator.next_file(null)) !== null)
            names.push(info.get_name());
    } catch (_) {
    } finally {
        if (enumerator) {
            try { enumerator.close(null); } catch (_) {}
        }
    }
    return names;
}

function listDrmCardNames() {
    return listDirectoryNames('/sys/class/drm')
        .filter(name => /^card\d+$/.test(name))
        .sort((a, b) => cardNumber(a) - cardNumber(b));
}

function parseUevent(text) {
    const result = { driver: '', pciSlot: '', pciId: '' };
    if (!text)
        return result;

    for (const line of text.split('\n')) {
        if (line.startsWith('DRIVER='))
            result.driver = line.slice(7).trim().toLowerCase();
        else if (line.startsWith('PCI_SLOT_NAME='))
            result.pciSlot = line.slice(14).trim();
        else if (line.startsWith('PCI_ID='))
            result.pciId = line.slice(7).trim();
    }
    return result;
}

function fallbackName(vendor) {
    if (vendor === 'nvidia')
        return 'NVIDIA';
    if (vendor === 'amd')
        return 'AMD';
    if (vendor === 'intel')
        return 'Intel Graphics';
    return 'Unknown GPU';
}

function isGenericName(name) {
    return !name || GENERIC_NAMES.has(name);
}

function readLspciName(pci, vendor) {
    if (!pci)
        return null;
    const lspci = GLib.find_program_in_path('lspci');
    if (!lspci)
        return null;

    try {
        const proc = new Gio.Subprocess({
            argv: [lspci, '-mm', '-s', pci],
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
        });
        proc.init(null);
        const [, stdout] = proc.communicate_utf8(null, null);
        return parseLspciMmName(stdout, vendor);
    } catch (_) {
        return null;
    }
}

async function readNvidiaProcName(pci) {
    if (!pci)
        return null;
    const info = await readFile(`/proc/driver/nvidia/gpus/${pci}/information`);
    if (!info)
        return null;
    const match = info.match(/^Model:\s*(.+)$/m);
    return match ? match[1].trim() : null;
}

function finalizeGpuList(gpus) {
    const sorted = sortGpuDevices(gpus);
    sorted.forEach((gpu, index) => {
        gpu.index = index;
        gpu.kind = classifyGpuKind(gpu);
        if (isGenericName(gpu.name)) {
            const pretty = readLspciName(gpu.pci, gpu.vendor);
            if (pretty)
                gpu.name = pretty;
        }
        if (!gpu.name)
            gpu.name = fallbackName(gpu.vendor);
    });
    return sorted;
}

function identity(gpu) {
    return {
        id: gpu.id,
        index: gpu.index,
        name: gpu.name,
        vendor: gpu.vendor,
        driver: gpu.driver,
        devicePath: gpu.devicePath,
        drmCard: gpu.drmCard,
    };
}

function sleepingGpu(gpu) {
    return {
        ...identity(gpu),
        sleeping: true,
        unavailable: false,
        usage: 0,
        clock: 0,
        temp: null,
        vramUsed: 0,
        vramFree: 0,
        vramPercent: 0,
        vramKind: gpu.vendor === 'nvidia' || gpu.hasDiscreteVram || gpu.hasLmem ? 'dedicated' : 'shared',
    };
}

function unavailableGpu(gpu) {
    return {
        ...identity(gpu),
        sleeping: false,
        unavailable: true,
        usage: null,
        clock: null,
        temp: null,
        vramUsed: null,
        vramFree: null,
        vramPercent: null,
        vramKind: null,
    };
}

async function getSharedVram() {
    let memTotalKb = 0;
    let shmemKb = 0;

    const content = await readFile('/proc/meminfo');
    if (content) {
        for (const line of content.split('\n')) {
            if (line.startsWith('MemTotal:'))
                memTotalKb = parseInt(line.split(/\s+/)[1], 10) || 0;
            else if (line.startsWith('Shmem:'))
                shmemKb = parseInt(line.split(/\s+/)[1], 10) || 0;
            if (memTotalKb > 0 && shmemKb > 0)
                break;
        }
    }

    if (memTotalKb > 0) {
        const totalKb = memTotalKb / 2;
        const usedKb = shmemKb;
        const freeKb = Math.max(0, totalKb - usedKb);
        return {
            vramUsed: usedKb / (1024 * 1024),
            vramFree: freeKb / (1024 * 1024),
            vramPercent: totalKb > 0 ? (usedKb / totalKb) * 100 : 0,
        };
    }

    return {
        vramUsed: null,
        vramFree: null,
        vramPercent: null,
    };
}

async function readHwmonTemp(hwmonPath) {
    const names = listDirectoryNames(hwmonPath);
    for (const hName of names) {
        const tempFile = await readFile(`${hwmonPath}/${hName}/temp1_input`);
        if (!tempFile)
            continue;
        const raw = parseFloat(tempFile.trim());
        if (Number.isFinite(raw))
            return raw / 1000;
    }
    return null;
}

async function scanOneDrmCard(cardName) {
    const drmPath = `/sys/class/drm/${cardName}`;
    const devicePath = `${drmPath}/device`;
    const uevent = parseUevent(await readFile(`${devicePath}/uevent`));
    const vendor = DRIVER_VENDOR[uevent.driver];
    if (!vendor)
        return null;

    const pci = normalizePciId(uevent.pciSlot);
    const bootVgaText = await readFile(`${devicePath}/boot_vga`);
    const lmemTotal = await readFile(`${devicePath}/lmem_total_bytes`);
    const vramTotal = await readFile(`${devicePath}/mem_info_vram_total`);

    const gpu = {
        id: makeGpuId(pci, cardName),
        index: 0,
        name: fallbackName(vendor),
        vendor,
        driver: uevent.driver,
        devicePath,
        drmCard: cardName,
        drmPath,
        pci,
        kind: 'unknown',
        bootVga: bootVgaText ? bootVgaText.trim() === '1' : false,
        hasLmem: !!(lmemTotal && parseFloat(lmemTotal.trim()) > 0),
        hasDiscreteVram: !!(vramTotal && parseFloat(vramTotal.trim()) > 256 * 1024 * 1024),
    };

    if (vendor === 'nvidia') {
        const procName = await readNvidiaProcName(pci);
        if (procName)
            gpu.name = procName;
    } else {
        const product = await readFile(`${devicePath}/product_name`);
        if (product && product.trim())
            gpu.name = product.trim();
    }

    return gpu;
}

async function scanNvidiaPciFallbacks(existing) {
    const extras = [];
    const known = new Set(existing.map(gpu => gpu.id));
    const names = listDirectoryNames('/sys/bus/pci/drivers/nvidia');

    for (const name of names) {
        if (!/^[0-9a-fA-F]{4}:/.test(name))
            continue;

        const pci = normalizePciId(name);
        const id = makeGpuId(pci, null);
        if (!pci || known.has(id))
            continue;

        const devicePath = `/sys/bus/pci/drivers/nvidia/${name}`;
        const gpu = {
            id,
            index: 0,
            name: 'NVIDIA',
            vendor: 'nvidia',
            driver: 'nvidia',
            devicePath,
            drmCard: null,
            drmPath: null,
            pci,
            kind: 'dedicated',
            bootVga: false,
            hasLmem: false,
            hasDiscreteVram: true,
        };

        const procName = await readNvidiaProcName(pci);
        if (procName)
            gpu.name = procName;

        extras.push(gpu);
        known.add(id);
    }

    return extras;
}

async function scanGPUs() {
    hasNvidiaSmi = GLib.find_program_in_path('nvidia-smi') !== null;

    const cardNames = listDrmCardNames();
    const scanned = await Promise.all(cardNames.map(name =>
        scanOneDrmCard(name).catch(() => null)
    ));
    const gpus = scanned.filter(Boolean);
    const extras = await scanNvidiaPciFallbacks(gpus);
    return finalizeGpuList(gpus.concat(extras));
}

async function isRuntimeSuspended(devicePath) {
    if (!devicePath)
        return false;
    const runtimeStatus = await readFile(`${devicePath}/power/runtime_status`);
    return !!(runtimeStatus && runtimeStatus.trim().toLowerCase() === 'suspended');
}

function scheduleNvidiaBatch(gpus) {
    if (isNvidiaQuerying || gpus.length === 0)
        return;

    if (!hasNvidiaSmi) {
        hasNvidiaSmi = GLib.find_program_in_path('nvidia-smi') !== null;
        if (!hasNvidiaSmi)
            return;
    }

    isNvidiaQuerying = true;

    const argv = [
        'nvidia-smi',
        '--query-gpu=index,uuid,pci.bus_id,name,utilization.gpu,temperature.gpu,clocks.current.graphics,memory.used,memory.total',
        '--format=csv,noheader,nounits',
    ];

    const pciIds = gpus.map(gpu => gpu.pci).filter(Boolean);
    if (pciIds.length)
        argv.splice(1, 0, `-i`, pciIds.join(','));

    try {
        const proc = new Gio.Subprocess({
            argv,
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
        });
        proc.init(null);
        proc.communicate_utf8_async(null, null, (procInner, res) => {
            try {
                const [, stdout] = procInner.communicate_utf8_finish(res);
                const parsed = parseNvidiaSmiOutput(stdout || '');
                const seen = new Set();

                for (const row of parsed) {
                    const id = makeGpuId(row.pci, null);
                    seen.add(id);
                    cachedNvidiaStats.set(id, {
                        sleeping: false,
                        unavailable: false,
                        name: row.name,
                        usage: row.usage,
                        temp: row.temp,
                        clock: row.clock,
                        vramUsed: row.vramUsed,
                        vramFree: row.vramFree,
                        vramPercent: row.vramPercent,
                        vramKind: 'dedicated',
                    });

                    if (detectedGPUs) {
                        const device = detectedGPUs.find(gpu => gpu.id === id);
                        if (device && row.name)
                            device.name = row.name;
                    }
                }

                for (const gpu of gpus) {
                    if (!seen.has(gpu.id) && !cachedNvidiaStats.has(gpu.id)) {
                        cachedNvidiaStats.set(gpu.id, {
                            sleeping: false,
                            unavailable: true,
                            usage: null,
                            temp: null,
                            clock: null,
                            vramUsed: null,
                            vramFree: null,
                            vramPercent: null,
                            vramKind: 'dedicated',
                        });
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

async function queryNvidiaGpus(gpus) {
    if (!gpus.length)
        return [];

    const results = [];
    const awake = [];

    await Promise.all(gpus.map(async gpu => {
        try {
            if (await isRuntimeSuspended(gpu.devicePath)) {
                results.push(sleepingGpu(gpu));
                return;
            }
            awake.push(gpu);
        } catch (_) {
            results.push(unavailableGpu(gpu));
        }
    }));

    if (!awake.length)
        return results;

    if (!hasNvidiaSmi && GLib.find_program_in_path('nvidia-smi') === null) {
        return results.concat(awake.map(unavailableGpu));
    }
    hasNvidiaSmi = true;

    scheduleNvidiaBatch(awake);

    for (const gpu of awake) {
        const cached = cachedNvidiaStats.get(gpu.id);
        results.push({
            ...identity(gpu),
            sleeping: false,
            unavailable: false,
            usage: 0,
            clock: null,
            temp: null,
            vramUsed: null,
            vramFree: null,
            vramPercent: null,
            vramKind: 'dedicated',
            ...(cached || {}),
            id: gpu.id,
            index: gpu.index,
            vendor: gpu.vendor,
            driver: gpu.driver,
        });
    }

    return results;
}

async function queryOneGpu(gpu, state) {
    if (gpu.vendor === 'amd')
        return await queryAmd(gpu);
    if (gpu.vendor === 'intel')
        return await queryIntel(gpu, state);
    return unavailableGpu(gpu);
}

async function queryAmd(gpu) {
    const devicePath = gpu.devicePath;
    const drmPath = gpu.drmPath;

    if (await isRuntimeSuspended(devicePath))
        return sleepingGpu(gpu);

    let usage = 0;
    let busy = devicePath ? await readFile(`${devicePath}/gpu_busy_percent`) : null;
    if (!busy && drmPath)
        busy = await readFile(`${drmPath}/gpu_busy_percent`);
    if (busy) {
        const value = parseFloat(busy.trim());
        if (Number.isFinite(value))
            usage = Math.min(100, Math.max(0, value));
    }

    let clock = null;
    let clk = devicePath ? await readFile(`${devicePath}/current_gfxclk`) : null;
    if (!clk && drmPath)
        clk = await readFile(`${drmPath}/current_gfxclk`);
    if (clk) {
        const value = parseFloat(clk.trim());
        if (Number.isFinite(value))
            clock = value;
    }

    let temp = null;
    if (devicePath)
        temp = await readHwmonTemp(`${devicePath}/hwmon`);
    if (temp === null && drmPath)
        temp = await readHwmonTemp(`${drmPath}/hwmon`);

    let vramUsed = null;
    let vramFree = null;
    let vramPercent = null;
    let vramKind = 'shared';

    const usedBytes = devicePath ? await readFile(`${devicePath}/mem_info_vram_used`) : null;
    const totalBytes = devicePath ? await readFile(`${devicePath}/mem_info_vram_total`) : null;
    if (usedBytes && totalBytes) {
        const used = parseFloat(usedBytes.trim());
        const total = parseFloat(totalBytes.trim());
        if (Number.isFinite(used) && Number.isFinite(total) && total > 0) {
            vramUsed = used / (1024 * 1024 * 1024);
            const totalG = total / (1024 * 1024 * 1024);
            vramFree = Math.max(0, totalG - vramUsed);
            vramPercent = (used / total) * 100;
            vramKind = 'dedicated';
        }
    }

    if (vramUsed === null) {
        const shared = await getSharedVram();
        vramUsed = shared.vramUsed;
        vramFree = shared.vramFree;
        vramPercent = shared.vramPercent;
        vramKind = 'shared';
    }

    return {
        ...identity(gpu),
        sleeping: false,
        unavailable: false,
        usage,
        clock,
        temp,
        vramUsed,
        vramFree,
        vramPercent,
        vramKind,
    };
}

function intelCounterState(state, id) {
    if (!state)
        return { prevRc6: undefined, prevTime: undefined };
    if (!state._intelGpuState)
        state._intelGpuState = {};
    if (!state._intelGpuState[id])
        state._intelGpuState[id] = { prevRc6: undefined, prevTime: undefined };
    return state._intelGpuState[id];
}

async function queryIntel(gpu, state) {
    const drmPath = gpu.drmPath;
    const devicePath = gpu.devicePath;

    let clock = null;
    let curFreq = drmPath ? await readFile(`${drmPath}/gt_act_freq_mhz`) : null;
    if (!curFreq && drmPath)
        curFreq = await readFile(`${drmPath}/gt_cur_freq_mhz`);
    if (!curFreq && devicePath)
        curFreq = await readFile(`${devicePath}/gt_act_freq_mhz`);
    if (curFreq) {
        const mhz = parseFloat(curFreq.trim());
        if (Number.isFinite(mhz))
            clock = mhz;
    }

    let usage = 0;
    let rc6File = drmPath ? await readFile(`${drmPath}/power/rc6_residency_ms`) : null;
    if (!rc6File && drmPath)
        rc6File = await readFile(`${drmPath}/gt/gt0/rc6_residency_ms`);
    if (!rc6File && devicePath)
        rc6File = await readFile(`${devicePath}/power/rc6_residency_ms`);

    const now = GLib.get_monotonic_time() / 1000;
    const counters = intelCounterState(state, gpu.id);
    if (rc6File) {
        const rc6 = parseInt(rc6File.trim(), 10);
        if (Number.isFinite(rc6)) {
            if (counters.prevRc6 !== undefined && counters.prevTime) {
                const dt = now - counters.prevTime;
                const dRc6 = rc6 - counters.prevRc6;
                if (dt > 0 && dRc6 >= 0) {
                    const activeMs = Math.max(0, dt - dRc6);
                    usage = Math.min(100, Math.max(0, (activeMs / dt) * 100));
                }
            }
            counters.prevRc6 = rc6;
            counters.prevTime = now;
        }
    }

    let temp = null;
    if (devicePath)
        temp = await readHwmonTemp(`${devicePath}/hwmon`);

    let vramUsed = null;
    let vramFree = null;
    let vramPercent = null;
    let vramKind = 'shared';

    let lmemTotal = devicePath ? await readFile(`${devicePath}/lmem_total_bytes`) : null;
    if (!lmemTotal && drmPath)
        lmemTotal = await readFile(`${drmPath}/lmem_total_bytes`);
    let lmemAvail = devicePath ? await readFile(`${devicePath}/lmem_avail_bytes`) : null;
    if (!lmemAvail && drmPath)
        lmemAvail = await readFile(`${drmPath}/lmem_avail_bytes`);

    if (lmemTotal && lmemAvail) {
        const total = parseFloat(lmemTotal.trim());
        const avail = parseFloat(lmemAvail.trim());
        if (Number.isFinite(total) && Number.isFinite(avail) && total > 0) {
            const used = Math.max(0, total - avail);
            vramUsed = used / (1024 * 1024 * 1024);
            vramFree = avail / (1024 * 1024 * 1024);
            vramPercent = (used / total) * 100;
            vramKind = 'dedicated';
        }
    }

    if (vramUsed === null) {
        const shared = await getSharedVram();
        vramUsed = shared.vramUsed;
        vramFree = shared.vramFree;
        vramPercent = shared.vramPercent;
        vramKind = 'shared';
    }

    return {
        ...identity(gpu),
        sleeping: false,
        unavailable: false,
        usage,
        clock,
        temp,
        vramUsed,
        vramFree,
        vramPercent,
        vramKind,
    };
}
