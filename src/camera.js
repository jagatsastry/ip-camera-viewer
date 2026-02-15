const EventEmitter = require('events');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const config = require('../config.json');

class CameraManager extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.status = 'idle'; // idle | connecting | streaming | error
    this.currentUrl = null;
    this.audioUrl = null;
    this.streamDir = path.resolve(__dirname, '..', config.streamDir);
    this._healthCheckInterval = null;
    this._healthCheckMs = 15000; // check every 15 seconds
  }

  _setStatus(status, error) {
    this.status = status;
    this.emit('status', { status, error: error || null, url: this.currentUrl });
  }

  _cleanStreamDir() {
    try {
      const files = fs.readdirSync(this.streamDir);
      for (const file of files) {
        if (file.endsWith('.ts') || file.endsWith('.m3u8')) {
          fs.unlinkSync(path.join(this.streamDir, file));
        }
      }
    } catch (err) {
      // stream dir may not exist yet
    }
  }

  _isMjpeg(url) {
    return url.match(/mjpg|mjpeg/i) || url.startsWith('http://');
  }

  _deriveAudioUrl(videoUrl) {
    try {
      const parsed = new URL(videoUrl);
      parsed.pathname = '/audio.cgi';
      return parsed.toString();
    } catch (e) {
      return null;
    }
  }

  _startHealthCheck() {
    this._stopHealthCheck();
    this._healthCheckInterval = setInterval(() => {
      this._checkCameraReachable();
    }, this._healthCheckMs);
    // Don't prevent Node from exiting
    if (this._healthCheckInterval.unref) {
      this._healthCheckInterval.unref();
    }
  }

  _stopHealthCheck() {
    if (this._healthCheckInterval) {
      clearInterval(this._healthCheckInterval);
      this._healthCheckInterval = null;
    }
  }

  _checkCameraReachable() {
    if (this.status !== 'streaming' || !this.currentUrl) {
      return;
    }

    try {
      const parsed = new URL(this.currentUrl);
      const client = parsed.protocol === 'https:' ? https : http;

      const req = client.get({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        auth: parsed.username ? `${parsed.username}:${parsed.password}` : undefined,
        timeout: 5000,
      }, (res) => {
        // Got a response — camera is reachable. Abort since we don't need the data.
        res.destroy();
        req.destroy();
      });

      req.on('timeout', () => {
        req.destroy();
        this._handleUnreachable('Health check timed out');
      });

      req.on('error', (err) => {
        this._handleUnreachable(err.message);
      });
    } catch (err) {
      // URL parsing failed — shouldn't happen but handle gracefully
    }
  }

  _handleUnreachable(reason) {
    if (this.status !== 'streaming') return;
    console.warn(`[HealthCheck] Camera unreachable: ${reason}. Resetting to idle.`);
    if (this.process) {
      try { this.process.kill('SIGTERM'); } catch (_) {}
    }
    this.process = null;
    this.currentUrl = null;
    this.audioUrl = null;
    this._stopHealthCheck();
    this._setStatus('idle');
    this.emit('healthcheck', { reachable: false, reason });
  }

  startStream(cameraUrl) {
    return new Promise((resolve, reject) => {
      if (this.status === 'streaming') {
        return reject(new Error('Stream already running. Stop the current stream first.'));
      }

      if (!cameraUrl) {
        return reject(new Error('Camera URL is required.'));
      }

      this.currentUrl = cameraUrl;
      this.audioUrl = this._deriveAudioUrl(cameraUrl);

      // For MJPEG HTTP streams, no ffmpeg needed - proxy handles it
      if (this._isMjpeg(cameraUrl)) {
        this.process = null;
        this._setStatus('streaming');
        this._startHealthCheck();
        return resolve({
          status: 'streaming',
          url: cameraUrl,
          streamType: 'mjpeg',
          streamUrl: '/api/stream/mjpeg',
          audioUrl: this.audioUrl ? '/api/stream/audio' : null
        });
      }

      // For RTSP/other streams, use ffmpeg to transcode to HLS
      this._cleanStreamDir();
      fs.mkdirSync(this.streamDir, { recursive: true });
      this._setStatus('connecting');

      const outputPath = path.join(this.streamDir, 'stream.m3u8');

      try {
        const inputOpts = [];
        if (cameraUrl.startsWith('rtsp://')) {
          inputOpts.push('-rtsp_transport', 'tcp', '-timeout', '5000000');
        }

        this.process = ffmpeg(cameraUrl)
          .inputOptions(inputOpts)
          .outputOptions([
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-tune', 'zerolatency',
            '-c:a', 'aac',
            '-f', 'hls',
            '-hls_time', String(config.hlsSegmentDuration),
            '-hls_list_size', String(config.hlsListSize),
            '-hls_flags', 'delete_segments+append_list',
            '-hls_segment_filename', path.join(this.streamDir, 'segment_%03d.ts')
          ])
          .output(outputPath)
          .on('start', (cmd) => {
            this._setStatus('streaming');
            this._startHealthCheck();
            resolve({ status: 'streaming', url: cameraUrl, streamType: 'hls', streamUrl: '/stream/stream.m3u8' });
          })
          .on('error', (err) => {
            const wasConnecting = this.status === 'connecting';
            this.process = null;
            this.currentUrl = null;
            this.audioUrl = null;
            this._stopHealthCheck();
            this._setStatus('error', err.message);
            if (wasConnecting) {
              reject(new Error(`Failed to connect to camera: ${err.message}`));
            }
          })
          .on('end', () => {
            this.process = null;
            this.currentUrl = null;
            this.audioUrl = null;
            this._stopHealthCheck();
            this._setStatus('idle');
          });

        this.process.run();
      } catch (err) {
        this.process = null;
        this.currentUrl = null;
        this.audioUrl = null;
        this._setStatus('error', err.message);
        reject(new Error(`Failed to start stream: ${err.message}`));
      }
    });
  }

  stopStream() {
    return new Promise((resolve) => {
      if (this.status !== 'streaming' && !this.process) {
        return resolve({ status: 'idle', message: 'No stream running.' });
      }

      if (this.process) {
        try {
          this.process.kill('SIGTERM');
        } catch (err) {
          // process may already be dead
        }
      }

      this.process = null;
      this.currentUrl = null;
      this.audioUrl = null;
      this._stopHealthCheck();
      this._setStatus('idle');
      resolve({ status: 'idle', message: 'Stream stopped.' });
    });
  }

  getStatus() {
    const isMjpeg = this.currentUrl && this._isMjpeg(this.currentUrl);
    return {
      status: this.status,
      url: this.currentUrl,
      streamType: this.status === 'streaming' ? (isMjpeg ? 'mjpeg' : 'hls') : null,
      streamFile: this.status === 'streaming' ? (isMjpeg ? '/api/stream/mjpeg' : '/stream/stream.m3u8') : null,
      audioUrl: this.status === 'streaming' && this.audioUrl ? '/api/stream/audio' : null
    };
  }
}

module.exports = CameraManager;
