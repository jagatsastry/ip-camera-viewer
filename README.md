# IP Camera Viewer

A self-hosted web application for viewing, recording, and managing IP camera streams. Built with Node.js and designed for local network surveillance setups.

![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![Tests](https://img.shields.io/badge/tests-307%20passing-brightgreen)

## Features

- **Live Streaming** — View MJPEG, RTSP, RTMP, and HTTP camera feeds directly in the browser
- **Recording** — Record camera streams to MP4 with one click, with optional audio capture
- **Audio Denoising** — Real-time FFT-based noise reduction on camera audio (bandpass + noise floor filtering)
- **Scheduled Recording** — Set up recurring recording schedules by day of week and time
- **Multi-Camera Management** — Save and switch between multiple camera configurations
- **Real-Time Status** — WebSocket-based live updates for stream and recording state
- **Recording Playback** — Browse, play, download, and delete recordings from the web UI
- **Health Monitoring** — Automatic detection of unreachable cameras with graceful recovery
- **Responsive UI** — Dark-themed interface that works on desktop and mobile

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [FFmpeg](https://ffmpeg.org/) installed and available on `PATH`

## Quick Start

```bash
git clone https://github.com/jagatsastry/ip-camera-viewer.git
cd ip-camera-viewer
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. Enter your camera's address in the URL field (e.g. `admin:password@192.168.1.100`)
2. Select the protocol (Auto, HTTP, RTSP, or RTMP)
3. Click **Start Stream** to begin viewing
4. Use the **Record** button to save footage to disk

### Saving Cameras

Switch to the **Cameras** tab in the sidebar to save camera configurations for quick access. Each saved camera stores its IP, port, credentials, and protocol.

### Scheduled Recording

Switch to the **Schedules** tab to create recurring recording schedules. Configure the camera URL, start time, duration, and which days of the week to record.

## Configuration

Edit `config.json` to customize the application:

```json
{
  "port": 3000,
  "defaultCameraIp": "192.168.1.100",
  "recordingsDir": "./recordings",
  "streamDir": "./stream",
  "ffmpegPath": "ffmpeg",
  "hlsSegmentDuration": 2,
  "hlsListSize": 5
}
```

| Option | Description | Default |
|---|---|---|
| `port` | Server listen port | `3000` |
| `recordingsDir` | Directory for saved recordings | `./recordings` |
| `streamDir` | Temporary directory for HLS segments | `./stream` |
| `ffmpegPath` | Path to FFmpeg binary | `ffmpeg` |
| `hlsSegmentDuration` | HLS segment length in seconds | `2` |
| `hlsListSize` | Number of HLS segments in playlist | `5` |

## API Reference

### Stream

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/stream/start` | Start streaming from a camera URL |
| `POST` | `/api/stream/stop` | Stop the active stream |
| `GET` | `/api/stream/mjpeg` | MJPEG proxy endpoint (pipe to `<img>`) |
| `GET` | `/api/stream/audio` | Denoised audio proxy (MP3) |
| `GET` | `/api/status` | Get camera and recorder status |

### Recording

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/record/start` | Start recording (body: `{ cameraUrl, includeAudio }`) |
| `POST` | `/api/record/stop` | Stop recording |
| `GET` | `/api/recordings` | List all saved recordings |
| `GET` | `/api/recordings/:filename` | Download a recording |
| `DELETE` | `/api/recordings/:filename` | Delete a recording |

### Schedules

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/schedules` | List all schedules |
| `POST` | `/api/schedules` | Create a schedule |
| `PUT` | `/api/schedules/:id` | Update a schedule |
| `DELETE` | `/api/schedules/:id` | Delete a schedule |

### Cameras

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/cameras` | List saved cameras |
| `POST` | `/api/cameras` | Add a camera |
| `PUT` | `/api/cameras/:id` | Update a camera |
| `DELETE` | `/api/cameras/:id` | Delete a camera |

## Architecture

```
ip-camera-viewer/
├── src/
│   ├── server.js          # Express + WebSocket server
│   ├── camera.js          # Stream management (MJPEG proxy, HLS via FFmpeg)
│   ├── recorder.js        # Recording to MP4 (video-only or video+audio)
│   ├── scheduler.js       # Cron-like scheduled recording
│   ├── cameras-store.js   # Camera configuration persistence
│   └── routes.js          # REST API endpoints
├── public/
│   ├── index.html         # Single-page application
│   ├── css/style.css      # Dark theme UI
│   └── js/app.js          # Frontend logic
├── config.json            # Application settings
└── tests/                 # Jest test suites
```

### How Streaming Works

- **MJPEG cameras** (most common for home IP cameras): The server proxies the raw MJPEG stream directly to the browser via an `<img>` tag. No transcoding required.
- **RTSP/RTMP cameras**: FFmpeg transcodes the stream into HLS segments, served as static files.
- **Audio**: Camera audio is fetched from `/audio.cgi`, passed through FFmpeg's `afftdn` denoiser with a 200Hz-3kHz bandpass filter, and streamed as MP3.

## Testing

```bash
npm test
```

Runs 307 tests across 7 test suites covering the camera manager, recorder, scheduler, camera store, API routes, frontend, and integration scenarios.

## Supported Cameras

Tested with:
- D-Link DCS-932LB (HTTP MJPEG)

Should work with any IP camera that exposes an MJPEG, RTSP, or RTMP stream.

## License

[MIT](LICENSE)
