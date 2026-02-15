// Mock fluent-ffmpeg before requiring the module
jest.mock('fluent-ffmpeg', () => {
  const factory = jest.fn((...args) => {
    const cmd = {
      _listeners: {},
      inputOptions: jest.fn().mockReturnThis(),
      outputOptions: jest.fn().mockReturnThis(),
      output: jest.fn().mockReturnThis(),
      on: jest.fn(function (event, cb) {
        this._listeners[event] = cb;
        return this;
      }),
      run: jest.fn(function () {
        if (this._listeners['start']) {
          process.nextTick(() => this._listeners['start']('ffmpeg -i ...'));
        }
      }),
      kill: jest.fn()
    };
    factory._lastCommand = cmd;
    return cmd;
  });
  factory._lastCommand = null;
  return factory;
});

// Mock child_process.spawn for dual-input audio recording
jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  const EventEmitter = require('events');
  const { Readable, Writable } = require('stream');

  return {
    ...actual,
    spawn: jest.fn(() => {
      const proc = new EventEmitter();
      proc.stdout = new Readable({ read() {} });
      proc.stderr = new Readable({ read() {} });
      proc.stdin = new Writable({ write(c, e, cb) { cb(); } });
      proc.kill = jest.fn();
      // Simulate ffmpeg starting
      process.nextTick(() => {
        proc.stderr.push('Output #0, mp4\nPress [q] to quit\n');
      });
      return proc;
    })
  };
});

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    mkdirSync: jest.fn(),
    readdirSync: jest.fn(() => []),
    unlinkSync: jest.fn(),
    statSync: jest.fn(() => ({
      size: 5242880,
      mtime: new Date('2026-01-15T10:30:00Z')
    })),
    existsSync: jest.fn(() => true)
  };
});

const RecorderManager = require('../src/recorder');
const fs = require('fs');

