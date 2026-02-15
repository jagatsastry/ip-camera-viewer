const onvif = require('onvif');
const http = require('http');
const net = require('net');
const config = require('../config.json');
const fingerprints = require('./fingerprints');

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

  /**
   * Probe a subnet for IP cameras by checking common camera ports and HTTP endpoints.
   * Scans the /24 subnet of the given base IP (or the defaultCameraIp from config).
   * @param {string} baseIp - An IP on the subnet to scan (e.g. "192.168.86.44")
   * @param {number} timeoutMs - Per-host connection timeout (default 1500ms)
   */
  async probePorts(baseIp, timeoutMs = 1500) {
    const ip = baseIp || config.defaultCameraIp;
    if (!ip) return [];

    const subnet = ip.split('.').slice(0, 3).join('.');
    const httpPorts = config.commonHttpPorts || [80, 8080, 8081];
    const rtspPorts = config.commonRtspPorts || [554, 8554];
    const allPorts = [...httpPorts, ...rtspPorts];

    // Scan a focused range around the known IP, plus common device IPs
    const hostsToScan = new Set();
    const knownOctet = parseInt(ip.split('.')[3], 10);
    // Scan +/- 10 around the known IP plus common ranges
    for (let i = Math.max(1, knownOctet - 10); i <= Math.min(254, knownOctet + 10); i++) {
      hostsToScan.add(`${subnet}.${i}`);
    }
    // Also probe common router-assigned IPs
    for (const octet of [1, 2, 100, 101, 102, 150, 200]) {
      hostsToScan.add(`${subnet}.${octet}`);
    }

    const found = [];
    const scanPromises = [];

    for (const host of hostsToScan) {
      for (const port of allPorts) {
        scanPromises.push(
          this._probeHost(host, port, timeoutMs).then((result) => {
            if (result) found.push(result);
          })
        );
      }
    }

    await Promise.all(scanPromises);

    // Deduplicate by hostname
    const seen = new Set();
    const unique = [];
    for (const dev of found) {
      if (!seen.has(dev.hostname)) {
        seen.add(dev.hostname);
        unique.push(dev);
      }
    }

    return unique;
  }

  /**
   * Check if a host:port has an open TCP connection, then try to identify the camera.
   */
  _probeHost(host, port, timeoutMs) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let resolved = false;

      const done = (result) => {
        if (resolved) return;
        resolved = true;
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(timeoutMs);
      socket.on('timeout', () => done(null));
      socket.on('error', () => done(null));

      socket.connect(port, host, () => {
        // Port is open — try HTTP identification
        if (port === 554 || port === 8554) {
          // RTSP port open
          done({
            hostname: host,
            port,
            name: `Camera (${host})`,
            protocol: 'rtsp',
            source: 'probe',
          });
          return;
        }

        // Try HTTP GET to identify the camera
        this._identifyHttpCamera(host, port, timeoutMs)
          .then((info) => done(info))
          .catch(() => done({
            hostname: host,
            port,
            name: `Camera (${host})`,
            protocol: 'http',
            source: 'probe',
          }));
      });
    });
  }

  /**
   * Try to identify an HTTP camera by probing all known brand endpoints.
   * Returns the first match with brand identification.
   */
  async _identifyHttpCamera(host, port, timeoutMs) {
    const allPaths = fingerprints.getAllMjpegPaths();

    // Try all known MJPEG paths in parallel
    const results = await Promise.allSettled(
      allPaths.map((path) => this._tryHttpPath(host, port, path, timeoutMs))
    );

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'fulfilled' && results[i].value) {
        const matchedPath = allPaths[i];
        const match = fingerprints.identifyByPath(matchedPath);
        const brandName = match ? match.brand.name : 'Generic';
        const audioPaths = match ? match.brand.audioPaths : [];

        return {
          hostname: host,
          port,
          name: `${brandName} Camera (${host})`,
          brand: brandName,
          protocol: 'http',
          streamUrl: `http://${host}:${port}${matchedPath}`,
          audioUrl: audioPaths.length ? `http://${host}:${port}${audioPaths[0]}` : null,
          matchedPath,
          source: 'probe',
        };
      }
    }

    // No MJPEG path matched — still report the open port
    return {
      hostname: host,
      port,
      name: `Device (${host})`,
      protocol: 'http',
      source: 'probe',
    };
  }

  /**
   * Try a single HTTP path and resolve true if it looks like a camera stream.
   */
  _tryHttpPath(host, port, path, timeoutMs) {
    return new Promise((resolve, reject) => {
      const req = http.get({
        hostname: host,
        port,
        path,
        timeout: timeoutMs,
      }, (res) => {
        const contentType = res.headers['content-type'] || '';
        const statusCode = res.statusCode;
        res.destroy();

        if (statusCode >= 200 && statusCode < 400 &&
            (contentType.includes('multipart') ||
             contentType.includes('image/jpeg') ||
             contentType.includes('mjpeg') ||
             contentType.includes('video'))) {
          resolve(true);
        } else {
          resolve(false);
        }
      });

      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.on('error', () => reject(new Error('error')));
    });
  }

  /**
   * Run both ONVIF discovery and port-probe scanning in parallel.
   * Returns a combined, deduplicated list of discovered devices.
   */
  async discoverAll(options = {}) {
    const { timeout = 5000, baseIp, probeTimeout = 1500 } = options;

    const [onvifDevices, probedDevices] = await Promise.all([
      this.discover(timeout),
      this.probePorts(baseIp, probeTimeout),
    ]);

    // Merge: ONVIF results first, then probed devices not already found
    const seen = new Set();
    const merged = [];

    for (const dev of onvifDevices) {
      seen.add(dev.hostname);
      dev.source = 'onvif';
      merged.push(dev);
    }

    for (const dev of probedDevices) {
      if (!seen.has(dev.hostname)) {
        seen.add(dev.hostname);
        merged.push(dev);
      }
    }

    this._discoveredDevices = merged;
    return merged;
  }

  getLastDiscoveredDevices() {
    return this._discoveredDevices;
  }
}

module.exports = DiscoveryManager;
