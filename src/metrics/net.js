import GLib from 'gi://GLib';
import { readFileLines } from '../utils/file.js';

export function updateNET(state) {

    try {
        let [ok, out] = GLib.spawn_command_line_sync(
            'bash -c "ip route get 1 | awk \'{print $5; exit}\'"'
        );

        const iface = ok ? new TextDecoder().decode(out).trim() : '';

        const lines = readFileLines('/proc/net/dev');

        let tx = 0;
        let rx = 0;

        for (let i = 2; i < lines.length; i++) {
            const l = lines[i].trim();

            if (l.startsWith(iface)) {
                const v = l.split(/\s+/);
                rx = parseInt(v[1]);
                tx = parseInt(v[9]);
                break;
            }
        }

        const now = Date.now() / 1000;
        const dt = state.prev_time ? (now - state.prev_time) : 0;

        if (!state.prev_time || state.prev_iface !== iface || dt <= 0) {
            state.prev_tx_bytes = tx;
            state.prev_rx_bytes = rx;
            state.prev_time = now;
            state.prev_iface = iface;
            return { down: 0, up: 0 };
        }

        let txs = (tx >= state.prev_tx_bytes && dt > 0) ? (tx - state.prev_tx_bytes) / dt : 0;
        let rxs = (rx >= state.prev_rx_bytes && dt > 0) ? (rx - state.prev_rx_bytes) / dt : 0;

        state.prev_tx_bytes = tx;
        state.prev_rx_bytes = rx;
        state.prev_time = now;
        state.prev_iface = iface;

        return {
            down: rxs,
            up: txs
        };

    } catch (e) {
        logError(e);
        return null;
    }
}