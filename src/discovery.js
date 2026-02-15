const onvif = require('onvif');

class DiscoveryManager {
  constructor() {
    this._discoveredDevices = [];
  }

  /**
   * Probe the local network for ONVIF-compatible cameras.
   * Returns a promise that resolves with an array of discovered devices.
   * @param {number} timeoutMs - How long to wait for responses (default 5000ms)
   */
  discover(timeoutMs = 5000) {
    return new Promise((resolve) => {
      this._discoveredDevices = [];
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(this._discoveredDevices);
        }
      }, timeoutMs);

      onvif.Discovery.probe({ timeout: timeoutMs }, (err, devices) => {
        clearTimeout(timer);
        if (resolved) return;
        resolved = true;

        if (err || !devices) {
          resolve([]);
          return;
        }

        this._discoveredDevices = devices.map((device) => this._parseDevice(device));
        resolve(this._discoveredDevices);
      });
    });
  }

  /**
   * Get the RTSP stream URI from an ONVIF camera.
   * @param {string} hostname
   * @param {number} port
   * @param {string} username
   * @param {string} password
   */
  getStreamUri(hostname, port, username, password) {
    return new Promise((resolve, reject) => {
      const cam = new onvif.Cam({
        hostname,
        port: port || 80,
        username: username || '',
        password: password || '',
        timeout: 10000,
      }, (err) => {
        if (err) {
          return reject(new Error(`Failed to connect to ONVIF device: ${err.message}`));
        }

        cam.getStreamUri({ protocol: 'RTSP' }, (err, stream) => {
          if (err) {
            return reject(new Error(`Failed to get stream URI: ${err.message}`));
          }
          resolve({
            uri: stream.uri,
            hostname,
            port,
          });
        });
      });
    });
  }

  /**
   * Get device information (manufacturer, model, firmware, serial) from an ONVIF camera.
   */
  getDeviceInfo(hostname, port, username, password) {
    return new Promise((resolve, reject) => {
      const cam = new onvif.Cam({
        hostname,
        port: port || 80,
        username: username || '',
        password: password || '',
        timeout: 10000,
      }, (err) => {
        if (err) {
          return reject(new Error(`Failed to connect to ONVIF device: ${err.message}`));
        }

        cam.getDeviceInformation((err, info) => {
          if (err) {
            return reject(new Error(`Failed to get device info: ${err.message}`));
          }
          resolve({
            manufacturer: info.manufacturer || '',
            model: info.model || '',
            firmwareVersion: info.firmwareVersion || '',
            serialNumber: info.serialNumber || '',
            hostname,
            port,
          });
        });
      });
    });
  }

  _parseDevice(device) {
    const result = {
      name: '',
      hostname: '',
      port: 80,
      xaddrs: '',
    };

    // Extract address from probeMatches
    if (device.probeMatches && device.probeMatches.probeMatch) {
      const match = device.probeMatches.probeMatch;
      const xaddrs = match.XAddrs || match.xAddrs || '';
      result.xaddrs = xaddrs;

      // Parse hostname and port from XAddrs URL
      try {
        const url = new URL(xaddrs);
        result.hostname = url.hostname;
        result.port = parseInt(url.port, 10) || 80;
      } catch (_) {
        // Fall back to trying the hostname from the device
      }
    }

    // Some onvif library versions expose these directly
    if (device.hostname) result.hostname = device.hostname;
    if (device.port) result.port = device.port;

    // Use scopes for device name if available
    if (device.probeMatches && device.probeMatches.probeMatch) {
      const scopes = device.probeMatches.probeMatch.scopes;
      if (typeof scopes === 'string') {
        const nameMatch = scopes.match(/onvif:\/\/www\.onvif\.org\/name\/([^\s]+)/);
        if (nameMatch) result.name = decodeURIComponent(nameMatch[1]);
      }
    }

    if (!result.name) {
      result.name = result.hostname ? `ONVIF Camera (${result.hostname})` : 'ONVIF Camera';
    }

    return result;
  }

  getLastDiscoveredDevices() {
    return this._discoveredDevices;
  }
}

module.exports = DiscoveryManager;
