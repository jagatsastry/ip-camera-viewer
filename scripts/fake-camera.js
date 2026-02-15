#!/usr/bin/env node
/**
 * Fake IP camera server for testing.
 *
 * Simulates any camera brand from the fingerprint database by serving
 * MJPEG streams and snapshots on all known URL paths for that brand.
 * Uses ffmpeg to generate a test pattern with brand name + timestamp overlay.
 *
 * Usage:
 *   node scripts/fake-camera.js                    # All brands on port 8554
 *   node scripts/fake-camera.js --brand dlink      # D-Link only
 *   node scripts/fake-camera.js --brand axis       # Axis only
 *   node scripts/fake-camera.js --port 9000        # Custom port
 *   node scripts/fake-camera.js --list             # List available brands
 *   node scripts/fake-camera.js --no-ffmpeg        # Static JPEG (no ffmpeg needed)
 *
 * Brands: dlink, axis, foscam, hikvision, dahua, reolink, tplink, wansview, tenvis, generic
 */

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

// Load fingerprints
const fingerprints = require(path.join(__dirname, '..', 'src', 'fingerprints'));

// Parse args
const args = process.argv.slice(2);
let port = 8554;
let brandFilter = null;
let noFfmpeg = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) { port = parseInt(args[i + 1], 10); i++; }
  else if (args[i] === '--brand' && args[i + 1]) { brandFilter = args[i + 1]; i++; }
  else if (args[i] === '--no-ffmpeg') { noFfmpeg = true; }
  else if (args[i] === '--list') {
    console.log('Available brands:');
    fingerprints.brands.forEach((b) => {
      console.log(`  ${b.id.padEnd(12)} ${b.name.padEnd(20)} ${b.notes}`);
    });
    process.exit(0);
  }
  else if (args[i] === '--help' || args[i] === '-h') {
    console.log('Usage: node scripts/fake-camera.js [--brand ID] [--port PORT] [--no-ffmpeg] [--list]');
    process.exit(0);
  }
}

// Build route table from fingerprint database
const brands = brandFilter
  ? fingerprints.brands.filter((b) => b.id === brandFilter)
  : fingerprints.brands;

if (brands.length === 0) {
  console.error(`Unknown brand: ${brandFilter}. Use --list to see available brands.`);
  process.exit(1);
}

// Collect all MJPEG, snapshot, and audio routes
const mjpegRoutes = new Map();   // path -> brand name
const snapshotRoutes = new Map();
const audioRoutes = new Map();

for (const brand of brands) {
  for (const p of brand.mjpegPaths) { mjpegRoutes.set(p, brand.name); }
  for (const p of brand.snapshotPaths) { snapshotRoutes.set(p, brand.name); }
  for (const p of brand.audioPaths) { audioRoutes.set(p, brand.name); }
}

/**
 * Generate a 1x1 red JPEG as a minimal static placeholder (no ffmpeg).
 */
function minimalJpeg() {
  // Smallest valid JPEG: 1x1 red pixel
  return Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
    0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
    0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
    0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
    0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03,
    0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D,
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
    0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08,
    0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72,
    0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45,
    0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
    0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x73, 0x74, 0x75,
    0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3,
    0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6,
    0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9,
    0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
    0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4,
    0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01,
    0x00, 0x00, 0x3F, 0x00, 0x7B, 0x94, 0x11, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xD9
  ]);
}

/**
 * Spawn ffmpeg to produce an MJPEG stream with a brand-name overlay.
 */
