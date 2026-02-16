const express = require('express');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

function createRoutes(cameraManager, recorderManager, schedulerManager, cameraStore, discoveryManager) {
  const router = express.Router();

  // MJPEG proxy - pipes the camera's MJPEG stream to the browser
  router.get('/api/stream/mjpeg', (req, res) => {
    const cameraUrl = cameraManager.currentUrl;
    if (!cameraUrl) {
      return res.status(400).json({ error: 'No stream active. Start stream first.' });
    }

    const parsedUrl = new URL(cameraUrl);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      auth: parsedUrl.username ? `${parsedUrl.username}:${parsedUrl.password}` : undefined,
      timeout: 10000,
    };

    const proxyReq = client.get(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': proxyRes.headers['content-type'] || 'multipart/x-mixed-replace',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.status(502).json({ error: 'Failed to connect to camera: ' + err.message });
      }
    });

    req.on('close', () => {
      proxyReq.destroy();
    });
  });

  // MJPEG proxy for a specific saved camera by ID (used by grid view)
  router.get('/api/stream/mjpeg/:cameraId', (req, res) => {
    if (!cameraStore) {
      return res.status(404).json({ error: 'Camera not found.' });
    }

    const camera = cameraStore.getCamera(req.params.cameraId);
    if (!camera) {
      return res.status(404).json({ error: 'Camera not found.' });
    }

    const cameraUrl = cameraStore.buildUrl(camera);
    if (!cameraUrl) {
      return res.status(400).json({ error: 'Cannot build URL for camera.' });
    }

    const parsedUrl = new URL(cameraUrl);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      auth: parsedUrl.username ? `${parsedUrl.username}:${parsedUrl.password}` : undefined,
      timeout: 10000,
    };

    const proxyReq = client.get(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': proxyRes.headers['content-type'] || 'multipart/x-mixed-replace',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.status(502).json({ error: 'Failed to connect to camera: ' + err.message });
      }
    });

    req.on('close', () => {
      proxyReq.destroy();
    });
  });

  // Audio proxy with ffmpeg denoising - streams denoised audio as MP3
  router.get('/api/stream/audio', (req, res) => {
    const audioUrl = cameraManager.audioUrl;
    if (!audioUrl) {
      return res.status(400).json({ error: 'No audio stream available. Start stream first.' });
    }

    // Spawn ffmpeg to fetch audio, denoise it, and output as MP3
    const ffmpegArgs = [
      '-i', audioUrl,
      '-af', 'afftdn=nf=-25,highpass=f=200,lowpass=f=3000',
      '-c:a', 'libmp3lame',
      '-b:a', '128k',
      '-f', 'mp3',
      '-'
    ];

    const ffmpegProc = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    ffmpegProc.stdout.pipe(res);

    ffmpegProc.stderr.on('data', () => {
      // Suppress ffmpeg stderr output
    });

    ffmpegProc.on('error', (err) => {
      if (!res.headersSent) {
        res.status(502).json({ error: 'Failed to process audio: ' + err.message });
      }
    });

    ffmpegProc.on('close', () => {
      if (!res.writableEnded) {
        res.end();
      }
    });

    req.on('close', () => {
      ffmpegProc.kill('SIGTERM');
    });
  });

  // GET /api/status
  router.get('/api/status', (req, res) => {
    res.json({
      camera: cameraManager.getStatus(),
      recorder: recorderManager.getStatus()
    });
  });

  // POST /api/stream/start
  router.post('/api/stream/start', async (req, res) => {
    try {
      const { cameraUrl } = req.body;
      if (!cameraUrl) {
        return res.status(400).json({ error: 'cameraUrl is required.' });
      }
      const result = await cameraManager.startStream(cameraUrl);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/stream/stop
  router.post('/api/stream/stop', async (req, res) => {
    try {
      const result = await cameraManager.stopStream();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/record/start
  router.post('/api/record/start', async (req, res) => {
    try {
      const { cameraUrl, includeAudio } = req.body;
      if (!cameraUrl) {
        return res.status(400).json({ error: 'cameraUrl is required.' });
      }
      const options = { includeAudio: includeAudio !== false };
      const result = await recorderManager.startRecording(cameraUrl, options);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/record/stop
  router.post('/api/record/stop', async (req, res) => {
    try {
      const result = await recorderManager.stopRecording();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/recordings
  router.get('/api/recordings', (req, res) => {
    const recordings = recorderManager.getRecordings();
    res.json({ recordings });
  });

  // GET /api/recordings/:filename
  router.get('/api/recordings/:filename', (req, res) => {
    const filename = req.params.filename;
    const recordingsDir = recorderManager.recordingsDir;
    const filePath = path.join(recordingsDir, filename);

    // Prevent path traversal
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(recordingsDir))) {
      return res.status(400).json({ error: 'Invalid filename.' });
    }

    res.sendFile(resolved, (err) => {
      if (err) {
        res.status(404).json({ error: 'Recording not found.' });
      }
    });
  });

  // DELETE /api/recordings/:filename
  router.delete('/api/recordings/:filename', (req, res) => {
    try {
      const result = recorderManager.deleteRecording(req.params.filename);
      res.json(result);
    } catch (err) {
      const status = err.message === 'Recording not found.' ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  });

  // ===== Schedule Routes =====

  // GET /api/schedules
  router.get('/api/schedules', (req, res) => {
    res.json({ schedules: schedulerManager.getSchedules() });
  });

  // POST /api/schedules
  router.post('/api/schedules', (req, res) => {
    try {
      const { name, cameraUrl, startTime, durationMinutes, days, enabled } = req.body;
      if (!cameraUrl || !startTime) {
        return res.status(400).json({ error: 'cameraUrl and startTime are required.' });
      }
      const schedule = schedulerManager.addSchedule({ name, cameraUrl, startTime, durationMinutes, days, enabled });
      res.json(schedule);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/schedules/:id
  router.put('/api/schedules/:id', (req, res) => {
    try {
      const schedule = schedulerManager.updateSchedule(req.params.id, req.body);
      res.json(schedule);
    } catch (err) {
      const status = err.message === 'Schedule not found.' ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // DELETE /api/schedules/:id
  router.delete('/api/schedules/:id', (req, res) => {
    try {
      const result = schedulerManager.deleteSchedule(req.params.id);
      res.json(result);
    } catch (err) {
      const status = err.message === 'Schedule not found.' ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // ===== Camera Store Routes =====

  // GET /api/cameras
  router.get('/api/cameras', (req, res) => {
    if (!cameraStore) {
      return res.json({ cameras: [] });
    }
    res.json({ cameras: cameraStore.listCameras() });
  });

  // POST /api/cameras
  router.post('/api/cameras', (req, res) => {
    try {
      const { name, ip, port, username, password, protocol } = req.body;
      if (!ip) {
        return res.status(400).json({ error: 'IP address is required.' });
      }
      const camera = cameraStore.addCamera({ name, ip, port, username, password, protocol });
      res.json(camera);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/cameras/:id
  router.put('/api/cameras/:id', (req, res) => {
    try {
      const camera = cameraStore.updateCamera(req.params.id, req.body);
      res.json(camera);
    } catch (err) {
      const status = err.message === 'Camera not found.' ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // DELETE /api/cameras/:id
  router.delete('/api/cameras/:id', (req, res) => {
    try {
      const result = cameraStore.deleteCamera(req.params.id);
      res.json(result);
    } catch (err) {
      const status = err.message === 'Camera not found.' ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // ===== ONVIF Discovery Routes =====

  // POST /api/discover - Scan the network for ONVIF cameras
  router.post('/api/discover', async (req, res) => {
    if (!discoveryManager) {
      return res.status(501).json({ error: 'Discovery not available.' });
    }
    try {
      const { timeout, baseIp } = req.body;
      // Use discoverAll to run both ONVIF and port-probe scans
      const devices = await discoveryManager.discoverAll({ timeout: timeout || 5000, baseIp });
      res.json({ devices });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/discover/stream-uri - Get RTSP stream URI from an ONVIF device
  router.post('/api/discover/stream-uri', async (req, res) => {
    if (!discoveryManager) {
      return res.status(501).json({ error: 'ONVIF discovery not available.' });
    }
    try {
      const { hostname, port, username, password } = req.body;
      if (!hostname) {
        return res.status(400).json({ error: 'hostname is required.' });
      }
      const result = await discoveryManager.getStreamUri(hostname, port, username, password);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/discover/device-info - Get device information from an ONVIF device
  router.post('/api/discover/device-info', async (req, res) => {
    if (!discoveryManager) {
      return res.status(501).json({ error: 'ONVIF discovery not available.' });
    }
    try {
      const { hostname, port, username, password } = req.body;
      if (!hostname) {
        return res.status(400).json({ error: 'hostname is required.' });
      }
      const result = await discoveryManager.getDeviceInfo(hostname, port, username, password);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = createRoutes;
