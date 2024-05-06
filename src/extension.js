/*
 * 
 * 
 * Author: Azzlol
 * Description: Displays CPU(use percentage, average clock speed, temp), RAM(Used, Free),
 * NET(Download, Upload) usage on the top bar.
 * Version: 1.0
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
import GObject from 'gi://GObject';
import { panel } from 'resource:///org/gnome/shell/ui/main.js';


// Define the main class for the system monitor indicator
export class RezMon extends Button {

  // Initialize the indicator
  _init() {
    super._init(0, "System Monitor Indicator", false);

    
    this.box = new St.BoxLayout();

    // Create a layout box, initialize Labels and add to box, add box to 'this' actor
    this.cpu_label = new St.Label({ text: "-CPU-", y_align: Clutter.ActorAlign.CENTER, style: 'margin-right: 12px;' });
    this.ram_label = new St.Label({ text: "-RAM-", y_align: Clutter.ActorAlign.CENTER, style: 'margin-right: 12px;' });
    this.net_label = new St.Label({ text: "-NET-", y_align: Clutter.ActorAlign.CENTER, style: 'margin-right: 12px;' });
    this.box.add_child(this.cpu_label);
    this.box.add_child(this.ram_label);
    this.box.add_child(this.net_label);
    this.add_child(this.box);

    // Initialize previous CPU values
    this.prev_idle = 0;
    this.prev_total = 0;

    // Initialize previous values for network traffic speed calculation
    this.prev_time = Date.now() / 1000; // Convert milliseconds to seconds
    this.prev_tx_bytes = 0;
    this.prev_rx_bytes = 0;    

    // Updating metrics
    this._update_metrics();
    
  }

  // Function to update all metrics (CPU, RAM, NET)
  _update_metrics() {
    const priority = GLib.PRIORITY_DEFAULT_IDLE;
    const refresh_time = 1; // Time in seconds

    // Update individual metrics
    this._update_cpu();
    this._update_ram();
    this._update_net();

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

  // Function to update CPU usage
  _update_cpu() {
    try {
      const cpu_file = Gio.File.new_for_path('/proc/stat');
      const [, cpu_content] = cpu_file.load_contents(null);
      const cpu_text_decoder = new TextDecoder("utf-8");
      const cpu_content_str = cpu_text_decoder.decode(cpu_content);
      const cpu_content_lines = cpu_content_str.split('\n');

      let current_cpu_used = 0;
      let current_cpu_total = 0;
      let current_cpu_usage = 0;
      
      // CPU Usage -----------------------------------------------------------------------
      let cpu_usage = "";

      for (let i = 0; i < cpu_content_lines.length; i++) {
        const fields = cpu_content_lines[i].trim().split(/\s+/);

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
      const ghz_file = Gio.File.new_for_path('/proc/cpuinfo');
      const [, ghz_content] = ghz_file.load_contents(null);
      const ghz_text_decoder = new TextDecoder("utf-8");
      const ghz_content_str = ghz_text_decoder.decode(ghz_content);
      const ghz_content_lines = ghz_content_str.split('\n');

      let mhz_count = 0;
      let cpu_count = 0;

      for (let i = 0; i < ghz_content_lines.length; i++) {
        const fields = ghz_content_lines[i].trim().split(/\s+/);

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
      this.cpu_label.set_text(`CPU( ${cpu_usage} % | ${ghz_value.toFixed(2)} GHz | ${cpu_temp} ℃ )`);

    } catch (e) {
      logError(e, `Failed to update CPU usage.`);
    }
  }

  // Function to update Memory usage
  _update_ram() {
    try {
      const meminfo_file = Gio.File.new_for_path('/proc/meminfo');
      const [, contents] = meminfo_file.load_contents(null);
      const text_decoder = new TextDecoder("utf-8");
      const content_string = text_decoder.decode(contents);
      const content_lines = content_string.split('\n');

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

      // Update RAM usage label
      if (mem_total !== null && mem_available !== null) {
        mem_used = mem_total - mem_available;
      }
      
      mem_used = mem_used / (1024 * 1024);
      mem_available = mem_available / (1024 * 1024);

      this.ram_label.set_text(`RAM( ${mem_used.toFixed(1)} GB | ${mem_available.toFixed(1)} GB )`);
      
    } catch (e) {
      logError(e, `Failed to update memory usage.`);
    }
  }
  
  _update_net() {
    try {
        const netdev_file = Gio.File.new_for_path('/proc/net/dev');
        const [, contents] = netdev_file.load_contents(null);
        const text_decoder = new TextDecoder("utf-8");
        const content_string = text_decoder.decode(contents);
        const content_lines = content_string.split('\n');

        let interface_name = 'enp0s3'; // Change this to your desired network interface name
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
        const tx_speed = ((tx_bytes - this.prev_tx_bytes) / time_difference) / (1024 * 1024);
        const rx_speed = ((rx_bytes - this.prev_rx_bytes) / time_difference) / (1024 * 1024);

        // Update labels with network traffic speed
        this.net_label.set_text(`NET( ￬ ${rx_speed.toFixed(1)} MB/s | ￪ ${tx_speed.toFixed(1)} MB/s )`);

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
    panel.addToStatusArea('system-indicator', this._indicator);
  }

  // Disable the extension
  disable() {
    this._indicator.stop();
    this._indicator.destroy();
    this._indicator = undefined;
  }
}
