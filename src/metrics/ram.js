import { readFileLines } from '../utils/file.js';

export function updateRAM(state) {

    try {
        const lines = readFileLines('/proc/meminfo');

        let total = null;
        let available = null;

        for (const line of lines) {
            let [k, v] = line.split(':');

            if (v)
                v = parseInt(v.trim(), 10);

            if (k === 'MemTotal')
                total = v;
            else if (k === 'MemAvailable')
                available = v;

            if (total !== null && available !== null)
                break;
        }

        if (total === null || available === null || total <= 0) {
            return null;
        }

        const used = Math.max(0, total - available);

        return {
            used: used / (1024 * 1024),
            free: available / (1024 * 1024),
            percent: (used / total) * 100
        };

    } catch (e) {
        logError(e);
        return null;
    }
}