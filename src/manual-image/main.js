const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let controlWindow;
let presentationWindow;

function createWindows() {
  controlWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  controlWindow.loadFile(path.join(__dirname, 'control.html'));

  presentationWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  presentationWindow.loadFile(path.join(__dirname, 'presentation.html'));
}

app.whenReady().then(createWindows);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(controlWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) {
    return [];
  }
  const folder = result.filePaths[0];
  const files = fs.readdirSync(folder)
    .filter(f => /\.(png|jpe?g|gif|bmp)$/i.test(f))
    .map(f => path.join(folder, f));
  return files;
});

ipcMain.on('manual-image-show', (_event, imagePath) => {
  if (presentationWindow) {
    presentationWindow.webContents.send('manual-image-display', imagePath);
  }
});
