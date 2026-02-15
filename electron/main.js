const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow = null;
let expressServer = null;

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#1a1a2e',
    title: 'IP Camera Viewer',
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
  // On macOS, apps typically stay active until Cmd+Q.
  // For this app, we quit when all windows are closed.
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
  // On macOS, re-create a window when dock icon is clicked and no windows exist.
  if (mainWindow === null && expressServer) {
    const port = expressServer.address().port;
    createWindow(port);
  }
});
