/**
 * Integration tests - automated server start, HTTP endpoints, WebSocket, and full workflow tests.
 * Replaces manual "start server, curl, verify" testing.
 */

const http = require('http');
const request = require('supertest');
const WebSocket = require('ws');

// Mock fluent-ffmpeg before requiring server modules
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
    factory._lastCommand = cmd;
    return cmd;
  });
  factory._lastCommand = null;
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

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    mkdirSync: jest.fn(),
    readdirSync: jest.fn(() => []),
    unlinkSync: jest.fn(),
    statSync: jest.fn(() => ({
      size: 5242880,
      mtime: new Date('2026-02-14T10:00:00Z')
    })),
    existsSync: jest.fn((p) => {
      // Allow static files to be served for HTML page test
      if (p && (p.endsWith('.html') || p.endsWith('.js') || p.endsWith('.css'))) {
        return actual.existsSync(p);
      }
      return true;
    }),
    readFileSync: jest.fn((p, ...args) => {
      // Allow real reads for config.json and static files
      if (p && (p.endsWith('config.json') || p.endsWith('.html') || p.endsWith('.js') || p.endsWith('.css') || p.endsWith('schedules.json'))) {
        try {
          return actual.readFileSync(p, ...args);
        } catch {
          return '[]';
        }
      }
      return '[]';
    }),
    writeFileSync: jest.fn()
  };
});

const { app, server, wss, cameraManager, recorderManager, schedulerManager } = require('../src/server');

