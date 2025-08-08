const { app, BrowserWindow, ipcMain, screen } = require('electron');
let controlWindow;
let presentationWindow;

function createWindows() {
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  const secondaryDisplay = displays.find(d => d.id !== primaryDisplay.id) || primaryDisplay;

  controlWindow = new BrowserWindow({
    x: primaryDisplay.bounds.x + 100,
    y: primaryDisplay.bounds.y + 100,
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  controlWindow.loadFile('control.html');

  presentationWindow = new BrowserWindow({
    x: secondaryDisplay.bounds.x,
    y: secondaryDisplay.bounds.y,
    width: secondaryDisplay.bounds.width,
    height: secondaryDisplay.bounds.height,
    fullscreen: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  presentationWindow.loadFile('presentation.html');

  ipcMain.on('toPresentation', (event, data) => {
    if (presentationWindow) {
      presentationWindow.webContents.send('fromControl', data);
    }
  });

  ipcMain.on('toControl', (event, data) => {
    if (controlWindow) {
      controlWindow.webContents.send('fromPresentation', data);
    }
  });
}

app.whenReady().then(() => {
  createWindows();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindows();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
