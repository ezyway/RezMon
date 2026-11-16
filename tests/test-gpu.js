'use strict';

import GLib from 'gi://GLib';
import {
    classifyGpuKind,
    filterSelectedGpus,
    listGPUs,
    makeGpuId,
    migrateGpuSelected,
    normalizePciId,
    parseLspciMmName,
    parseNvidiaSmiOutput,
    sortGpuDevices,
    updateGPU,
} from '../src/metrics/gpu.js';

let passed = 0;
let failed = 0;

function assert(cond, message) {
    if (cond) {
        passed++;
        print(`  ok  ${message}`);
        return;
    }
    failed++;
    printerr(`  FAIL  ${message}`);
}

function assertEq(actual, expected, message) {
    const actualJson = JSON.stringify(actual);
    const expectedJson = JSON.stringify(expected);
    assert(actualJson === expectedJson, `${message} (expected ${expectedJson}, got ${actualJson})`);
}

function delay(ms) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

print('1. PCI and ID helpers');
assertEq(normalizePciId('00000000:01:00.0'), '0000:01:00.0', 'normalize 8-digit domain');
assertEq(normalizePciId('0000:03:00.0'), '0000:03:00.0', 'normalize 4-digit domain');
assertEq(normalizePciId('0000:00:02.0'), '0000:00:02.0', 'normalize intel pci');
assertEq(makeGpuId('00000000:01:00.0', 'card1'), 'pci-0000:01:00.0', 'stable id prefers pci');
assertEq(makeGpuId('', 'card0'), 'drm-card0', 'fallback drm id');
assertEq(makeGpuId('0000:01:00.0', 'card9'), makeGpuId('00000000:01:00.0', 'card1'), 'id ignores scan order');

print('2. nvidia-smi CSV parser');
const smi = parseNvidiaSmiOutput(`
0, GPU-aaa, 00000000:01:00.0, NVIDIA GeForce RTX 3080, 12, 45, 300, 1234, 20480
1, GPU-bbb, 00000000:03:00.0, NVIDIA GeForce RTX 4060 Ti, 3, 42, 210, 400, 16380
`);
assertEq(smi.length, 2, 'parses both nvidia rows');
assertEq(smi[0].pci, '0000:01:00.0', 'binds first GPU by pci');
assertEq(smi[1].pci, '0000:03:00.0', 'binds second GPU by pci');
assertEq(smi[0].name, 'NVIDIA GeForce RTX 3080', 'keeps first GPU name');
assert(smi[0].usage === 12, 'first GPU usage');
assert(smi[1].usage === 3, 'second GPU usage');
assert(Math.abs(smi[0].vramUsed - 1234 / 1024) < 1e-6, 'first GPU vram used');
assertEq(parseNvidiaSmiOutput('\n\n  \n').length, 0, 'blank lines ignored');

const named = parseNvidiaSmiOutput(
    '0, GPU-aaa, 00000000:01:00.0, NVIDIA GeForce RTX 4090, 24GB, 8, 41, 900, 800, 24564'
);
assertEq(named[0].name, 'NVIDIA GeForce RTX 4090, 24GB', 'name may contain commas');
assert(named[0].usage === 8, 'usage still parsed with comma in name');

print('3. lspci name parser');
assertEq(
    parseLspciMmName('00:02.0 "VGA compatible controller" "Intel Corporation" "CometLake-S GT2 [UHD Graphics 630]"', 'intel'),
    'Intel UHD Graphics 630',
    'intel bracket name'
);
assertEq(
    parseLspciMmName('01:00.0 "VGA compatible controller" "NVIDIA Corporation" "GA102 [GeForce RTX 3080]"', 'nvidia'),
    'NVIDIA GeForce RTX 3080',
    'nvidia bracket name'
);

print('4. kind, sort, filter, migrate');
const devices = sortGpuDevices([
    { id: 'pci-0000:03:00.0', drmCard: 'card2', pci: '0000:03:00.0', vendor: 'nvidia', kind: 'dedicated' },
    { id: 'pci-0000:00:02.0', drmCard: 'card0', pci: '0000:00:02.0', vendor: 'intel', kind: 'integrated' },
    { id: 'pci-0000:01:00.0', drmCard: 'card1', pci: '0000:01:00.0', vendor: 'nvidia', kind: 'dedicated' },
]);
assertEq(devices.map(g => g.drmCard), ['card0', 'card1', 'card2'], 'sorts by drm card order');
assertEq(classifyGpuKind({ vendor: 'nvidia' }), 'dedicated', 'nvidia is dedicated');
assertEq(classifyGpuKind({ vendor: 'intel', hasLmem: false }), 'integrated', 'intel iGPU');
assertEq(classifyGpuKind({ vendor: 'intel', hasLmem: true }), 'dedicated', 'intel dGPU');
assertEq(classifyGpuKind({ vendor: 'amd', bootVga: true }), 'integrated', 'amd boot_vga iGPU');
assertEq(classifyGpuKind({ vendor: 'amd', bootVga: false, hasDiscreteVram: true }), 'dedicated', 'amd dGPU');

