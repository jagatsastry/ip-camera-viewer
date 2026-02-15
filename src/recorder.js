const EventEmitter = require('events');
const ffmpeg = require('fluent-ffmpeg');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('../config.json');

class RecorderManager extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.status = 'idle'; // idle | recording | error
    this.currentUrl = null;
    this.currentFile = null;
    this.startTime = null;
    this.recordingsDir = path.resolve(__dirname, '..', config.recordingsDir);
  }

  _setStatus(status, error) {
    this.status = status;
    this.emit('status', {
      status,
      error: error || null,
      file: this.currentFile,
      url: this.currentUrl
    });
  }

  _generateFilename() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    return `recording_${date}_${time}.mp4`;
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

  startRecording(cameraUrl, options) {
    return new Promise((resolve, reject) => {
      if (this.process) {
        return reject(new Error('Recording already in progress. Stop the current recording first.'));
      }

      if (!cameraUrl) {
        return reject(new Error('Camera URL is required.'));
      }

      fs.mkdirSync(this.recordingsDir, { recursive: true });

      this.currentUrl = cameraUrl;
      this.currentFile = this._generateFilename();
      const outputPath = path.join(this.recordingsDir, this.currentFile);

      const audioUrl = (options && options.audioUrl) || this._deriveAudioUrl(cameraUrl);
      const includeAudio = !!(options && options.includeAudio !== false && audioUrl);

      if (includeAudio && audioUrl) {
        // Dual-input: video + denoised audio via raw ffmpeg spawn
        this._startDualInputRecording(cameraUrl, audioUrl, outputPath, resolve, reject);
      } else {
        // Single-input: video only via fluent-ffmpeg
        this._startVideoOnlyRecording(cameraUrl, outputPath, resolve, reject);
      }
    });
  }

  _startDualInputRecording(videoUrl, audioUrl, outputPath, resolve, reject) {
    try {
      const args = [
        '-i', videoUrl,
        '-i', audioUrl,
        '-af', 'afftdn=nf=-25,highpass=f=200,lowpass=f=3000',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        '-y', outputPath
      ];

      // Add RTSP options before each input if needed
      if (videoUrl.startsWith('rtsp://')) {
        args.unshift('-rtsp_transport', 'tcp', '-timeout', '5000000');
      }

      const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      this.process = proc;

      let started = false;
      let stderrBuf = '';

      proc.stderr.on('data', (data) => {
        stderrBuf += data.toString();
        // ffmpeg prints progress to stderr; detect that recording started
        if (!started && (stderrBuf.includes('Output #0') || stderrBuf.includes('Press [q]'))) {
          started = true;
          this.startTime = Date.now();
          this._setStatus('recording');
          resolve({
            status: 'recording',
            file: this.currentFile,
            url: this.currentUrl,
            audio: true
          });
        }
      });

      proc.on('error', (err) => {
        this.process = null;
        this.currentUrl = null;
        this.currentFile = null;
        this.startTime = null;
        this._setStatus('error', err.message);
        if (!started) {
          reject(new Error(`Failed to start recording: ${err.message}`));
        }
      });

      proc.on('close', (code) => {
        this.process = null;
        this.currentUrl = null;
        this.currentFile = null;
        this.startTime = null;
        this._setStatus('idle');
        if (!started) {
          reject(new Error(`ffmpeg exited with code ${code}: ${stderrBuf.slice(-200)}`));
        }
      });
    } catch (err) {
      this.process = null;
      this.currentUrl = null;
      this.currentFile = null;
      this.startTime = null;
      this._setStatus('error', err.message);
      reject(new Error(`Failed to start recording: ${err.message}`));
    }
  }

  _startVideoOnlyRecording(cameraUrl, outputPath, resolve, reject) {
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
          '-c:a', 'aac',
          '-movflags', '+faststart'
        ])
        .output(outputPath)
        .on('start', () => {
          this.startTime = Date.now();
          this._setStatus('recording');
          resolve({
            status: 'recording',
            file: this.currentFile,
            url: cameraUrl,
            audio: false
          });
        })
        .on('error', (err) => {
          const wasStarting = this.status !== 'recording';
          this.process = null;
          this.currentUrl = null;
          this.currentFile = null;
          this.startTime = null;
          this._setStatus('error', err.message);
          if (wasStarting) {
            reject(new Error(`Failed to start recording: ${err.message}`));
          }
        })
        .on('end', () => {
          this.process = null;
          this.currentUrl = null;
          this.currentFile = null;
          this.startTime = null;
          this._setStatus('idle');
        });

      this.process.run();
    } catch (err) {
      this.process = null;
      this.currentUrl = null;
      this.currentFile = null;
      this.startTime = null;
      this._setStatus('error', err.message);
      reject(new Error(`Failed to start recording: ${err.message}`));
    }
  }

  stopRecording() {
    return new Promise((resolve) => {
      if (!this.process) {
        return resolve({ status: 'idle', message: 'No recording in progress.' });
      }

      const file = this.currentFile;

      try {
        // Handle both fluent-ffmpeg (has .kill method) and spawn (ChildProcess)
        if (typeof this.process.kill === 'function') {
          this.process.kill('SIGTERM');
        }
      } catch (err) {
        // process may already be dead
      }

      this.process = null;
      this.currentUrl = null;
      this.currentFile = null;
      this.startTime = null;
      this._setStatus('idle');
      resolve({ status: 'idle', message: 'Recording stopped.', file });
    });
  }

  getRecordings() {
    try {
      fs.mkdirSync(this.recordingsDir, { recursive: true });
      const files = fs.readdirSync(this.recordingsDir);
      return files
        .filter((f) => f.endsWith('.mp4'))
        .map((f) => {
          const filePath = path.join(this.recordingsDir, f);
          const stat = fs.statSync(filePath);
          return {
            name: f,
            size: stat.size,
            sizeFormatted: `${(stat.size / (1024 * 1024)).toFixed(2)} MB`,
            date: stat.mtime.toISOString()
          };
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    } catch (err) {
      return [];
    }
  }

  deleteRecording(filename) {
    const filePath = path.join(this.recordingsDir, filename);

    // Prevent path traversal
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(this.recordingsDir))) {
      throw new Error('Invalid filename.');
    }

    if (!fs.existsSync(filePath)) {
      throw new Error('Recording not found.');
    }

    fs.unlinkSync(filePath);
    return { message: `Deleted ${filename}.` };
  }

  getStatus() {
    return {
      status: this.status,
      file: this.currentFile,
      url: this.currentUrl,
      duration: this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0
    };
  }
}

module.exports = RecorderManager;
