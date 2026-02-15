#!/bin/bash
#
# Fake IP camera stream for testing.
# Generates a test pattern with a clock overlay and serves it as an MJPEG HTTP stream.
#
# Usage:
#   ./scripts/fake-camera.sh              # MJPEG on port 8554
#   ./scripts/fake-camera.sh rtsp         # RTSP on port 8554 (requires ffmpeg + ffserver or mediamtx)
#   ./scripts/fake-camera.sh mjpeg 9000   # MJPEG on custom port
#
# Then connect to:
#   MJPEG: http://localhost:8554/video/mjpg.cgi
#   RTSP:  rtsp://localhost:8554/stream

set -e

MODE="${1:-mjpeg}"
PORT="${2:-8554}"

echo "Starting fake camera ($MODE) on port $PORT..."

if [ "$MODE" = "mjpeg" ]; then
  # Serve MJPEG over HTTP using ffmpeg + a simple HTTP response.
  # This creates an MJPEG stream that mimics a real IP camera's /video/mjpg.cgi endpoint.
  # Use socat or a tiny Node server to serve it.

  node -e "
    const http = require('http');
    const { spawn } = require('child_process');

    const server = http.createServer((req, res) => {
      if (req.url === '/video/mjpg.cgi' || req.url === '/') {
        const boundary = 'frameboundary';
        res.writeHead(200, {
          'Content-Type': 'multipart/x-mixed-replace; boundary=' + boundary,
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        const ffmpeg = spawn('ffmpeg', [
          '-f', 'lavfi',
          '-i', 'testsrc=size=640x480:rate=15,drawtext=text=%{localtime}:fontsize=24:fontcolor=white:x=10:y=10',
          '-f', 'mjpeg',
          '-q:v', '5',
          '-'
        ], { stdio: ['pipe', 'pipe', 'pipe'] });

        let buffer = Buffer.alloc(0);
        const SOI = Buffer.from([0xff, 0xd8]);
        const EOI = Buffer.from([0xff, 0xd9]);

        ffmpeg.stdout.on('data', (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          let soiIdx, eoiIdx;
          while ((soiIdx = buffer.indexOf(SOI)) !== -1 && (eoiIdx = buffer.indexOf(EOI, soiIdx)) !== -1) {
            const frame = buffer.slice(soiIdx, eoiIdx + 2);
            buffer = buffer.slice(eoiIdx + 2);
            res.write('--' + boundary + '\r\n');
            res.write('Content-Type: image/jpeg\r\n');
            res.write('Content-Length: ' + frame.length + '\r\n\r\n');
            res.write(frame);
            res.write('\r\n');
          }
        });

        req.on('close', () => { ffmpeg.kill('SIGTERM'); });
        ffmpeg.on('error', () => {});
      } else if (req.url === '/audio.cgi') {
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-cache' });
        const ffmpeg = spawn('ffmpeg', [
          '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
          '-f', 'wav', '-'
        ], { stdio: ['pipe', 'pipe', 'pipe'] });
        ffmpeg.stdout.pipe(res);
        req.on('close', () => { ffmpeg.kill('SIGTERM'); });
        ffmpeg.on('error', () => {});
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen($PORT, () => {
      console.log('Fake MJPEG camera running at http://localhost:$PORT/video/mjpg.cgi');
      console.log('Fake audio at http://localhost:$PORT/audio.cgi');
      console.log('Connect with: http://localhost:$PORT');
      console.log('Press Ctrl+C to stop.');
    });
  "

elif [ "$MODE" = "rtsp" ]; then
  echo "RTSP test stream requires mediamtx (formerly rtsp-simple-server)."
  echo ""
  echo "Install:  brew install mediamtx"
  echo "Then run: mediamtx &"
  echo ""
  echo "Publishing test pattern to rtsp://localhost:$PORT/stream ..."
  ffmpeg \
    -f lavfi -i "testsrc=size=640x480:rate=15,drawtext=text=%{localtime}:fontsize=24:fontcolor=white:x=10:y=10" \
    -f lavfi -i "sine=frequency=440:sample_rate=44100" \
    -c:v libx264 -preset ultrafast -tune zerolatency \
    -c:a aac -b:a 128k \
    -f rtsp "rtsp://localhost:$PORT/stream"

else
  echo "Unknown mode: $MODE"
  echo "Usage: $0 [mjpeg|rtsp] [port]"
  exit 1
fi
