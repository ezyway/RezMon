import GLib from 'gi://GLib';
import { readFileLines } from '../utils/file.js';

async function getDefaultInterface() {
    const lines = await readFileLines('/proc/net/route');
    let bestIface = '';
    let lowestMetric = Infinity;

    for (let i = 1; i < lines.length; i++) {
        const fields = lines[i].trim().split(/\s+/);
        if (fields.length >= 7 && fields[1] === '00000000') {
            const flags = parseInt(fields[3], 16);
            if ((flags & 0x2) !== 0) {
                const metric = parseInt(fields[6], 10) || 0;
                if (metric < lowestMetric) {
                    lowestMetric = metric;
                    bestIface = fields[0];
                }
            } else if (!bestIface) {
                bestIface = fields[0];
            }
        }
    }
    return bestIface;
}

export async function getAvailableInterfaces() {
    const lines = await readFileLines('/proc/net/dev');
    const ifaces = [];
    for (let i = 2; i < lines.length; i++) {
        const line = lines[i].trim();
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
            const iface = line.substring(0, colonIdx).trim();
            if (iface && iface !== 'lo') {
                ifaces.push(iface);
            }
        }
    }
    return ifaces;
}

export async function updateNET(state) {
    try {
        let selected = state.netInterface || 'auto';
        let iface = '';

        if (selected !== 'auto') {
            const available = await getAvailableInterfaces();
            if (available.includes(selected)) {
                iface = selected;
            } else {
                iface = await getDefaultInterface();
            }
        } else {
            iface = await getDefaultInterface();
        }

        if (!iface) {
            state.prev_iface = '';
            return { down: 0, up: 0 };
        }

        const lines = await readFileLines('/proc/net/dev');

        let tx = 0;
        let rx = 0;

        for (let i = 2; i < lines.length; i++) {
            const l = lines[i].trim();
            const colonIdx = l.indexOf(':');
            if (colonIdx !== -1) {
                const ifaceName = l.substring(0, colonIdx).trim();
                if (ifaceName === iface) {
                    const stats = l.substring(colonIdx + 1).trim().split(/\s+/);
                    rx = parseInt(stats[0], 10) || 0;
                    tx = parseInt(stats[8], 10) || 0;
                    break;
                }
            }
        }

        const now = GLib.get_monotonic_time() / 1000000;
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
