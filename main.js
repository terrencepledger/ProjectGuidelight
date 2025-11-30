const { app, BrowserWindow, ipcMain, screen, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const IPC = require('./src/shared/ipc-channels');
const { loadSettings, saveSettings } = require('./src/shared/settings');

let controlWindow;
let presentationWindow;
let settings;

function getDisplays() {
  return screen.getAllDisplays().map((display, index) => ({
    id: display.id,
    label: `Display ${index + 1} (${display.bounds.width}x${display.bounds.height})`,
    bounds: display.bounds,
    primary: display.id === screen.getPrimaryDisplay().id
  }));
}

function getPresentationDisplay() {
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  
  if (settings.presentationDisplayId) {
    const saved = displays.find(d => d.id === settings.presentationDisplayId);
    if (saved) return saved;
  }
  
  return displays.find(d => d.id !== primaryDisplay.id) || primaryDisplay;
}

function createWindows() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const presentationDisplay = getPresentationDisplay();

  controlWindow = new BrowserWindow({
    x: primaryDisplay.bounds.x + 50,
    y: primaryDisplay.bounds.y + 50,
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  controlWindow.loadFile(path.join(__dirname, 'src', 'control', 'control.html'));

  presentationWindow = new BrowserWindow({
    x: presentationDisplay.bounds.x,
    y: presentationDisplay.bounds.y,
    width: presentationDisplay.bounds.width,
    height: presentationDisplay.bounds.height,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  presentationWindow.loadFile(path.join(__dirname, 'src', 'presentation', 'presentation.html'));
  presentationWindow.setFullScreen(true);

  controlWindow.on('closed', () => {
    controlWindow = null;
    app.quit();
  });

  presentationWindow.on('closed', () => {
    presentationWindow = null;
    app.quit();
  });
}

function movePresentationToDisplay(displayId) {
  const displays = screen.getAllDisplays();
  const target = displays.find(d => d.id === displayId);
  if (!target || !presentationWindow) return;
  
  presentationWindow.setFullScreen(false);
  presentationWindow.setBounds({
    x: target.bounds.x,
    y: target.bounds.y,
    width: target.bounds.width,
    height: target.bounds.height
  });
  presentationWindow.setFullScreen(true);
  
  if (controlWindow) {
    controlWindow.webContents.send(IPC.DISPLAY_RESOLUTION_CHANGED, {
      width: target.bounds.width,
      height: target.bounds.height
    });
  }
}

function createPromptWindow(parentWindow, options) {
  return new Promise((resolve) => {
    const promptWindow = new BrowserWindow({
      parent: parentWindow,
      modal: true,
      width: 400,
      height: 160,
      resizable: false,
      minimizable: false,
      maximizable: false,
      frame: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    const title = options.title || 'Input';
    const message = options.message || '';
    const defaultValue = options.defaultValue || '';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #2a2a2a; color: #fff; padding: 20px; }
          h3 { font-size: 14px; margin-bottom: 8px; color: #ccc; }
          input { width: 100%; padding: 10px; font-size: 14px; border: 1px solid #555; border-radius: 4px; background: #333; color: #fff; margin-bottom: 16px; }
          input:focus { outline: none; border-color: #4a9eff; }
          .buttons { display: flex; justify-content: flex-end; gap: 8px; }
          button { padding: 8px 16px; font-size: 13px; border: none; border-radius: 4px; cursor: pointer; }
          .cancel { background: #555; color: #fff; }
          .cancel:hover { background: #666; }
          .ok { background: #4a9eff; color: #fff; }
          .ok:hover { background: #3a8eef; }
        </style>
      </head>
      <body>
        <h3>${title}</h3>
        <input type="text" id="input" value="${defaultValue.replace(/"/g, '&quot;')}" autofocus>
        <div class="buttons">
          <button class="cancel" onclick="cancel()">Cancel</button>
          <button class="ok" onclick="submit()">OK</button>
        </div>
        <script>
          const { ipcRenderer } = require('electron');
          const input = document.getElementById('input');
          input.select();
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') cancel();
          });
          function submit() { ipcRenderer.send('prompt-response', input.value); }
          function cancel() { ipcRenderer.send('prompt-response', null); }
        </script>
      </body>
      </html>
    `;

    promptWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    ipcMain.once('prompt-response', (event, value) => {
      promptWindow.close();
      resolve(value);
    });

    promptWindow.on('closed', () => {
      resolve(null);
    });
  });
}

function setupIPC() {
  ipcMain.handle(IPC.GET_SETTINGS, () => {
    return settings;
  });

  ipcMain.handle(IPC.SAVE_SETTINGS, (event, newSettings) => {
    settings = { ...settings, ...newSettings };
    saveSettings(settings);
    if (controlWindow) {
      controlWindow.webContents.send(IPC.SETTINGS_UPDATED, settings);
    }
    if (presentationWindow) {
      presentationWindow.webContents.send(IPC.SETTINGS_UPDATED, settings);
    }
    return true;
  });

  ipcMain.handle(IPC.GET_DISPLAYS, () => {
    return getDisplays();
  });

  ipcMain.handle(IPC.SET_PRESENTATION_DISPLAY, (event, displayId) => {
    settings.presentationDisplayId = displayId;
    saveSettings(settings);
    movePresentationToDisplay(displayId);
    return true;
  });

  ipcMain.handle(IPC.GET_DISPLAY_RESOLUTION, () => {
    const display = getPresentationDisplay();
    return {
      width: display.bounds.width,
      height: display.bounds.height
    };
  });

  ipcMain.handle(IPC.PICK_FOLDER, async () => {
    const result = await dialog.showOpenDialog(controlWindow, {
      properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle(IPC.PICK_FILE, async (event, filters) => {
    const result = await dialog.showOpenDialog(controlWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: filters || []
    });
    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }
    return result.filePaths;
  });

  ipcMain.on(IPC.SHOW_STANDBY, () => {
    if (presentationWindow) {
      presentationWindow.webContents.send(IPC.SHOW_STANDBY, settings.standbyImage);
    }
  });

  ipcMain.on(IPC.SHOW_IMAGE, (event, imagePath) => {
    if (presentationWindow) {
      presentationWindow.webContents.send(IPC.SHOW_IMAGE, imagePath);
    }
  });

  ipcMain.on(IPC.SHOW_VIDEO, (event, videoPath, startTime) => {
    if (presentationWindow) {
      presentationWindow.webContents.send(IPC.SHOW_VIDEO, videoPath, startTime);
    }
  });

  ipcMain.on(IPC.CONTROL_VIDEO, (event, command, value) => {
    if (presentationWindow) {
      presentationWindow.webContents.send(IPC.CONTROL_VIDEO, command, value);
    }
  });

  ipcMain.on(IPC.VIDEO_STATE, (event, state) => {
    if (controlWindow) {
      controlWindow.webContents.send(IPC.VIDEO_STATE, state);
    }
  });

  ipcMain.handle(IPC.SCAN_FOLDER, async (event, folderPath) => {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
    const videoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
    const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac'];
    const allExtensions = [...imageExtensions, ...videoExtensions, ...audioExtensions];
    
    try {
      const files = fs.readdirSync(folderPath);
      const mediaFiles = files
        .filter(f => allExtensions.includes(path.extname(f).toLowerCase()))
        .map(f => ({
          path: path.join(folderPath, f),
          name: f,
          type: imageExtensions.includes(path.extname(f).toLowerCase()) ? 'image' :
                videoExtensions.includes(path.extname(f).toLowerCase()) ? 'video' : 'audio'
        }));
      return mediaFiles;
    } catch (err) {
      console.error('Error scanning folder:', err);
      return [];
    }
  });

  ipcMain.handle(IPC.GET_MEDIA_LIBRARY, () => {
    return settings.mediaLibrary || [];
  });

  ipcMain.handle(IPC.ADD_TO_LIBRARY, (event, files) => {
    const existing = new Set(settings.mediaLibrary.map(f => f.path));
    const newFiles = files.filter(f => !existing.has(f.path));
    settings.mediaLibrary = [...settings.mediaLibrary, ...newFiles];
    saveSettings(settings);
    return settings.mediaLibrary;
  });

  ipcMain.handle(IPC.REMOVE_FROM_LIBRARY, (event, filePath) => {
    settings.mediaLibrary = settings.mediaLibrary.filter(f => f.path !== filePath);
    saveSettings(settings);
    return settings.mediaLibrary;
  });

  ipcMain.handle(IPC.UPDATE_LIBRARY_ITEM, (event, filePath, updates) => {
    const item = settings.mediaLibrary.find(f => f.path === filePath);
    if (item) {
      Object.assign(item, updates);
      saveSettings(settings);
    }
    return settings.mediaLibrary;
  });

  ipcMain.handle(IPC.CONFIRM_DIALOG, async (event, options) => {
    const result = await dialog.showMessageBox(controlWindow, {
      type: options.type || 'question',
      buttons: options.buttons || ['Cancel', 'OK'],
      defaultId: 1,
      cancelId: 0,
      title: options.title || 'Confirm',
      message: options.message || 'Are you sure?'
    });
    return result.response === 1;
  });

  ipcMain.handle(IPC.PROMPT_DIALOG, async (event, options) => {
    return await createPromptWindow(controlWindow, options);
  });

  ipcMain.handle(IPC.GET_SLIDESHOW_PRESETS, () => {
    return settings.slideshowPresets || [];
  });

  ipcMain.handle(IPC.SAVE_SLIDESHOW_PRESET, (event, preset) => {
    if (!settings.slideshowPresets) {
      settings.slideshowPresets = [];
    }
    const index = settings.slideshowPresets.findIndex(p => p.id === preset.id);
    if (index >= 0) {
      settings.slideshowPresets[index] = preset;
    } else {
      if (settings.slideshowPresets.length >= 3) {
        return { error: 'Maximum of 3 presets allowed' };
      }
      settings.slideshowPresets.push(preset);
    }
    settings.activePresetId = preset.id;
    saveSettings(settings);
    return { success: true, presets: settings.slideshowPresets };
  });

  ipcMain.handle(IPC.DELETE_SLIDESHOW_PRESET, (event, presetId) => {
    if (!settings.slideshowPresets) return { success: true, presets: [] };
    settings.slideshowPresets = settings.slideshowPresets.filter(p => p.id !== presetId);
    if (settings.activePresetId === presetId) {
      settings.activePresetId = settings.slideshowPresets[0]?.id || null;
    }
    saveSettings(settings);
    return { success: true, presets: settings.slideshowPresets };
  });

  ipcMain.on(IPC.SET_TRANSITION, (event, transition) => {
    if (presentationWindow) {
      presentationWindow.webContents.send(IPC.SET_TRANSITION, transition);
    }
  });

  ipcMain.handle(IPC.SAVE_THUMBNAIL, async (event, videoPath, dataUrl) => {
    try {
      const thumbnailDir = path.join(app.getPath('userData'), 'thumbnails');
      if (!fs.existsSync(thumbnailDir)) {
        fs.mkdirSync(thumbnailDir, { recursive: true });
      }
      const hash = Buffer.from(videoPath).toString('base64').replace(/[/+=]/g, '_').substring(0, 32);
      const thumbnailPath = path.join(thumbnailDir, `${hash}.jpg`);
      const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(thumbnailPath, base64Data, 'base64');
      return thumbnailPath;
    } catch (err) {
      console.error('Error saving thumbnail:', err);
      return null;
    }
  });

  ipcMain.handle(IPC.GET_THUMBNAIL, async (event, videoPath) => {
    try {
      const thumbnailDir = path.join(app.getPath('userData'), 'thumbnails');
      const hash = Buffer.from(videoPath).toString('base64').replace(/[/+=]/g, '_').substring(0, 32);
      const thumbnailPath = path.join(thumbnailDir, `${hash}.jpg`);
      if (fs.existsSync(thumbnailPath)) {
        return thumbnailPath;
      }
      return null;
    } catch (err) {
      return null;
    }
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  settings = loadSettings();
  createWindows();
  setupIPC();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindows();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
