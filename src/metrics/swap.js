'use strict';

import { readFileLines } from '../utils/file.js';

export function updateSWAP(state = {}, { force = false } = {}) {
    if (!force && state.showSWAP === false) {
        return null;
    }

    let swapTotalKb = 0;
    let swapFreeKb = 0;
    let foundTotal = false;
    let foundFree = false;

    try {
        const lines = readFileLines('/proc/meminfo');

        for (const line of lines) {
            if (line.startsWith('SwapTotal:')) {
                swapTotalKb = parseInt(line.split(/\s+/)[1], 10) || 0;
                foundTotal = true;
            } else if (line.startsWith('SwapFree:')) {
                swapFreeKb = parseInt(line.split(/\s+/)[1], 10) || 0;
                foundFree = true;
            }

            if (foundTotal && foundFree) {
                break;
            }
        }
    } catch (e) {
        return null;
    }

    if (swapTotalKb <= 0) {
        return {
            hasSwap: false,
            used: 0,
            free: 0,
            percent: 0,
            total: 0,
        };
    }

    const swapUsedKb = Math.max(0, swapTotalKb - swapFreeKb);
    const swapUsedG = swapUsedKb / (1024 * 1024);
    const swapFreeG = swapFreeKb / (1024 * 1024);
    const swapPercent = (swapUsedKb / swapTotalKb) * 100;

    return {
        hasSwap: true,
        used: swapUsedG,
        free: swapFreeG,
        percent: swapPercent,
        total: swapTotalKb / (1024 * 1024),
    };
}
