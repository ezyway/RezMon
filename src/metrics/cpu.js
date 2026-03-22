import { readFileLines } from '../utils/file.js';

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

    try {
        const lines = readFileLines('/proc/cpuinfo');

        let mhz = 0;
        let count = 0;

        for (const line of lines) {
            const f = line.trim().split(/\s+/);

            if (f[0] === 'cpu' && f[1] === 'MHz') {
                mhz += parseInt(f[3]);
                count++;
            }
        }

        ghz_value = (mhz / count) / 1000;

    } catch (e) { logError(e); }

    try {
        const lines = readFileLines('/sys/class/thermal/thermal_zone0/temp');
        cpu_temp = parseInt(lines.toString()) / 1000;
    } catch (e) {}

    return {
        usage: cpu_usage,
        clock: ghz_value,
        temp: cpu_temp
    };
}