describe('RecorderManager', () => {
  let recorder;

  beforeEach(() => {
    recorder = new RecorderManager();
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with idle status', () => {
      expect(recorder.status).toBe('idle');
      expect(recorder.process).toBeNull();
      expect(recorder.currentUrl).toBeNull();
      expect(recorder.currentFile).toBeNull();
      expect(recorder.startTime).toBeNull();
    });

    it('should be an EventEmitter', () => {
      expect(typeof recorder.on).toBe('function');
      expect(typeof recorder.emit).toBe('function');
    });
  });

  describe('getStatus()', () => {
    it('should return idle status when not recording', () => {
      const status = recorder.getStatus();
      expect(status).toEqual({
        status: 'idle',
        file: null,
        url: null,
        duration: 0
      });
    });

    it('should return recording status with duration when recording', () => {
      recorder.status = 'recording';
      recorder.currentFile = 'recording_2026-01-15_10-30-00.mp4';
      recorder.currentUrl = 'rtsp://192.168.1.1:554/stream';
      recorder.startTime = Date.now() - 5000; // 5 seconds ago

      const status = recorder.getStatus();
      expect(status.status).toBe('recording');
      expect(status.file).toBe('recording_2026-01-15_10-30-00.mp4');
      expect(status.url).toBe('rtsp://192.168.1.1:554/stream');
      expect(status.duration).toBeGreaterThanOrEqual(4);
      expect(status.duration).toBeLessThanOrEqual(6);
    });
  });

  describe('startRecording()', () => {
    it('should start recording and resolve with recording info', async () => {
      const result = await recorder.startRecording('rtsp://192.168.1.1:554/stream');
      expect(result).toHaveProperty('status', 'recording');
      expect(result).toHaveProperty('file');
      expect(result.file).toMatch(/^recording_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.mp4$/);
      expect(result).toHaveProperty('url', 'rtsp://192.168.1.1:554/stream');
      expect(recorder.process).not.toBeNull();
      expect(recorder.startTime).not.toBeNull();
    });

    it('should reject when cameraUrl is not provided', async () => {
      await expect(recorder.startRecording()).rejects.toThrow('Camera URL is required.');
    });

    it('should reject when cameraUrl is empty', async () => {
      await expect(recorder.startRecording('')).rejects.toThrow('Camera URL is required.');
    });

    it('should reject when recording is already in progress', async () => {
      await recorder.startRecording('rtsp://192.168.1.1:554/stream');
      await expect(recorder.startRecording('rtsp://192.168.1.2:554/stream'))
        .rejects.toThrow('Recording already in progress');
    });

    it('should emit status events', async () => {
      const statusHandler = jest.fn();
      recorder.on('status', statusHandler);

      await recorder.startRecording('rtsp://192.168.1.1:554/stream');

      expect(statusHandler).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'recording' })
      );
    });

    it('should create the recordings directory', async () => {
      await recorder.startRecording('rtsp://192.168.1.1:554/stream');
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        { recursive: true }
      );
    });
  });

  describe('_generateFilename()', () => {
    it('should generate a filename with the expected pattern', () => {
      const filename = recorder._generateFilename();
      expect(filename).toMatch(/^recording_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.mp4$/);
    });

    it('should include the current date', () => {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const expectedDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const filename = recorder._generateFilename();
      expect(filename).toContain(expectedDate);
    });
  });

  describe('stopRecording()', () => {
    it('should return idle status when no recording is in progress', async () => {
      const result = await recorder.stopRecording();
      expect(result).toHaveProperty('status', 'idle');
      expect(result).toHaveProperty('message', 'No recording in progress.');
    });

    it('should stop a running recording and reset state', async () => {
      await recorder.startRecording('rtsp://192.168.1.1:554/stream');
      const result = await recorder.stopRecording();

      expect(result).toHaveProperty('status', 'idle');
      expect(result).toHaveProperty('message', 'Recording stopped.');
      expect(result).toHaveProperty('file');
      expect(recorder.process).toBeNull();
      expect(recorder.currentUrl).toBeNull();
      expect(recorder.currentFile).toBeNull();
      expect(recorder.startTime).toBeNull();
    });

    it('should call kill on the ffmpeg process', async () => {
      await recorder.startRecording('rtsp://192.168.1.1:554/stream');
      const proc = recorder.process;
      await recorder.stopRecording();
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  describe('_deriveAudioUrl()', () => {
    it('should derive audio URL from HTTP video URL', () => {
      expect(recorder._deriveAudioUrl('http://admin:pass@192.168.1.1/video/mjpg.cgi'))
        .toBe('http://admin:pass@192.168.1.1/audio.cgi');
    });

    it('should derive audio URL from RTSP video URL', () => {
      expect(recorder._deriveAudioUrl('rtsp://admin:pass@192.168.1.1:554/stream'))
        .toBe('rtsp://admin:pass@192.168.1.1:554/audio.cgi');
    });

    it('should preserve auth credentials', () => {
      const audioUrl = recorder._deriveAudioUrl('http://user:secret@10.0.0.1/video/mjpg.cgi');
      expect(audioUrl).toContain('user:secret');
      expect(audioUrl).toContain('/audio.cgi');
    });

    it('should return null for invalid URLs', () => {
      expect(recorder._deriveAudioUrl('not-a-url')).toBeNull();
    });
  });

  describe('dual-input recording (with audio)', () => {
    it('should start recording with audio when includeAudio option is set', async () => {
      const result = await recorder.startRecording(
        'http://admin:pass@192.168.1.1/video/mjpg.cgi',
        { includeAudio: true }
      );
      expect(result).toHaveProperty('status', 'recording');
      expect(result).toHaveProperty('audio', true);
      expect(result).toHaveProperty('file');
      expect(result.file).toMatch(/^recording_.*\.mp4$/);
    });

    it('should use spawn for dual-input recording', async () => {
      const { spawn } = require('child_process');
      spawn.mockClear();

      await recorder.startRecording(
        'http://admin:pass@192.168.1.1/video/mjpg.cgi',
        { includeAudio: true }
      );

      expect(spawn).toHaveBeenCalledWith(
        'ffmpeg',
        expect.arrayContaining([
          '-i', 'http://admin:pass@192.168.1.1/video/mjpg.cgi',
          '-i', 'http://admin:pass@192.168.1.1/audio.cgi',
          '-af', 'afftdn=nf=-25,highpass=f=200,lowpass=f=3000',
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-b:a', '128k'
        ]),
        expect.any(Object)
      );
    });

    it('should record without audio when includeAudio is false', async () => {
      const result = await recorder.startRecording(
        'http://admin:pass@192.168.1.1/video/mjpg.cgi',
        { includeAudio: false }
      );
      expect(result).toHaveProperty('status', 'recording');
      expect(result).toHaveProperty('audio', false);
    });

    it('should emit recording status for dual-input', async () => {
      const statusHandler = jest.fn();
      recorder.on('status', statusHandler);

      await recorder.startRecording(
        'http://admin:pass@192.168.1.1/video/mjpg.cgi',
        { includeAudio: true }
      );

      expect(statusHandler).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'recording' })
      );
    });

    it('should stop dual-input recording and reset state', async () => {
      await recorder.startRecording(
        'http://admin:pass@192.168.1.1/video/mjpg.cgi',
        { includeAudio: true }
      );
      expect(recorder.process).not.toBeNull();

      const proc = recorder.process;
      const result = await recorder.stopRecording();

      expect(result).toHaveProperty('status', 'idle');
      expect(result).toHaveProperty('message', 'Recording stopped.');
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(recorder.process).toBeNull();
    });

    it('should use custom audioUrl from options if provided', async () => {
      const { spawn } = require('child_process');
      spawn.mockClear();

      await recorder.startRecording(
        'http://admin:pass@192.168.1.1/video/mjpg.cgi',
        { audioUrl: 'http://192.168.1.1/custom_audio' }
      );

      const spawnArgs = spawn.mock.calls[0][1];
      // Should use the custom audio URL as second -i
      const secondInputIdx = spawnArgs.indexOf('-i', spawnArgs.indexOf('-i') + 2);
      expect(spawnArgs[secondInputIdx + 1]).toBe('http://192.168.1.1/custom_audio');
    });
  });

  describe('getRecordings()', () => {
    it('should return an empty array when no recordings exist', () => {
      fs.readdirSync.mockReturnValueOnce([]);
      const recordings = recorder.getRecordings();
      expect(Array.isArray(recordings)).toBe(true);
      expect(recordings).toHaveLength(0);
    });

    it('should return formatted recording entries for mp4 files', () => {
      fs.readdirSync.mockReturnValueOnce([
        'recording_2026-01-15_10-30-00.mp4',
        'recording_2026-01-14_09-00-00.mp4',
        'other_file.txt'
      ]);

      const recordings = recorder.getRecordings();
      expect(recordings).toHaveLength(2);
      expect(recordings[0]).toHaveProperty('name');
      expect(recordings[0]).toHaveProperty('size');
      expect(recordings[0]).toHaveProperty('sizeFormatted');
      expect(recordings[0]).toHaveProperty('date');
      expect(recordings[0].name).toMatch(/\.mp4$/);
    });

    it('should filter out non-mp4 files', () => {
      fs.readdirSync.mockReturnValueOnce([
        'notes.txt',
        'config.json',
        'recording.mp4'
      ]);

      const recordings = recorder.getRecordings();
      expect(recordings).toHaveLength(1);
      expect(recordings[0].name).toBe('recording.mp4');
    });

    it('should handle errors gracefully and return empty array', () => {
      fs.readdirSync.mockImplementationOnce(() => {
        throw new Error('Permission denied');
      });

      const recordings = recorder.getRecordings();
      expect(Array.isArray(recordings)).toBe(true);
      expect(recordings).toHaveLength(0);
    });
  });
});
