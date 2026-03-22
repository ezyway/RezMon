import { readFileLines } from '../utils/file.js';

export function updateCPU(state) {

    let cpu_usage = 0;
    let ghz_value = 0;
    let cpu_temp = 0;

    try {

        const lines = readFileLines('/proc/stat');

        for(const line of lines) {

            const fields = line.trim().split(/\s+/);

            if(fields[0] === 'cpu') {

                const nums = fields.slice(1).map(Number);

                const idle = nums[3];
                const iowait = nums[4] || 0;

                const total = nums.slice(0,4).reduce((a,b)=>a+b,0)+iowait;
                const used = total-idle-iowait;

                const total_diff = total-state.prev_total;
                const used_diff = used-state.prev_used;

                if(total_diff>0)
                    cpu_usage=((used_diff/total_diff)*100).toFixed(0);

                state.prev_total = total;
                state.prev_used = used;

                break;
            }
        }

    } catch(e) { logError(e); }

    try {

        const lines = readFileLines('/proc/cpuinfo');

        let mhz=0;
        let count=0;

        for(const line of lines) {

            const f=line.trim().split(/\s+/);

            if(f[0]==='cpu' && f[1]==='MHz') {

                mhz+=parseInt(f[3]);
                count++;

            }
        }

        ghz_value=(mhz/count)/1000;

    } catch(e) { logError(e); }

    try {

        const lines = readFileLines('/sys/class/thermal/thermal_zone0/temp');
        cpu_temp=parseInt(lines.toString())/1000;

    } catch(e) {}

    return `CPU${state.b_open}${cpu_usage}% ${state.delimiter} ${ghz_value.toFixed(2)}GHz ${state.delimiter} ${cpu_temp}℃${state.b_close}`;
}