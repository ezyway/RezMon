import GLib from 'gi://GLib';
import { readFileLines } from '../utils/file.js';

export function updateNET(state) {

    try {

        let [ok,out] = GLib.spawn_command_line_sync(
            'bash -c "ip route get 1 | awk \'{print $5; exit}\'"'
        );

        const iface = ok ? new TextDecoder().decode(out).trim() : '';

        const lines = readFileLines('/proc/net/dev');

        let tx=0;
        let rx=0;

        for(let i=2;i<lines.length;i++) {

            const l=lines[i].trim();

            if(l.startsWith(iface)) {

                const v=l.split(/\s+/);

                rx=parseInt(v[1]);
                tx=parseInt(v[9]);

                break;
            }
        }

        const now = Date.now()/1000;
        const dt = now-state.prev_time;

        let txs=(tx-state.prev_tx_bytes)/dt;
        let rxs=(rx-state.prev_rx_bytes)/dt;

        const units=['B/s','KB/s','MB/s','GB/s'];

        let u=0;

        while(txs>99 || rxs>99) {

            txs/=1024;
            rxs/=1024;
            u++;

        }

        state.prev_tx_bytes=tx;
        state.prev_rx_bytes=rx;
        state.prev_time=now;

        const rxLabel=rxs.toFixed(0).padStart(2,'0');
        const txLabel=txs.toFixed(0).padStart(2,'0');

        return `NET${state.b_open}￬ ${rxLabel} ${state.delimiter} ￪ ${txLabel}${state.b_close}${units[u]}`;

    } catch(e) {

        logError(e);
        return "";

    }
}