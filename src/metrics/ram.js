import { readFileLines } from '../utils/file.js';

export function updateRAM(state) {

    try {

        const lines = readFileLines('/proc/meminfo');

        let total=null;
        let available=null;

        for(const line of lines) {

            let [k,v]=line.split(':');

            if(v)
                v=parseInt(v.trim(),10);

            if(k==='MemTotal')
                total=v;

            if(k==='MemAvailable')
                available=v;

        }

        const used = total-available;

        const usedGB = used/(1024*1024);
        const freeGB = available/(1024*1024);

        return `RAM${state.b_open}${usedGB.toFixed(1)} ${state.delimiter} ${freeGB.toFixed(1)}${state.b_close}GB`;

    } catch(e) {

        logError(e);
        return "";

    }
}