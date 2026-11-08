import Gio from 'gi://Gio';

const decoder = new TextDecoder('utf-8');

export function readFile(filePath, cancellable = null) {
    return new Promise((resolve) => {
        try {
            const file = Gio.File.new_for_path(filePath);
            file.load_contents_async(cancellable, (obj, res) => {
                try {
                    const [ok, contents] = obj.load_contents_finish(res);
                    if (!ok || !contents) {
                        resolve(null);
                        return;
                    }
                    resolve(decoder.decode(contents));
                } catch {
                    resolve(null);
                }
            });
        } catch {
            resolve(null);
        }
    });
}

export async function readFileLines(filePath, cancellable = null) {
    const content = await readFile(filePath, cancellable);
    if (!content) return [];
    return content.split('\n');
}
