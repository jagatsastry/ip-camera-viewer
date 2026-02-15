// Mock fluent-ffmpeg before requiring the module
jest.mock('fluent-ffmpeg', () => {
  const factory = jest.fn(() => {
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
    return cmd;
  });

  // Store reference so tests can control behavior
  factory._lastCommand = null;
  const origFactory = factory;
  const wrappedFactory = jest.fn((...args) => {
    const cmd = origFactory(...args);
    wrappedFactory._lastCommand = cmd;
    return cmd;
  });
  wrappedFactory._lastCommand = null;

  return wrappedFactory;
});

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    mkdirSync: jest.fn(),
    readdirSync: jest.fn(() => []),
    unlinkSync: jest.fn()
  };
});

// Mock http for health check tests
jest.mock('http', () => {
  const actual = jest.requireActual('http');
  const EventEmitter = require('events');
  return {
    ...actual,
    get: jest.fn((opts, cb) => {
      const req = new EventEmitter();
      req.destroy = jest.fn();
      // By default, simulate a successful response
      process.nextTick(() => {
        const res = new EventEmitter();
        res.destroy = jest.fn();
        if (cb) cb(res);
      });
      return req;
    })
  };
});

const CameraManager = require('../src/camera');
const ffmpeg = require('fluent-ffmpeg');
const http = require('http');

