/*
 * 
 * 
 * Author: Azzlol
 * Description: Displays CPU(use percentage, average clock speed, temp), RAM(Used, Free),
 * NET(Download, Upload) usage on the top bar.
 * Version: 3
 * GNOME Shell Version: 46 (Tested) 
 * 
 * Credits: Michael Knap - System Monitor Tray Indicator - https://github.com/michaelknap/gnome-system-monitor-indicator
 * 
 * License: MIT License
 */

'use strict';

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { Button } from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { PopupMenuItem } from 'resource:///org/gnome/shell/ui/popupMenu.js';
import GObject from 'gi://GObject';
import { panel } from 'resource:///org/gnome/shell/ui/main.js';


// Define the main class for the system monitor indicator
export class RezMon extends Button {

  // Initialize the indicator
  _init() {
    super._init(0, "Resource Monitor", false);

    // Create a layout box, initialize Labels and add to box, add box to 'this' actor
    this.box = new St.BoxLayout();
    this.labels = []; // Array to store labels
    this.labels.push(new St.Label({ text: "-CPU-", y_align: Clutter.ActorAlign.CENTER, style: 'margin-right: 12px;' }));
    this.labels.push(new St.Label({ text: "-RAM-", y_align: Clutter.ActorAlign.CENTER, style: 'margin-right: 12px;' }));
    this.labels.push(new St.Label({ text: "-NET-", y_align: Clutter.ActorAlign.CENTER, style: 'margin-right: 12px;' }));
    this.labels.forEach(label => this.box.add_child(label)); // Add labels to the box
    this.add_child(this.box);

    //Pre Set Values ---------------------------------------------------------------------------------------------

    this.feature = ['CPU', 'RAM', 'NET'];
    this.feature_activations = [1, 1, 1];
    this.feature_file_location = ['/proc/stat', '/proc/meminfo', '/proc/net/dev'];

    // Initialize previous CPU values
    this.prev_idle = 0;
    this.prev_total = 0;

    // Initialize previous values for network traffic speed calculation
    this.prev_time = Date.now() / 1000; // Convert milliseconds to seconds
    this.prev_tx_bytes = 0;
    this.prev_rx_bytes = 0;    

    //Pre Set Values ---------------------------------------------------------------------------------------------

    // Updating metrics
    this._update_metrics();

    // Menu Stuff
    this._render_menu();
    
  }

  // Renders popup menu
  _render_menu(){
    log('Rendering Popup Menu');
    this.menu.removeAll();

    // Create menu items
    for (let i = 0; i < this.feature.length; i++) {
      let item = new PopupMenuItem(this.feature[i], {
        can_focus: true,
        hover: true,
        reactive: true,
      });
      
      item.connect('activate', () => {
        log("Click Event on Popup Menu: ", this.feature[i]);
        this.feature_activations[i] = !this.feature_activations[i]; // Toggle feature activation
        // Set visibility of labels based on feature activations
        this.labels.forEach((label, index) => {
          label.visible = this.feature_activations[index];
        });
      });
      this.menu.addMenuItem(item);
    }
  }


  // Function to update all metrics (CPU, RAM, NET)
  _update_metrics() {
    const priority = GLib.PRIORITY_DEFAULT_IDLE;
    const refresh_time = 1; // Time in seconds

    for(let i = 0; i < this.feature_activations.length; i++){
      if(this.feature_activations[i] == 1){
        switch(i) {
          case 0:
            this._update_cpu();
            break;

          case 1:
            this._update_ram();
            break;

          case 2:
            this._update_net();
            break;

          default:
            break;
        }
      }
    }
    

    // Remove existing timeout if any
    if (this._timeout) {
      GLib.source_remove(this._timeout);
    }

    // Set a timeout to refresh metrics
    this._timeout = GLib.timeout_add_seconds(priority, refresh_time, () => {
      this._update_metrics();
      return true;
    });
  }

  _file_open(file_path){
    try{
      // Get file name and return lines of the file as array
      const file = Gio.File.new_for_path(file_path);
      const [, content] = file.load_contents(null);
      const text_decoder = new TextDecoder("utf-8");
      const content_str = text_decoder.decode(content);
      const content_lines = content_str.split('\n');
      return content_lines;
    }
    catch (e){
      logError(e, `Could not process: `, file_path);
    }
  }

