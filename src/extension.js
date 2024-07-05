/*
 * Author: AZZlOl
 * Description: Displays CPU(use percentage, average clock speed, temp), RAM(Used, Free),
 * NET(Download, Upload) usage on the top bar.
 * Version: 17
 * GNOME Shell Tested: 46 
 * GNOME Shell Supported: 45, 46
 * GitHub: https://github.com/ezyway/RezMon
 * 
 * Credits: Michael Knap - System Monitor Tray Indicator - https://github.com/michaelknap/gnome-system-monitor-indicator
 * License: MIT License
 */

'use strict';

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import { Button } from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { PopupMenuItem, PopupSubMenuMenuItem } from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { panel } from 'resource:///org/gnome/shell/ui/main.js';

// Define the main class for the system monitor indicator
export class RezMon extends Button {

  // Initialize the indicator
  _init(settings) {
    super._init(0, "Resource Monitor", false);
    this._settings = settings;

    // Create a layout box, initialize Label and add to box, add box to 'this' actor
    this.box = new St.BoxLayout();
    this.label = new St.Label({ text: "---Res Mon Label---", y_align: Clutter.ActorAlign.CENTER, style: 'margin-right: 12px;' })
    this.box.add_child(this.label);
    this.add_child(this.box);
    

    this._init_values();

    this._update_metrics();

    this._render_menu();
  }

  _init_values(){
    this.feature = ['CPU', 'RAM', 'NET'];
    this.feature_activations = [1, 1, 1];
    this.feature_functions = [this._update_cpu, this._update_ram, this._update_net];

    this.brackets = [ ['(',')'], ['[',']'], ['{','}'] ];
    this.bracket_index = 0;

    this.delimiters = ['|', '-', '~', '/', '\\', ':', ';', '+', '=', ' '];

    // Fetch values from settings
    this.b_open = this._settings.get_string("b-open");
    this.b_close = this._settings.get_string("b-close");
    this.delimiter = this._settings.get_string("delimiter");

    // Initialize previous CPU values
    this.prev_idle = 0;
    this.prev_total = 0;

    // Initialize previous values for network traffic speed calculation
    this.prev_time = Date.now() / 1000; // Convert milliseconds to seconds
    this.prev_tx_bytes = 0;
    this.prev_rx_bytes = 0;
  }

  _render_menu(){
    // Remove previous menu entries
    this.menu.removeAll();
    // Create main menu items
    for (let i = 0; i < this.feature.length; i++) { // Exclude the last feature "Change Brackets"
      const item = new PopupMenuItem(this.feature[i], { can_focus: true, hover: true, reactive: true });
      item.connect('activate', () => {
        this.feature_activations[i] = !this.feature_activations[i]; // Toggle feature activation (CPU, RAM, NET)
        this.labels[i].visible = this.feature_activations[i]; }); // Visibility toggle
      this.menu.addMenuItem(item);
    }
  
    // Create submenu for customization and create menu item
    const customizationSubMenu = new PopupSubMenuMenuItem("Customization");

    function save_settings(){
      this._settings.set_string('b-open', this.b_open);
      this._settings.set_string('b-close', this.b_close);

      this._settings.set_string('delimiter', this.delimiter); 
    }

    // Bracket Change Stuff
    const change_brackets = new PopupMenuItem("Change Brackets", { can_focus: true, hover: true, reactive: true });
    change_brackets.connect('activate', () => {
      this.bracket_index = (this.bracket_index + 1) % this.brackets.length; // Cycle through bracket options
      this.b_open = this.brackets[this.bracket_index][0];
      this.b_close = this.brackets[this.bracket_index][1];
      save_settings.call(this); });
    customizationSubMenu.menu.addMenuItem(change_brackets);

    // Change Delimiter
    const change_delimiter = new PopupMenuItem("Change Delimiter", { can_focus: true, hover: true, reactive: true });
    change_delimiter.connect('activate', () => {
      let index = this.delimiters.indexOf(this.delimiter);
      if(index != -1 && index < this.delimiters.length - 1){  // Go through delimiters
        this.delimiter = this.delimiters[index + 1];
      } else { this.delimiter = this.delimiters[0]; }
      save_settings.call(this); });
    customizationSubMenu.menu.addMenuItem(change_delimiter);

    // Bracket Padding Increase
    const add_padding = new PopupMenuItem("Add Padding", { can_focus: true, hover: true, reactive: true });
    add_padding.connect('activate', () => { // Add WhiteSpace before and after bracket
      this.b_open = ` ${this.b_open} `;
      this.b_close = ` ${this.b_close} `;
      save_settings.call(this); });
    customizationSubMenu.menu.addMenuItem(add_padding);

    // Bracket Padding Decrease
    const rem_padding = new PopupMenuItem("Remove Padding", { can_focus: true, hover: true, reactive: true });
    rem_padding.connect('activate', () => { // Checks if <WHITESPACE> is starting then slice both sides by 1
      if(this.b_open[0] == ' '){ this.b_open = this.b_open.slice(1, -1); }
      if(this.b_close[0] == ' '){ this.b_close = this.b_close.slice(1, -1); }
      save_settings.call(this); });
    customizationSubMenu.menu.addMenuItem(rem_padding);

    // Add Customization submenu to the main menu
    this.menu.addMenuItem(customizationSubMenu);
  }

