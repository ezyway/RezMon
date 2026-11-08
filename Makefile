UUID := $(shell grep -Po '"uuid":\s*"\K[^"]+' src/metadata.json)

EXTDIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
BUILD := build/$(UUID)

SRC := $(shell find src -type f)

.PHONY: build install reload uninstall zip clean pot


build: $(SRC)
	rm -rf build
	mkdir -p $(BUILD)
	cp -r src/* $(BUILD)

	@if [ -d "$(BUILD)/schemas" ]; then \
		echo "Compiling schemas..."; \
		glib-compile-schemas $(BUILD)/schemas; \
	fi


install: build
	rm -rf $(EXTDIR)
	mkdir -p $(EXTDIR)
	cp -r $(BUILD)/* $(EXTDIR)

	gnome-extensions disable $(UUID) 2>/dev/null || true
	gnome-extensions enable $(UUID) 2>/dev/null || true

	echo "Installed $(UUID)"


reload: install
	echo "Reloaded $(UUID)"


uninstall:
	gnome-extensions disable $(UUID) 2>/dev/null || true
	rm -rf $(EXTDIR)

	echo "Uninstalled $(UUID)"


zip: build
	rm -f $(UUID).zip
	cd $(BUILD) && zip -r ../../$(UUID).zip . \
		-x "*.git*" "*node_modules*" "*__pycache__*" "*.DS_Store" "*gschemas.compiled*"

	echo "Created $(UUID).zip"


clean:
	rm -rf build

pot:
	python3 -c "import re, glob, os; strings = sorted(set(re.findall(r'_\([\"\'](.*?)[\"\']\)', ''.join(open(p, encoding='utf-8').read() for p in glob.glob('src/**/*.js', recursive=True) + glob.glob('src/*.js'))))); os.makedirs('po', exist_ok=True); f = open('po/rezmon.pot', 'w', encoding='utf-8'); f.write('# RezMon POT\nmsgid \"\"\nmsgstr \"\"\n\"Content-Type: text/plain; charset=UTF-8\\n\"\n\n'); [f.write(f'msgid \"{s}\"\nmsgstr \"\"\n\n') for s in strings if s]; print(f'Updated po/rezmon.pot with {len(strings)} strings')"