# Preferences & Customization Guide

RezMon features an intuitive, modern configuration interface built with GTK4 and Libadwaita (`adw-gtk3` / `libadwaita`). Open preferences anytime by clicking **RezMon** on the panel and selecting **Open Settings**, or via the GNOME **Extensions** application.

---

## 1. Status Bar Display Modes

In the **Appearance** settings page, you can choose between three distinct display styles:

| Mode | Appearance Example | Description |
| :--- | :--- | :--- |
| **Text Headers** *(Default)* | `CPU(45% | 3.20GHz) RAM(4.2G)` | Standard metric identification labels. |
| **Symbolic Icons** | `⚙(45% | 3.20GHz) 🖴(4.2G)` | Compact visual symbols: `⚙` CPU, `🖥` GPU, `🖴` RAM, `⇄` SWAP, `💾` Disk, `🌐` Net. |
| **Compact Mode** | `(45% | 3.20GHz) (4.2G)` | Hides all labels and symbols, showing only the telemetry values inside brackets. |

---

## 2. Metric Ordering & Component Visibility

### Component Toggles
Under the **General** page, you can independently enable or disable any of the 6 core components on the status bar:
- **Show CPU**
- **Show GPU**
- **Show RAM**
- **Show SWAP**
- **Show DISK**
- **Show NET**

### Dynamic Metric Sequence
Under the **Metric Display Order** section on the General page, you can customize the order in which enabled metrics appear on your top panel.
- Use the **Up (`▲`)** and **Down (`▼`)** buttons to arrange metrics into any order (e.g. `RAM` $\to$ `CPU` $\to$ `NET`).
- Click **Reset** to restore the default sequence (`CPU` $\to$ `GPU` $\to$ `RAM` $\to$ `SWAP` $\to$ `DISK` $\to$ `NET`).

---

## 3. Panel & Clock Repositioning

Under the **Misc** page, RezMon provides deep layout options for integrating into custom desktop setups:

### Panel Position & Priority
- **Panel Position**: Place RezMon in the **Right (Default)**, **Center**, or **Left** box of the GNOME top bar.
- **Panel Order Index / Priority**: Set an integer index (0–30) to position RezMon relative to other panel extensions or system tray icons.

### Ubuntu Centered Clock Repositioning
Ubuntu and GNOME place the date and clock menu in the center panel box by default. If you prefer your system telemetry in the center, or want an uncluttered panel:
- **Clock Position**: Move the date/clock menu to **Left**, **Right**, or keep it **Center (Default)**.
- **Notification Banner Alignment**: Automatically aligns incoming desktop notifications with the date/clock menu (`Start`, `Center`, or `End`).
- **Safe Restoration**: When RezMon is disabled or updated, the date/clock menu is automatically returned to its original parent container and index.

---

## 4. Visual Styling & Appearance

Configure formatting details under the **Appearance** page:

- **Brackets**: Choose between parentheses `( )`, square brackets `[ ]`, or curly braces `{ }`.
- **Delimiter**: Select between vertical bar `|`, hyphen `-`, tilde `~`, slash `/`, backslash `\`, colon `:`, semicolon `;`, plus `+`, equals `=`, or a space.
- **Spacing**: Choose between `Small` (2 spaces), `Normal` (4 spaces), or `Wide` (8 spaces) padding between metric sections.
- **Temperature Unit**: Choose **Celsius (℃)** or **Fahrenheit (℉)**. Temperature values and alert thresholds automatically convert.

---

## 5. Alert Thresholds & Update Interval

### Color Coding
When hardware metrics exceed configured thresholds, values are colored to provide immediate visual feedback:
- **Normal**: Matches system theme foreground color.
- **Warning**: Highlighted in **Yellow** (`#f1c40f`).
- **Critical**: Highlighted in **Red** (`#ff5555`).

### Configurable Thresholds (Misc Page)
- **Usage Warning Threshold (%)**: Default `70%`.
- **Usage Critical Threshold (%)**: Default `90%`.
- **Temperature Warning Threshold**: Default `75℃` (`167℉`).
- **Temperature Critical Threshold**: Default `85℃` (`185℉`).

### Update Interval
Configure the status bar polling cadence between **1** and **5** seconds. *(Note: When the dropdown menu is opened, the system overview dashboard automatically switches to a live 1-second refresh cadence for responsive telemetry, then returns to your configured interval when closed).*

---

## 6. Popup System Overview & App Launchers

Clicking the indicator opens the live **System Status Overview** popup:

- **Visual Progress Bars**: `████████░░░░░░ 54%` for CPU, RAM, SWAP, GPU, and Root storage.
- **Top Resource Consumers**: Top 3 processes sorted by CPU and Memory usage.
- **System Monitor Launchers**: Automatically detects installed monitors and creates one-click launchers:
  - **GUI Monitors**: *GNOME System Monitor*, *Resources*, *Mission Center*.
  - **CLI Monitors**: *btop*, *htop*. Terminal monitors launch automatically in your installed terminal (*kitty*, *alacritty*, *ptyxis*, *wezterm*, *foot*, *gnome-terminal*, *xterm*).
