'use strict';

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { readFileLines } from '../utils/file.js';

let physicalDisks = null;

function getPhysicalDisks() {
    if (physicalDisks) return physicalDisks;

    const blockDir = Gio.File.new_for_path('/sys/block');
    const disks = new Set();
    if (blockDir.query_exists(null)) {
        let enumerator = null;
        try {
            enumerator = blockDir.enumerate_children(
                'standard::name',
                Gio.FileQueryInfoFlags.NONE,
                null
            );
            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                const name = info.get_name();
                if (!name.startsWith('loop') && !name.startsWith('ram') && !name.startsWith('zram')) {
                    disks.add(name);
                }
            }
        } catch (e) {
        } finally {
            if (enumerator) {
                try { enumerator.close(null); } catch (_) {}
            }
        }
    }
    physicalDisks = disks;
    return physicalDisks;
}

export async function updateDisk(state, { force = false } = {}) {
    if (!force && state.showDisk === false) return null;

    let readRate = 0;
    let writeRate = 0;
    const now = GLib.get_monotonic_time() / 1000;

    // 1. Throughput from /proc/diskstats
    if (force || state.diskRead || state.diskWrite) {
        try {
            const disks = getPhysicalDisks();
            const lines = await readFileLines('/proc/diskstats');
            let totalReadSectors = 0;
            let totalWriteSectors = 0;

            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 14) {
                    const devName = parts[2];
                    if (disks.has(devName)) {
                        totalReadSectors += parseInt(parts[5], 10) || 0;
                        totalWriteSectors += parseInt(parts[9], 10) || 0;
                    }
                }
            }

            const totalReadBytes = totalReadSectors * 512;
            const totalWriteBytes = totalWriteSectors * 512;

            if (state.prev_disk_time && state.prev_disk_read !== undefined && state.prev_disk_write !== undefined) {
                const dt = (now - state.prev_disk_time) / 1000;
                if (dt > 0) {
                    const dRead = Math.max(0, totalReadBytes - state.prev_disk_read);
                    const dWrite = Math.max(0, totalWriteBytes - state.prev_disk_write);
                    readRate = dRead / dt;
                    writeRate = dWrite / dt;
                }
            }

            state.prev_disk_time = now;
            state.prev_disk_read = totalReadBytes;
            state.prev_disk_write = totalWriteBytes;
        } catch (e) {}
    }

    // 2. Storage space from root filesystem
    let spaceUsedG = null;
    let spaceFreeG = null;
    let spacePercent = null;

    if (force || state.diskSpaceUsed || state.diskSpaceFree || state.diskSpacePercent) {
        try {
            const rootFile = Gio.File.new_for_path('/');
            const info = rootFile.query_filesystem_info('filesystem::free,filesystem::size', null);
            if (info) {
                const freeBytes = info.get_attribute_uint64('filesystem::free');
                const sizeBytes = info.get_attribute_uint64('filesystem::size');
                if (sizeBytes > 0) {
                    const usedBytes = Math.max(0, sizeBytes - freeBytes);
                    spaceUsedG = usedBytes / (1024 * 1024 * 1024);
                    spaceFreeG = freeBytes / (1024 * 1024 * 1024);
                    spacePercent = (usedBytes / sizeBytes) * 100;
                }
            }
        } catch (e) {}
    }

    return {
        read: readRate,
        write: writeRate,
        spaceUsed: spaceUsedG,
        spaceFree: spaceFreeG,
        spacePercent: spacePercent,
    };
}
