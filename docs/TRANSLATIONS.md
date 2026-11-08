# Internationalization & Translations Guide

RezMon uses standard GNU **Gettext** for internationalization (i18n). All user-facing strings across the extension indicator, popup menu, and preferences dialog are wrapped in gettext calls:

```javascript
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

const label = _("System Status Overview");
```

The extension's gettext domain is configured as `"rezmon"` in [`src/metadata.json`](file:///home/azzlol/dev/RezMon/src/metadata.json) and initialized via `this.initTranslations()` in both `extension.js` and `prefs.js`.

---

## 1. Adding a New Translation

To contribute a new language translation:

1. **Locate the Template**:
   The master string template is located at [`po/rezmon.pot`](file:///home/azzlol/dev/RezMon/po/rezmon.pot).

2. **Create a PO File**:
   Copy the template to `po/<lang>.po`, replacing `<lang>` with your two-letter language code (e.g., `de.po` for German, `fr.po` for French, `pt_BR.po` for Brazilian Portuguese):
   ```bash
   cp po/rezmon.pot po/fr.po
   ```

3. **Translate Messages**:
   Open the `.po` file in a text editor or a translation tool such as [Poedit](https://poedit.net/). Fill in the translated strings under each `msgstr`:
   ```po
   msgid "System Status Overview"
   msgstr "Aperçu de l'état du système"

   msgid "CPU Settings"
   msgstr "Paramètres du processeur"
   ```

4. **Compile Locales**:
   Compile the `.po` file to binary `.mo` catalogs:
   ```bash
   make mo
   # Or without make:
   python3 scripts/compile-locales.py
   ```
   This generates the compiled binary under `src/locale/<lang>/LC_MESSAGES/rezmon.mo`.

5. **Test Your Translation**:
   Install and test with your system language set to your target locale:
   ```bash
   make install
   ```

---

## 2. Updating Translation Strings (`po/rezmon.pot`)

If you add new features or modify existing user-facing strings in the codebase:

1. Run the `pot` target:
   ```bash
   make pot
   ```
   This runs an extraction script that scans all `.js` files for `_("...")` occurrences and regenerates `po/rezmon.pot`.

2. Merge the updated template with existing translations (e.g. using `msgmerge` if available):
   ```bash
   msgmerge -U po/es.po po/rezmon.pot
   ```

3. Recompile the updated translation catalogs:
   ```bash
   make mo
   ```