  // Update metrics CPU, RAM, NET (Doesn't call the function if not activated)
  _update_metrics() {
    const updated_values = [];

    for(let i = 0; i < this.feature_activations.length; i++){
      if(this.feature_activations[i]){
        updated_values.push(this.feature_functions[i].call(this));
      }
    }

    this._write_to_status_bar(updated_values);

    // Remove existing timeout if any
    if (this._timeout) { GLib.source_remove(this._timeout); }
    
    // Set a timeout to refresh metrics
    const priority = GLib.PRIORITY_DEFAULT_IDLE;
    const refresh_time = 1; // Time in seconds
    this._timeout = GLib.timeout_add_seconds(priority, refresh_time, () => {
      this._update_metrics();
      return true;
    });
  }

  _write_to_status_bar(values){
    let output = "";
    for(let i = 0; i < values.length; i++){
      if(values[i] == ""){
        continue;
      }
      output += values[i] + "    ";
    }
    // this.label.clutter_text.set_markup(output);
    this.label.set_text(output);
  }

  _file_open(file_path){
    try{
      // Get file name and return lines of the file as array
      const file = Gio.File.new_for_path(file_path);
      const [, content] = file.load_contents(null);
      const text_decoder = new TextDecoder("utf-8");
      const content_str = text_decoder.decode(content);
      return content_str.split('\n');
    }
    catch (e){ console.error(`PROCESSING ERROR IN FILE: ${file_path} \n ${e}`); }
  }

  _update_cpu() {
    let cpu_usage = 0;
    let ghz_value = 0.0;
    let cpu_temp = 0;
    let content_lines;
    let turbo_frequency = 0;
    
    // CPU Usage -----------------------------------------------------------------------
    try{
      content_lines = this._file_open('/proc/stat');

      let current_cpu_used = 0;
      let current_cpu_total = 0;
      let current_cpu_usage = 0;

      for (const content_line of content_lines) {
        const fields = content_line.trim().split(/\s+/);

        if (fields[0] === 'cpu') {
          const nums = fields.slice(1).map(Number);
          const idle = nums[3];
          const iowait = nums[4] || 0; // Include iowait, defaulting to 0 if not present

          current_cpu_total = nums.slice(0, 4).reduce((a, b) => a + b, 0) + iowait;
          current_cpu_used = current_cpu_total - idle - iowait;

          // Ensure previous values are set on the first run
          this.prev_used = this.prev_used || current_cpu_used;
          this.prev_total = this.prev_total || current_cpu_total;

          // Calculate CPU usage as the difference from the previous measurement
          const total_diff = current_cpu_total - this.prev_total;
          const used_diff = current_cpu_used - this.prev_used;

          if (total_diff > 0) { // Check to avoid division by zero
            current_cpu_usage = (used_diff / total_diff) * 100;
            cpu_usage = current_cpu_usage.toFixed(0).toString();
          }

          // Store current values for the next calculation
          this.prev_used = current_cpu_used;
          this.prev_total = current_cpu_total;

          break; // Break after processing the first 'cpu' line
        }
      }
    } catch (e){ console.error(`CPU USAGE UPDATE FAILED: `, e); }

    // CPU GHz -----------------------------------------------------------------------
    try{
      content_lines = undefined;
      content_lines = this._file_open('/proc/cpuinfo');

      let mhz_count = 0;
      let cpu_count = 0;

      for (const content_line of content_lines) {
        const fields = content_line.trim().split(/\s+/);

        // check if element 1 and 2 is 'cpu' and 'MHz' in field = "cpu MHz : 3000.000"
        if (fields[0] === 'cpu' && fields[1] === 'MHz') {
          mhz_count += parseInt(fields[3]);
          cpu_count++;
        }
      }
      // Average GHz of all core clocks
      ghz_value = (mhz_count / cpu_count)/1000;

    } catch (e){ console.error(`CPU GHZ UPDATE FAILED: `, e); }


    // CPU Temp -----------------------------------------------------------------------
    try{
      // CPU TEMP - Execute 'sensors' command to get CPU temperature
      let [success, stdout,] = GLib.spawn_command_line_sync('cat /sys/class/thermal/thermal_zone0/temp');
      if (success) {
        let output = stdout.toString();
        cpu_temp = output/1000;
      }
    } catch (e){ console.error(`CPU TEMPERATURE UPDATE FAILED: `, e); }

    // Get turbo frequency -----------------------------------------------------------------------
    // try{ 
    //   let [result, output,] = GLib.spawn_command_line_sync('bash -c "lscpu | grep MHz"');
    //   const lscpuOutput = result ? new TextDecoder("utf-8").decode(new Uint8Array(output)).trim() : '';
    //   turbo_frequency = parseFloat(lscpuOutput.match(/CPU max MHz:\s+(\d+\.\d+)/)[1]) / 1000;
    // } catch (e){ console.error(`TURBO FREQUENCY FETCH FAILED: `, e); }


    return `CPU${this.b_open}${cpu_usage} % ${this.delimiter} ${ghz_value.toFixed(2)} GHz ${this.delimiter} ${cpu_temp} ℃${this.b_close}`;
  }

