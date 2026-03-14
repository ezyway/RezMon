UUID := $(shell grep -Po '"uuid":\s*"\K[^"]+' src/metadata.json)
EXTDIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
BUILD := build/$(UUID)

all: build

build:
	mkdir -p $(BUILD)
	cp -r src/* $(BUILD)

	if [ -d "$(BUILD)/schemas" ]; then \
		glib-compile-schemas $(BUILD)/schemas; \
	fi

install: build
	rm -rf $(EXTDIR)
	mkdir -p $(EXTDIR)
	cp -r $(BUILD)/* $(EXTDIR)

	# refresh extension cache
	gnome-extensions list > /dev/null

	# reload extension if already enabled
	gnome-extensions disable $(UUID) 2>/dev/null || true
	gnome-extensions enable $(UUID) 2>/dev/null || true

	echo "Installed $(UUID)"

uninstall:
	gnome-extensions disable $(UUID) || true
	rm -rf $(EXTDIR)

reload:
	gnome-extensions disable $(UUID)
	gnome-extensions enable $(UUID)

zip: build
	cd build && zip -r ../$(UUID).zip $(UUID)

clean:
	rm -rf build
