import Gio from 'gi://Gio';

export function readFileLines(filePath) {

    try {

        const file = Gio.File.new_for_path(filePath);
        const [,content] = file.load_contents(null);

        const decoder = new TextDecoder("utf-8");
        const text = decoder.decode(content);

        return text.split('\n');

    } catch(e) {

        logError(e);
        return [];

    }
}