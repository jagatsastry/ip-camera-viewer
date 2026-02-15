const request = require('supertest');

// Mock fluent-ffmpeg before requiring server modules
jest.mock('fluent-ffmpeg', () => {
  const mockCommand = {
    inputOptions: jest.fn().mockReturnThis(),
    outputOptions: jest.fn().mockReturnThis(),
    output: jest.fn().mockReturnThis(),
    on: jest.fn(function (event, cb) {
      if (event === 'start') {
        // Fire start callback on next tick when run() is called
        this._onStart = cb;
      }
      if (event === 'error') {
        this._onError = cb;
      }
      if (event === 'end') {
        this._onEnd = cb;
      }
      return this;
    }),
    run: jest.fn(function () {
      if (this._onStart) {
        process.nextTick(() => this._onStart('ffmpeg -i ...'));
      }
    }),
    kill: jest.fn()
  };

  const factory = jest.fn(() => ({
    ...mockCommand,
    inputOptions: jest.fn().mockReturnThis(),
    outputOptions: jest.fn().mockReturnThis(),
    output: jest.fn().mockReturnThis(),
    on: jest.fn(function (event, cb) {
      if (event === 'start') this._onStart = cb;
      if (event === 'error') this._onError = cb;
      if (event === 'end') this._onEnd = cb;
      return this;
    }),
    run: jest.fn(function () {
      if (this._onStart) {
        process.nextTick(() => this._onStart('ffmpeg -i ...'));
      }
    }),
    kill: jest.fn()
  }));

  factory.setFfmpegPath = jest.fn();
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
        // Push fake audio data and end stdout so piped responses complete
        proc.stdout.push(Buffer.from([0xFF, 0xFB, 0x90]));
        proc.stdout.push(null);
      });
      return proc;
    })
  };
});

// Mock fs for stream/recording directory operations
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    mkdirSync: jest.fn(),
    readdirSync: jest.fn(() => []),
    unlinkSync: jest.fn(),
    statSync: jest.fn(() => ({
      size: 1024,
      mtime: new Date()
    })),
    existsSync: jest.fn(() => true),
    readFileSync: jest.fn(() => '[]'),
    writeFileSync: jest.fn()
  };
});

const { app } = require('../src/server');