describe('Integration Tests', () => {
  let serverInstance;
  let serverPort;

  beforeAll((done) => {
    // Start server on a random available port
    serverInstance = server.listen(0, () => {
      serverPort = serverInstance.address().port;
      done();
    });
  });

  afterAll((done) => {
    schedulerManager.destroy();
    wss.close();
    serverInstance.close(done);
  });

  afterEach(() => {
    // Reset state between tests
    cameraManager.process = null;
    cameraManager.status = 'idle';
    cameraManager.currentUrl = null;
    cameraManager.audioUrl = null;
    recorderManager.process = null;
    recorderManager.status = 'idle';
    recorderManager.currentUrl = null;
    recorderManager.currentFile = null;
    recorderManager.startTime = null;
    schedulerManager.schedules = [];
    schedulerManager.activeTimers.forEach((timer) => clearTimeout(timer));
    schedulerManager.activeTimers.clear();
  });

  // =================== Server Startup ===================

  describe('Server Startup', () => {
    it('should start and listen on a port', () => {
      expect(serverPort).toBeGreaterThan(0);
    });

    it('should serve the frontend HTML page', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/html/);
      expect(res.text).toContain('IP Camera Viewer');
      expect(res.text).toContain('mjpegPlayer');
      expect(res.text).toContain('playbackModal');
    });

    it('should serve static JS files', async () => {
      const res = await request(app).get('/js/app.js');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/javascript/);
    });

    it('should serve static CSS files', async () => {
      const res = await request(app).get('/css/style.css');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/css/);
    });
  });

  // =================== WebSocket Integration ===================

  describe('WebSocket Integration', () => {
    it('should accept WebSocket connections', (done) => {
      const ws = new WebSocket(`ws://localhost:${serverPort}`);
      ws.on('open', () => {
        expect(ws.readyState).toBe(WebSocket.OPEN);
        ws.close();
        done();
      });
      ws.on('error', done);
    });

    it('should send initial status on WebSocket connect', (done) => {
      const ws = new WebSocket(`ws://localhost:${serverPort}`);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        expect(msg.type).toBe('status');
        expect(msg).toHaveProperty('camera');
        expect(msg).toHaveProperty('recorder');
        expect(msg.camera).toHaveProperty('status', 'idle');
        expect(msg.recorder).toHaveProperty('status', 'idle');
        ws.close();
        done();
      });
      ws.on('error', done);
    });

    it('should broadcast camera status changes to connected clients', (done) => {
      const ws = new WebSocket(`ws://localhost:${serverPort}`);
      let messageCount = 0;

      ws.on('message', (data) => {
        messageCount++;
        const msg = JSON.parse(data.toString());

        if (messageCount === 1) {
          // First message is initial status
          expect(msg.type).toBe('status');

          // Trigger a camera status change
          cameraManager.emit('status', { status: 'streaming', url: 'rtsp://test' });
        } else if (messageCount === 2) {
          // Second message should be the camera_status broadcast
          expect(msg.type).toBe('camera_status');
          expect(msg.status).toBe('streaming');
          ws.close();
          done();
        }
      });

      ws.on('error', done);
    });

    it('should broadcast recorder status changes to connected clients', (done) => {
      const ws = new WebSocket(`ws://localhost:${serverPort}`);
      let messageCount = 0;

      ws.on('message', (data) => {
        messageCount++;
        const msg = JSON.parse(data.toString());

        if (messageCount === 1) {
          recorderManager.emit('status', { status: 'recording', file: 'test.mp4' });
        } else if (messageCount === 2) {
          expect(msg.type).toBe('recorder_status');
          expect(msg.status).toBe('recording');
          ws.close();
          done();
        }
      });

      ws.on('error', done);
    });
  });

  // =================== Full Stream Workflow ===================

  describe('Full Stream Workflow', () => {
    it('should complete start → status → stop stream cycle', async () => {
      // 1. Start stream
      const startRes = await request(app)
        .post('/api/stream/start')
        .send({ cameraUrl: 'http://admin:pass@192.168.1.1/video/mjpg.cgi' });
      expect(startRes.status).toBe(200);
      expect(startRes.body.status).toBe('streaming');
      expect(startRes.body.streamType).toBe('mjpeg');

      // 2. Check status
      const statusRes = await request(app).get('/api/status');
      expect(statusRes.body.camera.status).toBe('streaming');
      expect(statusRes.body.camera.streamType).toBe('mjpeg');

      // 3. Stop stream
      const stopRes = await request(app).post('/api/stream/stop');
      expect(stopRes.status).toBe(200);
      expect(stopRes.body.status).toBe('idle');

      // 4. Verify idle
      const finalStatus = await request(app).get('/api/status');
      expect(finalStatus.body.camera.status).toBe('idle');
    });

    it('should complete RTSP start → status → stop stream cycle', async () => {
      const startRes = await request(app)
        .post('/api/stream/start')
        .send({ cameraUrl: 'rtsp://admin:pass@192.168.1.1:554/stream' });
      expect(startRes.status).toBe(200);
      expect(startRes.body.status).toBe('streaming');

      const statusRes = await request(app).get('/api/status');
      expect(statusRes.body.camera.status).toBe('streaming');
      expect(statusRes.body.camera.streamType).toBe('hls');

      const stopRes = await request(app).post('/api/stream/stop');
      expect(stopRes.status).toBe(200);
      expect(stopRes.body.status).toBe('idle');
    });
  });

  // =================== Full Recording Workflow ===================

  describe('Full Recording Workflow', () => {
    it('should complete start → status → stop recording cycle', async () => {
      // 1. Start recording
      const startRes = await request(app)
        .post('/api/record/start')
        .send({ cameraUrl: 'http://admin:pass@192.168.1.1/video/mjpg.cgi' });
      expect(startRes.status).toBe(200);
      expect(startRes.body.status).toBe('recording');
      expect(startRes.body.file).toMatch(/^recording_.*\.mp4$/);

      // 2. Check status - should show recording
      const statusRes = await request(app).get('/api/status');
      expect(statusRes.body.recorder.status).toBe('recording');
      expect(statusRes.body.recorder.file).toMatch(/^recording_.*\.mp4$/);
      expect(statusRes.body.recorder.duration).toBeGreaterThanOrEqual(0);

      // 3. Stop recording
      const stopRes = await request(app).post('/api/record/stop');
      expect(stopRes.status).toBe(200);
      expect(stopRes.body.status).toBe('idle');
      expect(stopRes.body.file).toMatch(/^recording_.*\.mp4$/);

      // 4. Verify idle
      const finalStatus = await request(app).get('/api/status');
      expect(finalStatus.body.recorder.status).toBe('idle');
    });

    it('should allow recording independent of streaming state', async () => {
      // No stream is active, but recording should still work
      const statusBefore = await request(app).get('/api/status');
      expect(statusBefore.body.camera.status).toBe('idle');

      const startRes = await request(app)
        .post('/api/record/start')
        .send({ cameraUrl: 'http://admin:pass@192.168.1.1/video/mjpg.cgi' });
      expect(startRes.status).toBe(200);
      expect(startRes.body.status).toBe('recording');

      await request(app).post('/api/record/stop');
    });

    it('should allow simultaneous streaming and recording', async () => {
      // Start stream
      await request(app)
        .post('/api/stream/start')
        .send({ cameraUrl: 'http://admin:pass@192.168.1.1/video/mjpg.cgi' });

      // Start recording
      await request(app)
        .post('/api/record/start')
        .send({ cameraUrl: 'http://admin:pass@192.168.1.1/video/mjpg.cgi' });

      // Both should be active
      const statusRes = await request(app).get('/api/status');
      expect(statusRes.body.camera.status).toBe('streaming');
      expect(statusRes.body.recorder.status).toBe('recording');

      // Stop recording - stream should continue
      await request(app).post('/api/record/stop');
      const afterRecStop = await request(app).get('/api/status');
      expect(afterRecStop.body.camera.status).toBe('streaming');
      expect(afterRecStop.body.recorder.status).toBe('idle');

      // Stop stream
      await request(app).post('/api/stream/stop');
      const afterAll = await request(app).get('/api/status');
      expect(afterAll.body.camera.status).toBe('idle');
      expect(afterAll.body.recorder.status).toBe('idle');
    });
  });

  // =================== Full Schedule Workflow ===================

  describe('Full Schedule Workflow', () => {
    it('should complete create → list → update → delete schedule cycle', async () => {
      // 1. Create schedule
      const createRes = await request(app)
        .post('/api/schedules')
        .send({
          name: 'Night Watch',
          cameraUrl: 'http://admin:pass@192.168.86.44/video/mjpg.cgi',
          startTime: '22:00',
          durationMinutes: 120,
          days: ['mon', 'tue', 'wed', 'thu', 'fri'],
          enabled: true
        });
      expect(createRes.status).toBe(200);
      expect(createRes.body.name).toBe('Night Watch');
      expect(createRes.body.durationMinutes).toBe(120);
      expect(createRes.body.days).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
      const scheduleId = createRes.body.id;

      // 2. List schedules - should contain our schedule
      const listRes = await request(app).get('/api/schedules');
      expect(listRes.body.schedules).toHaveLength(1);
      expect(listRes.body.schedules[0].id).toBe(scheduleId);

      // 3. Update schedule
      const updateRes = await request(app)
        .put(`/api/schedules/${scheduleId}`)
        .send({ name: 'Night Watch v2', durationMinutes: 180 });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.name).toBe('Night Watch v2');
      expect(updateRes.body.durationMinutes).toBe(180);
      expect(updateRes.body.cameraUrl).toBe('http://admin:pass@192.168.86.44/video/mjpg.cgi');

      // 4. Delete schedule
      const deleteRes = await request(app).delete(`/api/schedules/${scheduleId}`);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.message).toBe('Schedule deleted.');

      // 5. Verify empty
      const emptyRes = await request(app).get('/api/schedules');
      expect(emptyRes.body.schedules).toHaveLength(0);
    });

    it('should create multiple schedules and manage them independently', async () => {
      const sched1 = await request(app)
        .post('/api/schedules')
        .send({ name: 'Morning', cameraUrl: 'http://cam1/video/mjpg.cgi', startTime: '08:00' });
      const sched2 = await request(app)
        .post('/api/schedules')
        .send({ name: 'Evening', cameraUrl: 'http://cam1/video/mjpg.cgi', startTime: '18:00' });
      const sched3 = await request(app)
        .post('/api/schedules')
        .send({ name: 'Night', cameraUrl: 'http://cam1/video/mjpg.cgi', startTime: '23:00' });

      // Should have 3 schedules
      const listRes = await request(app).get('/api/schedules');
      expect(listRes.body.schedules).toHaveLength(3);

      // Delete middle one
      await request(app).delete(`/api/schedules/${sched2.body.id}`);

      // Should have 2 remaining
      const afterDelete = await request(app).get('/api/schedules');
      expect(afterDelete.body.schedules).toHaveLength(2);
      expect(afterDelete.body.schedules.map((s) => s.name)).toEqual(['Morning', 'Night']);
    });

    it('should toggle schedule enabled/disabled', async () => {
      const createRes = await request(app)
        .post('/api/schedules')
        .send({ name: 'Toggle Test', cameraUrl: 'http://cam1/video/mjpg.cgi', startTime: '10:00', enabled: true });

      expect(createRes.body.enabled).toBe(true);

      // Disable
      const disableRes = await request(app)
        .put(`/api/schedules/${createRes.body.id}`)
        .send({ enabled: false });
      expect(disableRes.body.enabled).toBe(false);

      // Re-enable
      const enableRes = await request(app)
        .put(`/api/schedules/${createRes.body.id}`)
        .send({ enabled: true });
      expect(enableRes.body.enabled).toBe(true);
    });
  });

  // =================== Recording Management Workflow ===================

  describe('Recording Management', () => {
    it('should list recordings from the recordings directory', async () => {
      const fs = require('fs');
      fs.readdirSync.mockReturnValueOnce([
        'recording_2026-02-14_10-00-00.mp4',
        'recording_2026-02-13_22-00-00.mp4',
      ]);

      const res = await request(app).get('/api/recordings');
      expect(res.status).toBe(200);
      expect(res.body.recordings).toHaveLength(2);
      expect(res.body.recordings[0]).toHaveProperty('name');
      expect(res.body.recordings[0]).toHaveProperty('size');
      expect(res.body.recordings[0]).toHaveProperty('date');
    });

    it('should reject path traversal attempts on recording download', async () => {
      const res = await request(app).get('/api/recordings/..%2F..%2Fconfig.json');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid filename.');
    });

    it('should reject path traversal attempts on recording delete', async () => {
      const res = await request(app).delete('/api/recordings/..%2F..%2Fpackage.json');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid filename.');
    });
  });

  // =================== Audio Streaming Integration ===================

  describe('Audio Streaming', () => {
    it('should return 400 for audio endpoint when no stream is active', async () => {
      const res = await request(app).get('/api/stream/audio');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/No audio stream available/);
    });

    it('should stream audio after starting MJPEG stream', async () => {
      // Start stream
      await request(app)
        .post('/api/stream/start')
        .send({ cameraUrl: 'http://admin:pass@192.168.1.1/video/mjpg.cgi' });

      // Audio endpoint should now be available (spawn is mocked)
      const res = await request(app).get('/api/stream/audio');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/audio\/mpeg/);
    });

    it('should include audioUrl in status during active MJPEG stream', async () => {
      await request(app)
        .post('/api/stream/start')
        .send({ cameraUrl: 'http://admin:pass@192.168.1.1/video/mjpg.cgi' });

      const statusRes = await request(app).get('/api/status');
      expect(statusRes.body.camera.audioUrl).toBe('/api/stream/audio');
    });

    it('should clear audioUrl after stopping stream', async () => {
      await request(app)
        .post('/api/stream/start')
        .send({ cameraUrl: 'http://admin:pass@192.168.1.1/video/mjpg.cgi' });
      await request(app).post('/api/stream/stop');

      const statusRes = await request(app).get('/api/status');
      expect(statusRes.body.camera.audioUrl).toBeNull();
    });

    it('should return audioUrl in MJPEG stream start response', async () => {
      const res = await request(app)
        .post('/api/stream/start')
        .send({ cameraUrl: 'http://admin:pass@192.168.1.1/video/mjpg.cgi' });
      expect(res.body.audioUrl).toBe('/api/stream/audio');
    });
  });

  // =================== Recording with Audio Integration ===================

  describe('Recording with Audio', () => {
    it('should record with audio by default and return audio: true', async () => {
      const startRes = await request(app)
        .post('/api/record/start')
        .send({ cameraUrl: 'http://admin:pass@192.168.1.1/video/mjpg.cgi' });
      expect(startRes.status).toBe(200);
      expect(startRes.body.status).toBe('recording');
      expect(startRes.body.audio).toBe(true);
      expect(startRes.body.file).toMatch(/^recording_.*\.mp4$/);

      // Stop and verify
      const stopRes = await request(app).post('/api/record/stop');
      expect(stopRes.body.status).toBe('idle');
    });

    it('should record without audio when includeAudio is false', async () => {
      const startRes = await request(app)
        .post('/api/record/start')
        .send({ cameraUrl: 'http://admin:pass@192.168.1.1/video/mjpg.cgi', includeAudio: false });
      expect(startRes.status).toBe(200);
      expect(startRes.body.audio).toBe(false);

      await request(app).post('/api/record/stop');
    });

    it('should complete full stream + audio record + stop cycle', async () => {
      // 1. Start stream (sets audioUrl)
      const streamRes = await request(app)
        .post('/api/stream/start')
        .send({ cameraUrl: 'http://admin:pass@192.168.1.1/video/mjpg.cgi' });
      expect(streamRes.body.audioUrl).toBe('/api/stream/audio');

      // 2. Start recording with audio
      const recordRes = await request(app)
        .post('/api/record/start')
        .send({ cameraUrl: 'http://admin:pass@192.168.1.1/video/mjpg.cgi' });
      expect(recordRes.body.audio).toBe(true);

      // 3. Verify both stream and recording are active
      const statusRes = await request(app).get('/api/status');
      expect(statusRes.body.camera.status).toBe('streaming');
      expect(statusRes.body.camera.audioUrl).toBe('/api/stream/audio');
      expect(statusRes.body.recorder.status).toBe('recording');

      // 4. Stop recording
      await request(app).post('/api/record/stop');
      const afterRecordStop = await request(app).get('/api/status');
      expect(afterRecordStop.body.recorder.status).toBe('idle');
      expect(afterRecordStop.body.camera.status).toBe('streaming');

      // 5. Stop stream
      await request(app).post('/api/stream/stop');
      const finalStatus = await request(app).get('/api/status');
      expect(finalStatus.body.camera.audioUrl).toBeNull();
    });
  });

  // =================== MJPEG Proxy Tests ===================

  describe('MJPEG Proxy', () => {
    it('should return 400 when no stream is active', async () => {
      const res = await request(app).get('/api/stream/mjpeg');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/No stream active/);
    });

    it('should attempt proxy when stream is active (returns 502 in test env)', (done) => {
      // Start an MJPEG stream first
      request(app)
        .post('/api/stream/start')
        .send({ cameraUrl: 'http://admin:pass@192.168.86.44/video/mjpg.cgi' })
        .then(() => {
          // The proxy will try to connect to the camera, which won't work in test
          // Use a raw http request with a timeout to avoid supertest hanging
          const req = http.get(
            `http://localhost:${serverPort}/api/stream/mjpeg`,
            { timeout: 2000 },
            (res) => {
              // Should either stream (200), fail to connect (502), or get auth challenge (401)
              expect([200, 401, 502]).toContain(res.statusCode);
              res.destroy();
              done();
            }
          );
          req.on('timeout', () => {
            req.destroy();
            // Timeout means the proxy is trying to connect - this is expected
            done();
          });
          req.on('error', (err) => {
            // Connection error is also acceptable in test env
            done();
          });
        });
    });
  });

  // =================== Error Handling ===================

  describe('Error Handling', () => {
    it('should return 400 for stream start without cameraUrl', async () => {
      const res = await request(app).post('/api/stream/start').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('cameraUrl is required.');
    });

    it('should return 400 for record start without cameraUrl', async () => {
      const res = await request(app).post('/api/record/start').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('cameraUrl is required.');
    });

    it('should return 400 for schedule create without cameraUrl', async () => {
      const res = await request(app).post('/api/schedules').send({ startTime: '08:00' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('cameraUrl and startTime are required.');
    });

    it('should return 404 for non-existent schedule update', async () => {
      const res = await request(app).put('/api/schedules/nonexistent').send({ name: 'X' });
      expect(res.status).toBe(404);
    });

    it('should return 404 for non-existent schedule delete', async () => {
      const res = await request(app).delete('/api/schedules/nonexistent');
      expect(res.status).toBe(404);
    });

    it('should return 500 when starting duplicate stream', async () => {
      await request(app).post('/api/stream/start').send({ cameraUrl: 'http://cam/video/mjpg.cgi' });
      const res = await request(app).post('/api/stream/start').send({ cameraUrl: 'http://cam2/video/mjpg.cgi' });
      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/already running/i);
    });

    it('should return 500 when starting duplicate recording', async () => {
      await request(app).post('/api/record/start').send({ cameraUrl: 'http://cam/video/mjpg.cgi' });
      const res = await request(app).post('/api/record/start').send({ cameraUrl: 'http://cam2/video/mjpg.cgi' });
      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/already in progress/i);
    });
  });

  // =================== HTML Content Verification ===================

  describe('HTML Content Verification', () => {
    it('should contain live stream MJPEG img element', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('id="mjpegPlayer"');
      expect(res.text).toContain('class="mjpeg-player"');
    });

    it('should contain separate playback modal', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('id="playbackModal"');
      expect(res.text).toContain('id="playbackPlayer"');
    });

    it('should contain LIVE stream label', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('stream-label');
      expect(res.text).toContain('LIVE');
    });

    it('should contain recording badge', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('id="recordingBadge"');
      expect(res.text).toContain('REC');
    });

    it('should contain sidebar tabs for recordings and schedules', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('data-tab="recordings"');
      expect(res.text).toContain('data-tab="schedules"');
    });

    it('should contain schedule modal with day selector', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('id="scheduleModal"');
      expect(res.text).toContain('id="schedDays"');
      expect(res.text).toContain('value="mon"');
      expect(res.text).toContain('value="sun"');
    });

    it('should contain all control buttons', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('id="btnStartStream"');
      expect(res.text).toContain('id="btnStopStream"');
      expect(res.text).toContain('id="btnStartRecord"');
      expect(res.text).toContain('id="btnStopRecord"');
      expect(res.text).toContain('id="btnRefreshRecordings"');
      expect(res.text).toContain('id="btnAddSchedule"');
    });

    it('should include video.js and app.js scripts', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('video.min.js');
      expect(res.text).toContain('js/app.js');
    });

    it('should contain audio controls', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('id="audioControls"');
      expect(res.text).toContain('id="audioPlayer"');
      expect(res.text).toContain('id="btnToggleMute"');
      expect(res.text).toContain('id="volumeSlider"');
    });

    it('should contain camera management tab and modal', async () => {
      const res = await request(app).get('/');
      expect(res.text).toContain('data-tab="cameras"');
      expect(res.text).toContain('id="cameraModal"');
    });
  });
});