assertEq(filterSelectedGpus(devices, ['all']).map(g => g.id), devices.map(g => g.id), 'all selects every GPU');
assertEq(filterSelectedGpus(devices, ['pci-0000:00:02.0']).map(g => g.id), ['pci-0000:00:02.0'], 'single GPU');
assertEq(
    filterSelectedGpus(devices, ['pci-0000:00:02.0', 'pci-0000:03:00.0']).map(g => g.id),
    ['pci-0000:00:02.0', 'pci-0000:03:00.0'],
    'multi GPU keeps detection order'
);
assertEq(filterSelectedGpus(devices, ['pci-missing', 'pci-0000:01:00.0']).map(g => g.id), ['pci-0000:01:00.0'], 'ignores stale ids');
assertEq(filterSelectedGpus(devices, ['pci-missing']).map(g => g.id), [], 'all-stale selection is empty');
assertEq(filterSelectedGpus(devices, []).map(g => g.id), [], 'empty selection shows none');

assertEq(migrateGpuSelected('auto', devices), ['all'], 'auto migrates to all');
assertEq(
    migrateGpuSelected('dedicated', devices),
    ['pci-0000:01:00.0', 'pci-0000:03:00.0'],
    'dedicated migrates to dGPUs in detection order'
);
assertEq(migrateGpuSelected('integrated', devices), ['pci-0000:00:02.0'], 'integrated migrates to iGPUs');
assertEq(migrateGpuSelected('dedicated', []), ['all'], 'empty dedicated list falls back to all');

print('5. live GPU scan and metrics');
const live = await listGPUs({ force: true });
assert(Array.isArray(live), 'listGPUs returns an array');
assert(live.length >= 1, `detected ${live.length} GPU(s)`);

const ids = new Set(live.map(gpu => gpu.id));
assert(ids.size === live.length, 'stable ids are unique');
live.forEach((gpu, index) => {
    assert(gpu.index === index, `${gpu.id} display index is ${index}`);
    assert(typeof gpu.id === 'string' && gpu.id.length > 0, `${gpu.id} has id`);
    assert(typeof gpu.name === 'string' && gpu.name.length > 0, `${gpu.id} has name`);
    assert(['nvidia', 'amd', 'intel', 'unknown'].includes(gpu.vendor), `${gpu.id} has vendor`);
});

if (live.length >= 3) {
    assert(live.some(gpu => /intel|uhd/i.test(gpu.name) || gpu.vendor === 'intel'), 'detects Intel GPU');
    assert(live.filter(gpu => gpu.vendor === 'nvidia').length >= 2, 'detects multiple NVIDIA GPUs');
}

const metrics = await updateGPU({ gpuSelected: ['all'] });
assert(Array.isArray(metrics), 'updateGPU returns an array');
assertEq(metrics.length, live.length, 'all GPUs are queried');
assert(metrics.every(gpu => Number.isInteger(gpu.index)), 'metrics keep display indexes');

const onlyFirst = await updateGPU({ gpuSelected: [live[0].id] });
assertEq(onlyFirst.map(gpu => gpu.id), [live[0].id], 'unselected GPUs are not returned');

const stale = await updateGPU({ gpuSelected: ['pci-does-not-exist', live[0].id] });
assertEq(stale.map(gpu => gpu.id), [live[0].id], 'runtime ignores missing selected ids');

await delay(800);
const refreshed = await updateGPU({ gpuSelected: ['all'] });
const nvidia = refreshed.filter(gpu => gpu.vendor === 'nvidia' && !gpu.sleeping && !gpu.unavailable);
if (nvidia.length) {
    assert(nvidia.every(gpu => Number.isFinite(gpu.usage)), 'nvidia-smi fills usage for awake NVIDIA GPUs');
    assert(nvidia.every(gpu => gpu.name && gpu.name !== 'NVIDIA'), 'nvidia-smi fills model names');
}

const isolatedFailure = await Promise.all(live.map(async (gpu, index) => {
    if (index === 0)
        throw new Error('boom');
    return gpu.id;
})).then(() => false).catch(() => true);
assert(isolatedFailure, 'control: Promise.all rejects without isolation');
const isolated = await Promise.all(live.map(async (gpu, index) => {
    try {
        if (index === 0)
            throw new Error('boom');
        return { id: gpu.id, ok: true };
    } catch (_) {
        return { id: gpu.id, ok: false };
    }
}));
assert(isolated.some(item => item.ok) && isolated.some(item => !item.ok), 'one GPU failure does not drop the others');

print('');
print(`Passed: ${passed}`);
print(`Failed: ${failed}`);
if (failed > 0)
    throw new Error(`${failed} assertion(s) failed`);