  // Function to update CPU usage
  _update_cpu() {
    try {
      let content_lines = this._file_open('/proc/stat');

      let current_cpu_used = 0;
      let current_cpu_total = 0;
      let current_cpu_usage = 0;
      
      // CPU Usage -----------------------------------------------------------------------
      let cpu_usage = "";

      for (let i = 0; i < content_lines.length; i++) {
        const fields = content_lines[i].trim().split(/\s+/);

        if (fields[0] === 'cpu') {
          const nums = fields.slice(1).map(Number);
          // const user = nums[0];
          // const nice = nums[1];
          // const system = nums[2];
          const idle = nums[3];
          const iowait = nums[4] || 0; // Include iowait, defaulting to 0 if not present

          current_cpu_total = nums.slice(0, 4).reduce((a, b) => a + b, 0) +
            iowait;
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


      // CPU GHz -----------------------------------------------------------------------
      content_lines = undefined;
      content_lines = this._file_open('/proc/cpuinfo');

      let mhz_count = 0;
      let cpu_count = 0;

      for (let i = 0; i < content_lines.length; i++) {
        const fields = content_lines[i].trim().split(/\s+/);

        // check if element 1 and 2 is 'cpu' and 'MHz' in field = "cpu MHz : 3000.000"
        if (fields[0] === 'cpu' && fields[1] === 'MHz') {
          mhz_count += parseInt(fields[3]);
          cpu_count += 1;
        }
      }

      // Average GHz of all core clocks
      let ghz_value = (mhz_count / cpu_count)/1000;


      // CPU Temp -----------------------------------------------------------------------
      let cpu_temp = 0;

      // CPU TEMP - Execute 'sensors' command to get CPU temperature
      let [success, stdout, stderr] = GLib.spawn_command_line_sync('sensors');
      if (success) {
        const output = stdout.toString();

        // Define a regular expression pattern to match the CPU temperature
        const pattern = /Tctl:\s+\+([\d.]+)°C/;
        const match = pattern.exec(output);
        
        cpu_temp = parseInt(match[1]);
      }

      // Set Label
      this.labels[0].set_text(`CPU( ${cpu_usage} % | ${ghz_value.toFixed(2)} GHz | ${cpu_temp} ℃ )`);

    } catch (e) {
      logError(e, `Failed to update CPU Label.`);
    }
  }

  // Function to update Memory usage
  _update_ram() {
    try {
      let content_lines = this._file_open('/proc/meminfo');

      let mem_total = null;
      let mem_available = null;
      let mem_used = null;

      content_lines.forEach((line) => {
        let [key, value] = line.split(':');
        if (value) {
          value = parseInt(value.trim(), 10);
        }

        switch (key) {
          case 'MemTotal':
            mem_total = value;
            break;
          case 'MemAvailable':
            mem_available = value;
            break;
        }
      });

      if (mem_total !== null && mem_available !== null) {
        mem_used = mem_total - mem_available;
      }
      
      mem_used = mem_used / (1024 * 1024);
      mem_available = mem_available / (1024 * 1024);

      this.labels[1].set_text(`RAM( ${mem_used.toFixed(1)} GB | ${mem_available.toFixed(1)} GB )`);
      
    } catch (e) {
      logError(e, `Failed to update memory usage.`);
    }
  }
  
  _update_net() {
    try {
      let activeInterfaceName = '';
      let [result, output, standardError, exitStatus] = GLib.spawn_command_line_sync('bash -c "ip route get 1 | awk \'{print $5; exit}\'"');
      if (result) {
          let textDecoder = new TextDecoder("utf-8");
          activeInterfaceName = textDecoder.decode(new Uint8Array(output)).trim();
      }
      let content_lines = this._file_open('/proc/net/dev');

      let interface_name = activeInterfaceName;
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
      // const tx_speed = ((tx_bytes - this.prev_tx_bytes) / time_difference) / (1024 * 1024);
      // const rx_speed = ((rx_bytes - this.prev_rx_bytes) / time_difference) / (1024 * 1024);

      let tx_speed = ((tx_bytes - this.prev_tx_bytes) / time_difference);
      let rx_speed = ((rx_bytes - this.prev_rx_bytes) / time_difference);

      const units = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'];
      let tx_unit_index = 0;
      let rx_unit_index = 0;

      while (tx_speed > 1024 || rx_speed > 1024) {
        if(tx_speed > 1024){
          tx_speed = tx_speed / 1024;
          tx_unit_index++;
        }
        if(rx_speed > 1024){
          rx_speed = rx_speed / 1024;
          rx_unit_index++;
        }
      }



      // Update labels with network traffic speed
      // this.labels[2].set_text(`NET( ￬ ${rx_speed.toFixed(1)} MB/s | ￪ ${tx_speed.toFixed(1)} MB/s )`);
      const rx_label = `${rx_speed.toFixed(0)} ${units[rx_unit_index]}`;
      const tx_label = `${tx_speed.toFixed(0)} ${units[tx_unit_index]}`;

      this.labels[2].set_text(`NET( ￬ ${rx_label} | ￪ ${tx_label} )`);

      // Store current values for the next calculation
      this.prev_time = current_time;
      this.prev_tx_bytes = tx_bytes;
      this.prev_rx_bytes = rx_bytes;
    } catch (e) {
        logError(e, `Failed to update network traffic speed.`);
    }
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
GObject.registerClass({
  GTypeName: 'RezMon'
}, RezMon);


// Export the main extension class
export default class SystemMonitorExtension {
  _indicator;

  // Enable the extension
  enable() {
    this._indicator = new RezMon();
    panel.addToStatusArea('RezMon', this._indicator);
  }

  // Disable the extension
  disable() {
    this._indicator.stop();
    this._indicator.destroy();
    this._indicator = undefined;
  }
}