  _update_ram() {
    try {
      const content_lines = this._file_open('/proc/meminfo');
      let mem_total = null;
      let mem_available = null;
      let mem_used = null;

      content_lines.forEach((line) => {
        let [key, value] = line.split(':');
        if (value) { value = parseInt(value.trim(), 10); }

        switch (key) {
          case 'MemTotal': mem_total = value; break;
          case 'MemAvailable': mem_available = value; break;
        }
      });

      if (mem_total !== null && mem_available !== null) { mem_used = mem_total - mem_available; }
      
      mem_used /= 1024 * 1024;
      mem_available /= 1024 * 1024;


      let color = '#90EE90'; // Light green
      const percent = ((mem_used * ( 1024 * 1024 ))/mem_total)*100;
      if(percent > 80) {
        color = "#FF7F7F"; // Light red
      } else if(percent > 65) {
        color = "yellow";
      }

      return `RAM${this.b_open}${mem_used.toFixed(1)} ${this.delimiter} ${mem_available.toFixed(1)}${this.b_close}GB`;
    } catch (e) { console.error(e, `Failed to update memory usage.`); }
  }
  
  _update_net() {
    try {
      // Get Active Interface name for parsing
      let [result, output,] = GLib.spawn_command_line_sync('bash -c "ip route get 1 | awk \'{print $5; exit}\'"');
      const activeInterfaceName = result ? new TextDecoder("utf-8").decode(new Uint8Array(output)).trim() : '';

      const content_lines = this._file_open('/proc/net/dev');
      const interface_name = activeInterfaceName;
      let tx_bytes = 0;
      let rx_bytes = 0;

      for (let i = 2; i < content_lines.length; i++) {
          const line = content_lines[i].trim();
          if (line.startsWith(interface_name)) {
              const values = line.split(/\s+/);
              tx_bytes = parseInt(values[9]);
              rx_bytes = parseInt(values[1]);
              break;
          }
      }

      // Calculate network traffic speed in bytes per second
      const current_time = Date.now() / 1000; // Convert milliseconds to seconds
      const time_difference = current_time - this.prev_time;

      let tx_speed = ((tx_bytes - this.prev_tx_bytes) / time_difference);
      let rx_speed = ((rx_bytes - this.prev_rx_bytes) / time_difference);

      const units = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'];
      let unit_index = 0;

      while (tx_speed > 99 || rx_speed > 99) {
        tx_speed /= 1024;
        rx_speed /= 1024;
        unit_index += 1;
      }

      // Update labels with network traffic speed
      const rx_label = rx_speed.toFixed(0).toString().padStart(2, '0');
      const tx_label = tx_speed.toFixed(0).toString().padStart(2, '0');

      // Store current values for the next calculation
      this.prev_time = current_time;
      this.prev_tx_bytes = tx_bytes;
      this.prev_rx_bytes = rx_bytes;
      
      // return `NET${this.b_open}￬ ${rx_label} ${this.delimiter} ￪ ${tx_label} ${this.b_close}`;
      return `NET${this.b_open}￬ ${rx_label} ${this.delimiter} ￪ ${tx_label} ${this.b_close}${units[unit_index]}`;

    } catch (e) { console.error(e, `Failed to update network traffic speed.`); }
  }

  // Stop updates
  stop() {
    if (this._timeout) {
      GLib.source_remove(this._timeout);
    }
    this._timeout = undefined;
  }
}

// Register the RezMon class
GObject.registerClass({ GTypeName: 'RezMon' }, RezMon);

// Export the main extension class
export default class SystemMonitorExtension extends Extension{
  _indicator;

  // Enable the extension
  enable() {
    const settings = this.getSettings('org.gnome.shell.extensions.rezmon');
    this._indicator = new RezMon(settings);
    panel.addToStatusArea('RezMon', this._indicator);
  }

  // Disable the extension
  disable() {
    this._indicator.stop();
    this._indicator.destroy();
    this._indicator = undefined;
  }
}