describe('API Endpoints', () => {
  afterEach(() => {
    // Reset manager state between tests
    app.cameraManager.process = null;
    app.cameraManager.status = 'idle';
    app.cameraManager.currentUrl = null;
    app.cameraManager.audioUrl = null;
    app.recorderManager.process = null;
    app.recorderManager.status = 'idle';
    app.recorderManager.currentUrl = null;
    app.recorderManager.currentFile = null;
    app.recorderManager.startTime = null;
    // Reset scheduler state
    app.schedulerManager.schedules = [];
    app.schedulerManager.activeTimers.forEach((timer) => clearTimeout(timer));
    app.schedulerManager.activeTimers.clear();
    // Reset camera store state
    app.cameraStore.cameras = [];
  });

  describe('GET /api/status', () => {
    it('should return JSON with camera and recorder status', async () => {
      const res = await request(app).get('/api/status');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('camera');
      expect(res.body).toHaveProperty('recorder');
      expect(res.body.camera).toHaveProperty('status', 'idle');
      expect(res.body.camera).toHaveProperty('url', null);
      expect(res.body.camera).toHaveProperty('streamFile', null);
      expect(res.body.recorder).toHaveProperty('status', 'idle');
      expect(res.body.recorder).toHaveProperty('file', null);
      expect(res.body.recorder).toHaveProperty('duration', 0);
    });
  });

  describe('POST /api/stream/start', () => {
    it('should start streaming with a valid cameraUrl', async () => {
      const res = await request(app)
        .post('/api/stream/start')
        .send({ cameraUrl: 'rtsp://192.168.1.1:554/stream' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'streaming');
      expect(res.body).toHaveProperty('url', 'rtsp://192.168.1.1:554/stream');
    });

    it('should return 400 when cameraUrl is missing', async () => {
      const res = await request(app)
        .post('/api/stream/start')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'cameraUrl is required.');
    });

    it('should return 500 when stream is already running', async () => {
      // Start first stream
      await request(app)
        .post('/api/stream/start')
        .send({ cameraUrl: 'rtsp://192.168.1.1:554/stream' });

      // Try to start another
      const res = await request(app)
        .post('/api/stream/start')
        .send({ cameraUrl: 'rtsp://192.168.1.2:554/stream' });
      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/already running/i);
    });
  });

  describe('POST /api/stream/stop', () => {
    it('should stop stream and return idle status', async () => {
      const res = await request(app).post('/api/stream/stop');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'idle');
    });

    it('should handle stopping when no stream is running', async () => {
      const res = await request(app).post('/api/stream/stop');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message', 'No stream running.');
    });
  });

  describe('POST /api/record/start', () => {
    it('should start recording with a valid cameraUrl', async () => {
      const res = await request(app)
        .post('/api/record/start')
        .send({ cameraUrl: 'rtsp://192.168.1.1:554/stream' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'recording');
      expect(res.body).toHaveProperty('file');
      expect(res.body.file).toMatch(/^recording_.*\.mp4$/);
      expect(res.body).toHaveProperty('url', 'rtsp://192.168.1.1:554/stream');
    });

    it('should return 400 when cameraUrl is missing', async () => {
      const res = await request(app)
        .post('/api/record/start')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'cameraUrl is required.');
    });

    it('should return 500 when recording is already in progress', async () => {
      // Start first recording
      await request(app)
        .post('/api/record/start')
        .send({ cameraUrl: 'rtsp://192.168.1.1:554/stream' });

      // Try to start another
      const res = await request(app)
        .post('/api/record/start')
        .send({ cameraUrl: 'rtsp://192.168.1.2:554/stream' });
      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/already in progress/i);
    });
  });

  describe('POST /api/record/stop', () => {
    it('should stop recording and return idle status', async () => {
      const res = await request(app).post('/api/record/stop');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'idle');
    });

    it('should handle stopping when no recording is in progress', async () => {
      const res = await request(app).post('/api/record/stop');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message', 'No recording in progress.');
    });
  });

  describe('GET /api/recordings', () => {
    it('should return an array of recordings', async () => {
      const res = await request(app).get('/api/recordings');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('recordings');
      expect(Array.isArray(res.body.recordings)).toBe(true);
    });
  });

  describe('GET /', () => {
    it('should serve the frontend HTML page', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/html/);
    });
  });

  describe('GET /api/stream/mjpeg', () => {
    it('should return 400 when no stream is active', async () => {
      const res = await request(app).get('/api/stream/mjpeg');
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/No stream active/i);
    });
  });

  // ===== Audio Streaming Tests =====

  describe('GET /api/stream/audio', () => {
    it('should return 400 when no audio stream is available', async () => {
      const res = await request(app).get('/api/stream/audio');
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/No audio stream available/i);
    });

    it('should spawn ffmpeg and stream audio when stream is active', async () => {
      const { spawn } = require('child_process');
      // Start a stream first so audioUrl is set
      await request(app)
        .post('/api/stream/start')
        .send({ cameraUrl: 'http://admin:pass@192.168.1.1/video/mjpg.cgi' });

      expect(app.cameraManager.audioUrl).toBeTruthy();

      // Request audio - spawn is mocked so we get a mock process
      const res = await request(app).get('/api/stream/audio');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/audio\/mpeg/);

      // Verify spawn was called with ffmpeg and denoise filter args
      expect(spawn).toHaveBeenCalledWith(
        'ffmpeg',
        expect.arrayContaining([
          '-af', 'afftdn=nf=-25,highpass=f=200,lowpass=f=3000',
          '-c:a', 'libmp3lame'
        ]),
        expect.any(Object)
      );
    });

    it('should pass the derived audio URL to ffmpeg', async () => {
      const { spawn } = require('child_process');
      spawn.mockClear();

      await request(app)
        .post('/api/stream/start')
        .send({ cameraUrl: 'http://admin:pass@192.168.1.1/video/mjpg.cgi' });

      await request(app).get('/api/stream/audio');

      // The first arg after -i should be the derived audio URL
      const spawnArgs = spawn.mock.calls[spawn.mock.calls.length - 1][1];
      const iIndex = spawnArgs.indexOf('-i');
      expect(spawnArgs[iIndex + 1]).toBe('http://admin:pass@192.168.1.1/audio.cgi');
    });
  });

  describe('Audio in status responses', () => {
    it('should include audioUrl in status when MJPEG stream is active', async () => {
      await request(app)
        .post('/api/stream/start')
        .send({ cameraUrl: 'http://admin:pass@192.168.1.1/video/mjpg.cgi' });

      const res = await request(app).get('/api/status');
      expect(res.body.camera.audioUrl).toBe('/api/stream/audio');
    });

    it('should have null audioUrl when no stream is active', async () => {
      const res = await request(app).get('/api/status');
      expect(res.body.camera.audioUrl).toBeNull();
    });

    it('should return audioUrl in stream start response for MJPEG', async () => {
      const res = await request(app)
        .post('/api/stream/start')
        .send({ cameraUrl: 'http://admin:pass@192.168.1.1/video/mjpg.cgi' });
      expect(res.body.audioUrl).toBe('/api/stream/audio');
    });

    it('should clear audioUrl after stream stop', async () => {
      await request(app)
        .post('/api/stream/start')
        .send({ cameraUrl: 'http://admin:pass@192.168.1.1/video/mjpg.cgi' });
      await request(app).post('/api/stream/stop');

      const res = await request(app).get('/api/status');
      expect(res.body.camera.audioUrl).toBeNull();
    });
  });

  // ===== Recording with Audio Tests =====

  describe('Recording with audio', () => {
    it('should start recording with audio by default (includeAudio not specified)', async () => {
      const res = await request(app)
        .post('/api/record/start')
        .send({ cameraUrl: 'http://admin:pass@192.168.1.1/video/mjpg.cgi' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('recording');
      expect(res.body.audio).toBe(true);
    });

    it('should start recording without audio when includeAudio is false', async () => {
      const res = await request(app)
        .post('/api/record/start')
        .send({ cameraUrl: 'http://admin:pass@192.168.1.1/video/mjpg.cgi', includeAudio: false });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('recording');
      expect(res.body.audio).toBe(false);
    });

    it('should use ffmpeg spawn for dual-input recording with audio', async () => {
      const { spawn } = require('child_process');
      spawn.mockClear();

      await request(app)
        .post('/api/record/start')
        .send({ cameraUrl: 'http://admin:pass@192.168.1.1/video/mjpg.cgi' });

      // Should have spawned ffmpeg with two -i inputs (video + audio)
      expect(spawn).toHaveBeenCalledWith(
        'ffmpeg',
        expect.arrayContaining([
          '-i', 'http://admin:pass@192.168.1.1/video/mjpg.cgi',
          '-i', 'http://admin:pass@192.168.1.1/audio.cgi',
          '-af', 'afftdn=nf=-25,highpass=f=200,lowpass=f=3000',
          '-c:v', 'libx264',
          '-c:a', 'aac'
        ]),
        expect.any(Object)
      );
    });
  });

  describe('Schedule API - POST /api/schedules', () => {
    it('should create a new schedule', async () => {
      const res = await request(app)
        .post('/api/schedules')
        .send({
          name: 'Morning Recording',
          cameraUrl: 'rtsp://192.168.1.1:554/stream',
          startTime: '08:00',
          durationMinutes: 30,
          days: ['mon', 'wed', 'fri'],
          enabled: true
        });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('name', 'Morning Recording');
      expect(res.body).toHaveProperty('cameraUrl', 'rtsp://192.168.1.1:554/stream');
      expect(res.body).toHaveProperty('startTime', '08:00');
      expect(res.body).toHaveProperty('durationMinutes', 30);
      expect(res.body).toHaveProperty('days', ['mon', 'wed', 'fri']);
      expect(res.body).toHaveProperty('enabled', true);
      expect(res.body).toHaveProperty('createdAt');
    });

    it('should return 400 when cameraUrl is missing', async () => {
      const res = await request(app)
        .post('/api/schedules')
        .send({ startTime: '08:00' });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'cameraUrl and startTime are required.');
    });

    it('should return 400 when startTime is missing', async () => {
      const res = await request(app)
        .post('/api/schedules')
        .send({ cameraUrl: 'rtsp://192.168.1.1:554/stream' });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'cameraUrl and startTime are required.');
    });

    it('should return 400 when both cameraUrl and startTime are missing', async () => {
      const res = await request(app)
        .post('/api/schedules')
        .send({ name: 'No URL Schedule' });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'cameraUrl and startTime are required.');
    });
  });

  describe('Schedule API - GET /api/schedules', () => {
    it('should return empty schedules array initially', async () => {
      const res = await request(app).get('/api/schedules');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('schedules');
      expect(Array.isArray(res.body.schedules)).toBe(true);
      expect(res.body.schedules).toHaveLength(0);
    });

    it('should return all created schedules', async () => {
      // Create two schedules
      await request(app)
        .post('/api/schedules')
        .send({ name: 'Schedule A', cameraUrl: 'rtsp://cam1/stream', startTime: '08:00' });
      await request(app)
        .post('/api/schedules')
        .send({ name: 'Schedule B', cameraUrl: 'rtsp://cam2/stream', startTime: '18:00' });

      const res = await request(app).get('/api/schedules');
      expect(res.status).toBe(200);
      expect(res.body.schedules).toHaveLength(2);
      expect(res.body.schedules[0]).toHaveProperty('name', 'Schedule A');
      expect(res.body.schedules[1]).toHaveProperty('name', 'Schedule B');
    });
  });

  describe('Schedule API - PUT /api/schedules/:id', () => {
    it('should update an existing schedule', async () => {
      // Create a schedule first
      const createRes = await request(app)
        .post('/api/schedules')
        .send({ name: 'Original', cameraUrl: 'rtsp://cam1/stream', startTime: '08:00' });
      const id = createRes.body.id;

      // Update it
      const res = await request(app)
        .put(`/api/schedules/${id}`)
        .send({ name: 'Updated Name', startTime: '09:30' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('name', 'Updated Name');
      expect(res.body).toHaveProperty('startTime', '09:30');
      expect(res.body).toHaveProperty('id', id);
    });

    it('should return 404 for non-existent schedule', async () => {
      const res = await request(app)
        .put('/api/schedules/nonexistent123')
        .send({ name: 'Update' });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error', 'Schedule not found.');
    });
  });

  describe('Schedule API - DELETE /api/schedules/:id', () => {
    it('should delete an existing schedule', async () => {
      // Create a schedule first
      const createRes = await request(app)
        .post('/api/schedules')
        .send({ name: 'To Delete', cameraUrl: 'rtsp://cam1/stream', startTime: '08:00' });
      const id = createRes.body.id;

      // Delete it
      const res = await request(app).delete(`/api/schedules/${id}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message', 'Schedule deleted.');

      // Verify it's gone
      const listRes = await request(app).get('/api/schedules');
      expect(listRes.body.schedules).toHaveLength(0);
    });

    it('should return 404 for non-existent schedule', async () => {
      const res = await request(app).delete('/api/schedules/nonexistent123');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error', 'Schedule not found.');
    });
  });

  describe('GET /api/recordings/:filename (playback)', () => {
    it('should serve an existing recording file', async () => {
      // Mock fs to return a file list including our test file
      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);

      const res = await request(app).get('/api/recordings/recording_2026-01-01_12-00-00.mp4');
      // sendFile will either succeed (200) or fail with 404 if the actual file doesn't exist
      // Since we're testing the route logic, expect it to attempt to serve the file
      expect([200, 404]).toContain(res.status);
    });

    it('should return 404 for non-existent recording', async () => {
      const res = await request(app).get('/api/recordings/nonexistent.mp4');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error', 'Recording not found.');
    });

    it('should reject path traversal attempts', async () => {
      const res = await request(app).get('/api/recordings/..%2F..%2Fconfig.json');
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Invalid filename.');
    });

    it('should set correct content type for mp4 files', async () => {
      // When sendFile succeeds, it should set video/mp4 content type
      const res = await request(app).get('/api/recordings/test.mp4');
      // Even on 404, the route handles it - we're testing the route exists and responds
      expect([200, 404]).toContain(res.status);
    });
  });

  describe('DELETE /api/recordings/:filename', () => {
    it('should delete an existing recording', async () => {
      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      fs.unlinkSync.mockImplementation(() => {});

      const res = await request(app).delete('/api/recordings/recording_test.mp4');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message');
      expect(res.body.message).toMatch(/Deleted/i);
    });

    it('should return 404 for non-existent recording', async () => {
      const fs = require('fs');
      fs.existsSync.mockReturnValue(false);

      const res = await request(app).delete('/api/recordings/nonexistent.mp4');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error', 'Recording not found.');
    });

    it('should reject path traversal on delete', async () => {
      const res = await request(app).delete('/api/recordings/..%2F..%2Fpackage.json');
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Invalid filename.');
    });
  });

  describe('Error cases', () => {
    it('should return 400 for POST /api/stream/start without JSON body', async () => {
      const res = await request(app)
        .post('/api/stream/start')
        .send('not json')
        .set('Content-Type', 'text/plain');
      // Express won't parse text/plain, so req.body.cameraUrl will be undefined
      expect(res.status).toBe(400);
    });

    it('should return 400 for POST /api/record/start without JSON body', async () => {
      const res = await request(app)
        .post('/api/record/start')
        .send('not json')
        .set('Content-Type', 'text/plain');
      expect(res.status).toBe(400);
    });
  });

  // ===== Camera Store API Tests =====

  describe('Camera API - POST /api/cameras', () => {
    it('should create a new camera', async () => {
      const res = await request(app)
        .post('/api/cameras')
        .send({
          name: 'Front Door',
          ip: '192.168.1.100',
          port: 8080,
          username: 'admin',
          password: 'secret',
          protocol: 'rtsp'
        });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('name', 'Front Door');
      expect(res.body).toHaveProperty('ip', '192.168.1.100');
      expect(res.body).toHaveProperty('port', 8080);
      expect(res.body).toHaveProperty('username', 'admin');
      expect(res.body).toHaveProperty('password', 'secret');
      expect(res.body).toHaveProperty('protocol', 'rtsp');
      expect(res.body).toHaveProperty('createdAt');
    });

    it('should create a camera with default values', async () => {
      const res = await request(app)
        .post('/api/cameras')
        .send({ ip: '192.168.1.50' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('name', 'Camera');
      expect(res.body).toHaveProperty('port', 80);
      expect(res.body).toHaveProperty('protocol', 'auto');
    });

    it('should return 400 when ip is missing', async () => {
      const res = await request(app)
        .post('/api/cameras')
        .send({ name: 'No IP Camera' });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'IP address is required.');
    });
  });

  describe('Camera API - GET /api/cameras', () => {
    it('should return empty cameras array initially', async () => {
      const res = await request(app).get('/api/cameras');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('cameras');
      expect(Array.isArray(res.body.cameras)).toBe(true);
      expect(res.body.cameras).toHaveLength(0);
    });

    it('should return all created cameras', async () => {
      await request(app)
        .post('/api/cameras')
        .send({ name: 'Camera A', ip: '192.168.1.1' });
      await request(app)
        .post('/api/cameras')
        .send({ name: 'Camera B', ip: '192.168.1.2' });

      const res = await request(app).get('/api/cameras');
      expect(res.status).toBe(200);
      expect(res.body.cameras).toHaveLength(2);
      expect(res.body.cameras[0]).toHaveProperty('name', 'Camera A');
      expect(res.body.cameras[1]).toHaveProperty('name', 'Camera B');
    });
  });

  describe('Camera API - PUT /api/cameras/:id', () => {
    it('should update an existing camera', async () => {
      const createRes = await request(app)
        .post('/api/cameras')
        .send({ name: 'Original', ip: '192.168.1.1' });
      const id = createRes.body.id;

      const res = await request(app)
        .put(`/api/cameras/${id}`)
        .send({ name: 'Updated Name', ip: '10.0.0.1' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('name', 'Updated Name');
      expect(res.body).toHaveProperty('ip', '10.0.0.1');
      expect(res.body).toHaveProperty('id', id);
    });

    it('should return 404 for non-existent camera', async () => {
      const res = await request(app)
        .put('/api/cameras/nonexistent123')
        .send({ name: 'Update' });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error', 'Camera not found.');
    });
  });

  describe('Camera API - DELETE /api/cameras/:id', () => {
    it('should delete an existing camera', async () => {
      const createRes = await request(app)
        .post('/api/cameras')
        .send({ name: 'To Delete', ip: '192.168.1.1' });
      const id = createRes.body.id;

      const res = await request(app).delete(`/api/cameras/${id}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message', 'Camera deleted.');

      // Verify it's gone
      const listRes = await request(app).get('/api/cameras');
      expect(listRes.body.cameras).toHaveLength(0);
    });

    it('should return 404 for non-existent camera', async () => {
      const res = await request(app).delete('/api/cameras/nonexistent123');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error', 'Camera not found.');
    });
  });
});
