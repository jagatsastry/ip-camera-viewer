/**
 * Resolve the path to the FFmpeg binary.
 *
 * Priority:
 * 1. Bundled binary (inside packaged Electron app via extraResources)
 * 2. ffmpeg-static npm package (development / web server mode)
 * 3. System PATH fallback (config.json ffmpegPath, defaults to "ffmpeg")
 */
const path = require('path');
const fs = require('fs');

function getFfmpegPath() {
  // 1. Check for bundled binary in Electron packaged app
  if (isPackagedElectron()) {
    const resourcesPath = process.resourcesPath;
    const bundledPath = path.join(resourcesPath, 'ffmpeg');
    if (fs.existsSync(bundledPath)) {
      return bundledPath;
    }
  }

  // 2. Try ffmpeg-static (available in dev and when installed as dependency)
  try {
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
      return ffmpegStatic;
    }
  } catch (_) {
    // ffmpeg-static not installed, fall through
  }

  // 3. Fall back to system PATH / config
  try {
    const config = require('../config.json');
    return config.ffmpegPath || 'ffmpeg';
  } catch (_) {
    return 'ffmpeg';
  }
}

function isPackagedElectron() {
  // In a packaged Electron app, app.isPackaged is true and process.resourcesPath exists
  try {
    const { app } = require('electron');
    return app && app.isPackaged;
  } catch (_) {
    // Not in Electron
    return false;
  }
}

module.exports = getFfmpegPath;
