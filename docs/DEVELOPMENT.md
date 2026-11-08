# Development & Packaging Guide

This guide covers building, testing, and packaging RezMon for development and GNOME Extensions (EGO) distribution.

---

## 1. Repository Layout

```
RezMon/
├── src/                               # Extension source files
│   ├── extension.js                   # Extension entry point & clock repositioning
│   ├── indicator.js                   # PanelMenu.Button actor, menu & timer loop
│   ├── prefs.js                       # Libadwaita preferences window
│   ├── metadata.json                  # Extension metadata, UUID & shell versions
│   ├── metrics/                       # Telemetry providers
│   │   ├── cpu.js                     # /proc/stat, cpufreq, thermal zones
│   │   ├── gpu.js                     # Multi-GPU (NVIDIA, AMD, Intel, VRAM)
│   │   ├── ram.js                     # /proc/meminfo memory
│   │   ├── swap.js                    # /proc/meminfo swap
│   │   ├── disk.js                    # /proc/diskstats I/O & root storage
│   │   ├── net.js                     # Routing priority & interface traffic
│   │   └── top.js                     # Async process ranking via ps
│   ├── utils/                         # Helper utilities
│   │   └── file.js                    # TextDecoder & safe file reading
│   ├── schemas/                       # GSettings schema definition
│   │   └── org.gnome.shell.extensions.rezmon.gschema.xml
│   └── locale/                        # Compiled gettext binaries (.mo)
│       └── es/LC_MESSAGES/rezmon.mo
├── po/                                # Translation catalogs
│   ├── rezmon.pot                     # Gettext template
│   └── es.po                          # Spanish translation
├── scripts/                           # Build & maintenance scripts
│   └── compile-locales.py             # Zero-dependency gettext compiler
├── docs/                              # In-depth reference documentation
├── Makefile                           # Development automation
└── README.md                          # Repository overview
```

---

## 2. Building & Testing

### Using `Makefile` (Recommended)

The provided `Makefile` automates all common development tasks:

| Target | Command | Description |
| :--- | :--- | :--- |
| **build** | `make build` | Prepares extension files under `build/`, compiles locales, and compiles GSettings schemas. |
| **install** | `make install` | Builds and installs to `~/.local/share/gnome-shell/extensions/rezmon@azz.lol`, then enables the extension. |
| **reload** | `make reload` | Alias for `make install` to refresh active files. |
| **uninstall** | `make uninstall` | Disables and removes the extension from the local extensions directory. |
| **zip** | `make zip` | Creates a production-ready package zip (`rezmon@azz.lol.zip`) compliant with EGO submission guidelines. |
| **pot** | `make pot` | Scans all JS files and updates the gettext template `po/rezmon.pot`. |
| **mo** | `make mo` | Compiles all `.po` files in `po/` to `.mo` binaries under `locale/`. |
| **clean** | `make clean` | Cleans up the `build/` directory. |

---

### Direct Bash Build (Without `make`)

If `make` is unavailable on your system, execute the following shell commands to install RezMon locally:

```bash
UUID=$(grep -Po '"uuid":\s*"\K[^"]+' src/metadata.json)
BUILD="build/${UUID}"
EXTDIR="$HOME/.local/share/gnome-shell/extensions/${UUID}"

# 1. Prepare build directory
rm -rf build && mkdir -p "${BUILD}" && cp -r src/* "${BUILD}/"

# 2. Compile gettext translations and schemas
python3 scripts/compile-locales.py "${BUILD}/locale"
glib-compile-schemas "${BUILD}/schemas"

# 3. Install to local GNOME Shell directory
rm -rf "${EXTDIR}" && mkdir -p "${EXTDIR}" && cp -r "${BUILD}"/* "${EXTDIR}/"

# 4. Enable extension
gnome-extensions enable "${UUID}"
```

---

## 3. GNOME Extensions (EGO) Packaging Rules

When submitting updates to [extensions.gnome.org (EGO)](https://extensions.gnome.org), packages must adhere strictly to review guidelines:

1. **No `gschemas.compiled` in the Release ZIP**:
   EGO reviews will fail if `gschemas.compiled` is bundled inside the archive. The schema must be distributed as the raw XML file in `schemas/org.gnome.shell.extensions.rezmon.gschema.xml`. The client machine compiles schemas automatically upon installation.
   *`make zip` automatically excludes `*gschemas.compiled*`.*

2. **Archive Root Structure**:
   The contents of `src/` must reside directly at the root of the ZIP file (i.e. `metadata.json`, `extension.js`, `prefs.js` at the top level), never nested inside an enclosing parent folder.

3. **No Synchronous Process Spawning**:
   Subprocesses must be spawned asynchronously via `Gio.Subprocess` with `communicate_utf8_async`. Calling `GLib.spawn_command_line_sync` or `GLib.spawn_sync` freezes the GNOME Shell Wayland compositor and will be rejected in review.

4. **Resource Management**:
   Always close `GFileEnumerator` handles via `enumerator.close(null)` in a `finally` block to prevent file descriptor leaks.

---

## 4. Code Verification Checklist

Before committing code or submitting release packages, run these quick sanity checks:

```bash
# 1. Validate JavaScript syntax
node -c src/extension.js src/prefs.js src/indicator.js src/metrics/*.js src/utils/*.js

# 2. Validate GSettings XML schema
glib-compile-schemas --strict src/schemas/ && rm -f src/schemas/gschemas.compiled

# 3. Validate metadata.json
python3 -m json.tool src/metadata.json > /dev/null

# 4. Verify release zip contents (ensuring no gschemas.compiled)
make zip
unzip -l rezmon@azz.lol.zip | grep gschemas.compiled || echo "Clean: Ready for EGO"
```
