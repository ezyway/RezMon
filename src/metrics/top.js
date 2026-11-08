'use strict';

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * Asynchronously retrieves top resource consumers (CPU and Memory).
 * @returns {Promise<{topCpu: Array<{pid: string, name: string, cpu: number}>, topMem: Array<{pid: string, name: string, mem: number}>}>}
 */
export async function getTopProcesses() {
    return new Promise((resolve) => {
        let isResolved = false;
        const cancellable = new Gio.Cancellable();

        let timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            timeoutId = 0;
            if (!isResolved) {
                isResolved = true;
                cancellable.cancel();
                resolve({ topCpu: [], topMem: [] });
            }
            return GLib.SOURCE_REMOVE;
        });

        const safeResolve = (data) => {
            if (timeoutId) {
                GLib.source_remove(timeoutId);
                timeoutId = 0;
            }
            if (!isResolved) {
                isResolved = true;
                resolve(data);
            }
        };

        try {
            const proc = new Gio.Subprocess({
                argv: ['ps', '-eo', 'pid,comm,%cpu,%mem', '--no-headers'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
            });

            proc.init(cancellable);
            proc.communicate_utf8_async(null, cancellable, (proc, res) => {
                try {
                    const [, stdout] = proc.communicate_utf8_finish(res);
                    if (!stdout) {
                        safeResolve({ topCpu: [], topMem: [] });
                        return;
                    }

                    const procs = [];
                    const lines = stdout.split('\n');
                    for (const line of lines) {
                        const parts = line.trim().split(/\s+/);
                        if (parts.length >= 4) {
                            const pid = parts[0];
                            const mem = parseFloat(parts[parts.length - 1]) || 0;
                            const cpu = parseFloat(parts[parts.length - 2]) || 0;
                            const name = parts.slice(1, parts.length - 2).join(' ');
                            procs.push({ pid, name, cpu, mem });
                        }
                    }

                    const topCpu = [...procs]
                        .sort((a, b) => b.cpu - a.cpu)
                        .slice(0, 3)
                        .map(p => ({ pid: p.pid, name: p.name, cpu: p.cpu }));

                    const topMem = [...procs]
                        .sort((a, b) => b.mem - a.mem)
                        .slice(0, 3)
                        .map(p => ({ pid: p.pid, name: p.name, mem: p.mem }));

                    safeResolve({ topCpu, topMem });
                } catch (_) {
                    safeResolve({ topCpu: [], topMem: [] });
                }
            });
        } catch (_) {
            safeResolve({ topCpu: [], topMem: [] });
        }
    });
}
