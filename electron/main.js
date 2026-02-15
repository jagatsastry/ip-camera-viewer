const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let expressServer = null;

/**
 * In a sandboxed MAS app, we can't write to the app bundle directory.
 * Use the user data directory for recordings and stream segments.
 */
function setupAppPaths() {
  const userData = app.getPath('userData');
  const recordingsDir = path.join(userData, 'recordings');
  const streamDir = path.join(userData, 'stream');

  // Ensure directories exist
  for (const dir of [recordingsDir, streamDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Override config paths before the server imports config.json
  const config = require(path.join(__dirname, '..', 'config.json'));
  config.recordingsDir = recordingsDir;
  config.streamDir = streamDir;

  return { recordingsDir, streamDir };
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#1a1a2e',
    title: 'IP Camera Viewer',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', () => {
  // Set up sandbox-safe paths before importing the server
  setupAppPaths();

  // Import the Express server — since require.main !== module,
  // it won't auto-listen. We start it ourselves on a random port.
  const { server } = require(path.join(__dirname, '..', 'src', 'server.js'));

  expressServer = server;

  server.listen(0, () => {
    const port = server.address().port;
    console.log(`Express server running on http://localhost:${port}`);
    createWindow(port);
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (expressServer) {
    expressServer.close(() => {
      console.log('Express server shut down.');
    });
  }
});

app.on('activate', () => {
  if (mainWindow === null && expressServer) {
    const port = expressServer.address().port;
    createWindow(port);
  }
});
