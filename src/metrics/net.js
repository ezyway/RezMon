import { readFileLines } from '../utils/file.js';

function getDefaultInterface() {
    const lines = readFileLines('/proc/net/route');
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

export function updateNET(state) {

    try {
        const iface = getDefaultInterface();

        if (!iface) {
            state.prev_iface = '';
            return { down: 0, up: 0 };
        }

        const lines = readFileLines('/proc/net/dev');

        let tx = 0;
        let rx = 0;
        const ifacePrefix = `${iface}:`;

        for (let i = 2; i < lines.length; i++) {
            const l = lines[i].trim();

            if (l.startsWith(ifacePrefix)) {
                const v = l.split(/\s+/);
                rx = parseInt(v[1], 10) || 0;
                tx = parseInt(v[9], 10) || 0;
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