function spawnMjpegFfmpeg(brandLabel) {
  const text = brandLabel.replace(/'/g, "\\'");
  return spawn('ffmpeg', [
    '-f', 'lavfi',
    '-i', `testsrc=size=640x480:rate=10,drawtext=text='${text} %{localtime}':fontsize=20:fontcolor=white:x=10:y=10:box=1:boxcolor=black@0.5:boxborderw=4`,
    '-f', 'mjpeg',
    '-q:v', '5',
    '-'
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
}

/**
 * Pipe ffmpeg MJPEG output as multipart HTTP response.
 */
function serveMjpegStream(res, req, brandLabel) {
  const boundary = 'frameboundary';
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=' + boundary,
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  if (noFfmpeg) {
    // Static mode: send one frame per second
    const frame = minimalJpeg();
    const interval = setInterval(() => {
      try {
        res.write(`--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
        res.write(frame);
        res.write('\r\n');
      } catch (_) { clearInterval(interval); }
    }, 1000);
    req.on('close', () => clearInterval(interval));
    return;
  }

  const ffmpeg = spawnMjpegFfmpeg(brandLabel);
  let buffer = Buffer.alloc(0);
  const SOI = Buffer.from([0xff, 0xd8]);
  const EOI = Buffer.from([0xff, 0xd9]);

  ffmpeg.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    let soiIdx, eoiIdx;
    while ((soiIdx = buffer.indexOf(SOI)) !== -1 && (eoiIdx = buffer.indexOf(EOI, soiIdx)) !== -1) {
      const frame = buffer.slice(soiIdx, eoiIdx + 2);
      buffer = buffer.slice(eoiIdx + 2);
      try {
        res.write(`--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
        res.write(frame);
        res.write('\r\n');
      } catch (_) { /* client disconnected */ }
    }
  });

  ffmpeg.stderr.on('data', () => {});
  ffmpeg.on('error', () => {});
  req.on('close', () => { try { ffmpeg.kill('SIGTERM'); } catch (_) {} });
}

/**
 * Serve a single JPEG snapshot.
 */
function serveSnapshot(res, brandLabel) {
  if (noFfmpeg) {
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    res.end(minimalJpeg());
    return;
  }

  const text = brandLabel.replace(/'/g, "\\'");
  const ffmpeg = spawn('ffmpeg', [
    '-f', 'lavfi',
    '-i', `testsrc=size=640x480:rate=1,drawtext=text='${text} SNAPSHOT':fontsize=20:fontcolor=white:x=10:y=10`,
    '-frames:v', '1',
    '-f', 'mjpeg',
    '-'
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  const chunks = [];
  ffmpeg.stdout.on('data', (c) => chunks.push(c));
  ffmpeg.on('close', () => {
    const img = Buffer.concat(chunks);
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': img.length });
    res.end(img);
  });
  ffmpeg.stderr.on('data', () => {});
  ffmpeg.on('error', () => {
    res.writeHead(500);
    res.end('ffmpeg error');
  });
}

/**
 * Serve fake audio.
 */
function serveAudio(res, req) {
  if (noFfmpeg) {
    res.writeHead(200, { 'Content-Type': 'audio/wav' });
    res.end(Buffer.alloc(44)); // minimal WAV header
    return;
  }

  res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-cache' });
  const ffmpeg = spawn('ffmpeg', [
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-f', 'wav', '-'
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  ffmpeg.stdout.pipe(res);
  ffmpeg.stderr.on('data', () => {});
  ffmpeg.on('error', () => {});
  req.on('close', () => { try { ffmpeg.kill('SIGTERM'); } catch (_) {} });
}

// Create HTTP server
const server = http.createServer((req, res) => {
  const fullUrl = req.url;             // includes query params
  const urlPath = fullUrl.split('?')[0]; // strip query params

  // Check MJPEG routes (try full URL first, then path-only)
  if (mjpegRoutes.has(fullUrl)) {
    return serveMjpegStream(res, req, mjpegRoutes.get(fullUrl));
  }
  if (mjpegRoutes.has(urlPath)) {
    return serveMjpegStream(res, req, mjpegRoutes.get(urlPath));
  }

  // Check snapshot routes (try full URL first, then path-only)
  if (snapshotRoutes.has(fullUrl)) {
    return serveSnapshot(res, snapshotRoutes.get(fullUrl));
  }
  if (snapshotRoutes.has(urlPath)) {
    return serveSnapshot(res, snapshotRoutes.get(urlPath));
  }

  // Check audio routes (try full URL first, then path-only)
  if (audioRoutes.has(fullUrl)) {
    return serveAudio(res, req);
  }
  if (audioRoutes.has(urlPath)) {
    return serveAudio(res, req);
  }

  // Root: show available endpoints
  if (urlPath === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    let html = '<html><body style="background:#1a1a2e;color:#eee;font-family:monospace;padding:20px;">';
    html += '<h1>Fake Camera Server</h1>';
    html += `<p>Port: ${port} | Mode: ${noFfmpeg ? 'static (no ffmpeg)' : 'live (ffmpeg)'}</p>`;

    html += '<h2>MJPEG Streams</h2><ul>';
    for (const [p, brand] of mjpegRoutes) {
      html += `<li><a href="${p}" style="color:#4da6ff;">${p}</a> — ${brand}</li>`;
    }
    html += '</ul>';

    html += '<h2>Snapshots</h2><ul>';
    for (const [p, brand] of snapshotRoutes) {
      html += `<li><a href="${p}" style="color:#4da6ff;">${p}</a> — ${brand}</li>`;
    }
    html += '</ul>';

    if (audioRoutes.size > 0) {
      html += '<h2>Audio</h2><ul>';
      for (const [p, brand] of audioRoutes) {
        html += `<li><a href="${p}" style="color:#4da6ff;">${p}</a> — ${brand}</li>`;
      }
      html += '</ul>';
    }

    html += '</body></html>';
    return res.end(html);
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(port, () => {
  console.log(`\nFake camera server running on http://localhost:${port}\n`);
  console.log('Serving endpoints for:');
  const brandNames = new Set();
  for (const b of brands) brandNames.add(b.name);
  for (const name of brandNames) console.log(`  • ${name}`);
  console.log(`\nMJPEG streams: ${mjpegRoutes.size} endpoints`);
  console.log(`Snapshots:     ${snapshotRoutes.size} endpoints`);
  console.log(`Audio:         ${audioRoutes.size} endpoints`);
  console.log(`\nOpen http://localhost:${port} in a browser to see all endpoints.`);
  console.log('Press Ctrl+C to stop.\n');
});
