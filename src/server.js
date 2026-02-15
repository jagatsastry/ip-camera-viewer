const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const getFfmpegPath = require('./ffmpeg-path');
const config = require('../config.json');
const CameraManager = require('./camera');
const RecorderManager = require('./recorder');

// Set FFmpeg binary path (bundled in Electron, ffmpeg-static in dev, or system PATH)
ffmpeg.setFfmpegPath(getFfmpegPath());
const SchedulerManager = require('./scheduler');
const CameraStore = require('./cameras-store');
const DiscoveryManager = require('./discovery');
const createRoutes = require('./routes');

const app = express();
const server = http.createServer(app);

// JSON body parsing
app.use(express.json());

// CORS headers for stream files
app.use('/stream', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Serve static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Serve HLS stream files
app.use('/stream', express.static(path.join(__dirname, '..', config.streamDir)));

// Create manager instances
const cameraManager = new CameraManager();
const recorderManager = new RecorderManager();
const schedulerManager = new SchedulerManager(recorderManager);
const cameraStore = new CameraStore();
const discoveryManager = new DiscoveryManager();

// Seed default camera if store is empty
if (config.defaultCameraIp && cameraStore.listCameras().length === 0) {
  cameraStore.addCamera({
    name: 'Default Camera',
    ip: config.defaultCameraIp,
    port: 80,
    protocol: 'http',
  });
}

// Mount API routes
app.use(createRoutes(cameraManager, recorderManager, schedulerManager, cameraStore, discoveryManager));

// Handle JSON parse errors gracefully
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body.' });
  }
  next(err);
});

// Expose managers on app for testing
app.cameraManager = cameraManager;
app.recorderManager = recorderManager;
app.schedulerManager = schedulerManager;
app.cameraStore = cameraStore;
app.discoveryManager = discoveryManager;

// WebSocket server for real-time status updates
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  // Send current status on connect
  ws.send(JSON.stringify({
    type: 'status',
    camera: cameraManager.getStatus(),
    recorder: recorderManager.getStatus()
  }));
});

function broadcast(data) {
  const message = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(message);
    }
  });
}

// Forward status events to WebSocket clients
cameraManager.on('status', (status) => {
  broadcast({ type: 'camera_status', ...status });
});

recorderManager.on('status', (status) => {
  broadcast({ type: 'recorder_status', ...status });
});

// Start server only when run directly (not imported for tests)
if (require.main === module) {
  const port = config.port || 3000;
  server.listen(port, () => {
    console.log(`IP Camera App server running on http://localhost:${port}`);
  });
}

// Forward scheduler events to WebSocket clients
schedulerManager.on('schedule_start', (data) => {
  broadcast({ type: 'schedule_start', ...data });
});
schedulerManager.on('schedule_complete', (data) => {
  broadcast({ type: 'schedule_complete', ...data });
});
schedulerManager.on('schedule_error', (data) => {
  broadcast({ type: 'schedule_error', ...data });
});

module.exports = { app, server, wss, cameraManager, recorderManager, schedulerManager, cameraStore, discoveryManager };