describe('CameraManager', () => {
  let camera;

  beforeEach(() => {
    camera = new CameraManager();
    ffmpeg.mockClear();
    http.get.mockClear();
  });

  afterEach(() => {
    // Clean up any running health checks
    camera._stopHealthCheck();
  });

  describe('constructor', () => {
    it('should initialize with idle status', () => {
      expect(camera.status).toBe('idle');
      expect(camera.process).toBeNull();
      expect(camera.currentUrl).toBeNull();
    });

    it('should be an EventEmitter', () => {
      expect(typeof camera.on).toBe('function');
      expect(typeof camera.emit).toBe('function');
    });
  });

  describe('getStatus()', () => {
    it('should return idle status with no stream info when idle', () => {
      const status = camera.getStatus();
      expect(status).toEqual({
        status: 'idle',
        url: null,
        streamType: null,
        streamFile: null,
        audioUrl: null
      });
    });

    it('should return streaming status with HLS stream info when streaming RTSP', () => {
      camera.status = 'streaming';
      camera.currentUrl = 'rtsp://192.168.1.1:554/stream';
      camera.audioUrl = 'rtsp://192.168.1.1:554/audio.cgi';
      const status = camera.getStatus();
      expect(status).toEqual({
        status: 'streaming',
        url: 'rtsp://192.168.1.1:554/stream',
        streamType: 'hls',
        streamFile: '/stream/stream.m3u8',
        audioUrl: '/api/stream/audio'
      });
    });

    it('should return streamType "mjpeg" when streaming an MJPEG URL', () => {
      camera.status = 'streaming';
      camera.currentUrl = 'http://192.168.1.1/mjpeg/video.mjpg';
      camera.audioUrl = 'http://192.168.1.1/audio.cgi';
      const status = camera.getStatus();
      expect(status).toEqual({
        status: 'streaming',
        url: 'http://192.168.1.1/mjpeg/video.mjpg',
        streamType: 'mjpeg',
        streamFile: '/api/stream/mjpeg',
        audioUrl: '/api/stream/audio'
      });
    });

    it('should return streamType "mjpeg" for plain http:// URLs', () => {
      camera.status = 'streaming';
      camera.currentUrl = 'http://192.168.1.1:8080/video';
      camera.audioUrl = 'http://192.168.1.1:8080/audio.cgi';
      const status = camera.getStatus();
      expect(status).toEqual({
        status: 'streaming',
        url: 'http://192.168.1.1:8080/video',
        streamType: 'mjpeg',
        streamFile: '/api/stream/mjpeg',
        audioUrl: '/api/stream/audio'
      });
    });

    it('should return streamType null when not streaming', () => {
      camera.status = 'error';
      camera.currentUrl = 'rtsp://192.168.1.1:554/stream';
      const status = camera.getStatus();
      expect(status.streamType).toBeNull();
      expect(status.streamFile).toBeNull();
      expect(status.audioUrl).toBeNull();
    });
  });

  describe('_isMjpeg()', () => {
    it('should return truthy for URLs containing "mjpg"', () => {
      expect(camera._isMjpeg('http://192.168.1.1/video.mjpg')).toBeTruthy();
    });

    it('should return truthy for URLs containing "mjpeg"', () => {
      expect(camera._isMjpeg('http://192.168.1.1/mjpeg/stream')).toBeTruthy();
    });

    it('should return truthy for URLs containing "MJPEG" (case-insensitive)', () => {
      expect(camera._isMjpeg('http://192.168.1.1/MJPEG/video')).toBeTruthy();
    });

    it('should return truthy for any http:// URL', () => {
      expect(camera._isMjpeg('http://192.168.1.1:8080/video')).toBeTruthy();
    });

    it('should return falsy for rtsp:// URLs without mjpeg in path', () => {
      expect(camera._isMjpeg('rtsp://192.168.1.1:554/stream')).toBeFalsy();
    });

    it('should return falsy for rtmp:// URLs without mjpeg in path', () => {
      expect(camera._isMjpeg('rtmp://192.168.1.1/live')).toBeFalsy();
    });
  });

  describe('_deriveAudioUrl()', () => {
    it('should derive audio URL from HTTP video URL', () => {
      expect(camera._deriveAudioUrl('http://admin:pass@192.168.1.1/video/mjpg.cgi'))
        .toBe('http://admin:pass@192.168.1.1/audio.cgi');
    });

    it('should derive audio URL from RTSP video URL', () => {
      expect(camera._deriveAudioUrl('rtsp://admin:pass@192.168.1.1:554/stream'))
        .toBe('rtsp://admin:pass@192.168.1.1:554/audio.cgi');
    });

    it('should preserve auth credentials in audio URL', () => {
      const audioUrl = camera._deriveAudioUrl('http://user:secret@10.0.0.1/video/mjpg.cgi');
      expect(audioUrl).toContain('user:secret');
      expect(audioUrl).toContain('/audio.cgi');
    });

    it('should return null for invalid URLs', () => {
      expect(camera._deriveAudioUrl('not-a-url')).toBeNull();
    });
  });

  describe('startStream()', () => {
    it('should start ffmpeg and resolve with streaming status', async () => {
      const result = await camera.startStream('rtsp://192.168.1.1:554/stream');
      expect(result).toHaveProperty('status', 'streaming');
      expect(result).toHaveProperty('url', 'rtsp://192.168.1.1:554/stream');
      expect(camera.status).toBe('streaming');
      expect(camera.currentUrl).toBe('rtsp://192.168.1.1:554/stream');
      expect(camera.process).not.toBeNull();
    });

    it('should reject when camera URL is not provided', async () => {
      await expect(camera.startStream()).rejects.toThrow('Camera URL is required.');
    });

    it('should reject when camera URL is empty', async () => {
      await expect(camera.startStream('')).rejects.toThrow('Camera URL is required.');
    });

    it('should reject when stream is already running', async () => {
      await camera.startStream('rtsp://192.168.1.1:554/stream');
      await expect(camera.startStream('rtsp://192.168.1.2:554/stream'))
        .rejects.toThrow('Stream already running');
    });

    it('should emit status events', async () => {
      const statusHandler = jest.fn();
      camera.on('status', statusHandler);

      await camera.startStream('rtsp://192.168.1.1:554/stream');

      // Should have emitted 'connecting' then 'streaming'
      expect(statusHandler).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'connecting' })
      );
      expect(statusHandler).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'streaming' })
      );
    });

    it('should handle ffmpeg error during connection', async () => {
      // Override ffmpeg mock to trigger error instead of start
      ffmpeg.mockImplementationOnce(() => {
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
            if (this._listeners['error']) {
              process.nextTick(() => this._listeners['error'](new Error('Connection refused')));
            }
          }),
          kill: jest.fn()
        };
        return cmd;
      });

      const cam = new CameraManager();
      await expect(cam.startStream('rtsp://bad-host:554/stream'))
        .rejects.toThrow('Failed to connect to camera');
      expect(cam.status).toBe('error');
      expect(cam.process).toBeNull();
    });

    it('should start MJPEG stream without ffmpeg process', async () => {
      const result = await camera.startStream('http://192.168.1.1/mjpeg/video.mjpg');
      expect(result).toHaveProperty('status', 'streaming');
      expect(result).toHaveProperty('streamType', 'mjpeg');
      expect(result).toHaveProperty('streamUrl', '/api/stream/mjpeg');
      expect(result).toHaveProperty('audioUrl', '/api/stream/audio');
      expect(result).toHaveProperty('url', 'http://192.168.1.1/mjpeg/video.mjpg');
      expect(camera.status).toBe('streaming');
      expect(camera.currentUrl).toBe('http://192.168.1.1/mjpeg/video.mjpg');
      expect(camera.process).toBeNull();
      // ffmpeg should NOT have been called
      expect(ffmpeg).not.toHaveBeenCalled();
    });

    it('should start MJPEG stream for plain http:// URLs', async () => {
      const result = await camera.startStream('http://192.168.1.1:8080/video');
      expect(result).toHaveProperty('streamType', 'mjpeg');
      expect(camera.process).toBeNull();
    });

    it('should emit streaming status for MJPEG streams', async () => {
      const statusHandler = jest.fn();
      camera.on('status', statusHandler);

      await camera.startStream('http://192.168.1.1/mjpeg/video.mjpg');

      expect(statusHandler).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'streaming' })
      );
      // Should NOT have emitted 'connecting' for MJPEG
      expect(statusHandler).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'connecting' })
      );
    });
  });

  describe('stopStream()', () => {
    it('should return idle status when no stream is running', async () => {
      const result = await camera.stopStream();
      expect(result).toHaveProperty('status', 'idle');
      expect(result).toHaveProperty('message', 'No stream running.');
    });

    it('should stop a running stream and reset state', async () => {
      await camera.startStream('rtsp://192.168.1.1:554/stream');
      const result = await camera.stopStream();

      expect(result).toHaveProperty('status', 'idle');
      expect(result).toHaveProperty('message', 'Stream stopped.');
      expect(camera.process).toBeNull();
      expect(camera.currentUrl).toBeNull();
      expect(camera.status).toBe('idle');
    });

    it('should call kill on the ffmpeg process', async () => {
      await camera.startStream('rtsp://192.168.1.1:554/stream');
      const proc = camera.process;
      await camera.stopStream();
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should stop MJPEG stream without killing a process', async () => {
      await camera.startStream('http://192.168.1.1/mjpeg/video.mjpg');
      expect(camera.status).toBe('streaming');
      expect(camera.process).toBeNull();

      const result = await camera.stopStream();
      expect(result).toHaveProperty('status', 'idle');
      expect(result).toHaveProperty('message', 'Stream stopped.');
      expect(camera.currentUrl).toBeNull();
      expect(camera.status).toBe('idle');
    });

    it('should emit idle status when stopping MJPEG stream', async () => {
      await camera.startStream('http://192.168.1.1/mjpeg/video.mjpg');
      const statusHandler = jest.fn();
      camera.on('status', statusHandler);

      await camera.stopStream();

      expect(statusHandler).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'idle' })
      );
    });
  });

  describe('health check', () => {
    it('should start health check interval when MJPEG stream starts', async () => {
      await camera.startStream('http://192.168.1.1/mjpeg/video.mjpg');
      expect(camera._healthCheckInterval).not.toBeNull();
    });

    it('should start health check interval when HLS stream starts', async () => {
      await camera.startStream('rtsp://192.168.1.1:554/stream');
      expect(camera._healthCheckInterval).not.toBeNull();
    });

    it('should stop health check when stream is stopped', async () => {
      await camera.startStream('http://192.168.1.1/mjpeg/video.mjpg');
      expect(camera._healthCheckInterval).not.toBeNull();
      await camera.stopStream();
      expect(camera._healthCheckInterval).toBeNull();
    });

    it('should not have health check when idle', () => {
      expect(camera._healthCheckInterval).toBeNull();
    });

    it('should reset to idle when camera is unreachable', async () => {
      await camera.startStream('http://192.168.1.1/mjpeg/video.mjpg');
      expect(camera.status).toBe('streaming');

      const healthHandler = jest.fn();
      camera.on('healthcheck', healthHandler);

      camera._handleUnreachable('Connection refused');

      expect(camera.status).toBe('idle');
      expect(camera.currentUrl).toBeNull();
      expect(camera.audioUrl).toBeNull();
      expect(camera._healthCheckInterval).toBeNull();
      expect(healthHandler).toHaveBeenCalledWith({
        reachable: false,
        reason: 'Connection refused'
      });
    });

    it('should emit status idle event when camera becomes unreachable', async () => {
      await camera.startStream('http://192.168.1.1/mjpeg/video.mjpg');
      const statusHandler = jest.fn();
      camera.on('status', statusHandler);

      camera._handleUnreachable('timeout');

      expect(statusHandler).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'idle' })
      );
    });

    it('should not reset if already idle when _handleUnreachable is called', () => {
      const statusHandler = jest.fn();
      camera.on('status', statusHandler);

      camera._handleUnreachable('some error');

      // Should not emit anything since status was already idle
      expect(statusHandler).not.toHaveBeenCalled();
    });

    it('should make HTTP request to camera URL during health check', async () => {
      await camera.startStream('http://admin:pass@192.168.1.1/video/mjpg.cgi');
      http.get.mockClear();

      camera._checkCameraReachable();

      expect(http.get).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: '192.168.1.1',
          path: '/video/mjpg.cgi',
          auth: 'admin:pass',
          timeout: 5000
        }),
        expect.any(Function)
      );
    });

    it('should not make HTTP request if not streaming', () => {
      camera._checkCameraReachable();
      expect(http.get).not.toHaveBeenCalled();
    });

    it('should reset to idle on HTTP timeout', async () => {
      const EventEmitter = require('events');

      await camera.startStream('http://192.168.1.1/mjpeg/video.mjpg');
      http.get.mockClear();

      let capturedReq;
      http.get.mockImplementationOnce((opts, cb) => {
        capturedReq = new EventEmitter();
        capturedReq.destroy = jest.fn();
        return capturedReq;
      });

      camera._checkCameraReachable();

      // Simulate timeout
      capturedReq.emit('timeout');

      expect(camera.status).toBe('idle');
      expect(capturedReq.destroy).toHaveBeenCalled();
    });

    it('should reset to idle on HTTP error', async () => {
      const EventEmitter = require('events');

      await camera.startStream('http://192.168.1.1/mjpeg/video.mjpg');
      http.get.mockClear();

      let capturedReq;
      http.get.mockImplementationOnce((opts, cb) => {
        capturedReq = new EventEmitter();
        capturedReq.destroy = jest.fn();
        return capturedReq;
      });

      camera._checkCameraReachable();

      // Now the error listener is attached by _checkCameraReachable
      capturedReq.emit('error', new Error('ECONNREFUSED'));

      expect(camera.status).toBe('idle');
      expect(camera.currentUrl).toBeNull();
    });

    it('should kill ffmpeg process when camera becomes unreachable during HLS', async () => {
      await camera.startStream('rtsp://192.168.1.1:554/stream');
      const proc = camera.process;

      camera._handleUnreachable('timeout');

      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(camera.process).toBeNull();
    });
  });
});
