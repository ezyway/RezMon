import GLib from 'gi://GLib';

const decoder = new TextDecoder('utf-8');

export function readFile(filePath) {
    try {
        const [ok, content] = GLib.file_get_contents(filePath);
        if (!ok) return null;
        return decoder.decode(content);
    } catch (e) {
        return null;
    }
}

export function readFileLines(filePath) {
    try {
        const [ok, content] = GLib.file_get_contents(filePath);
        if (!ok) return [];
        return decoder.decode(content).split('\n');
    } catch (e) {
        return [];
    }
}
