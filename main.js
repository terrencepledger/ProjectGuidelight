require('dotenv').config();
const { app, BrowserWindow, ipcMain, screen, dialog, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const IPC = require('./src/shared/ipc-channels');
const { initSettings, loadSettings, saveSettings } = require('./src/shared/settings');

let controlWindow;
let presentationWindow;
let settings;
let defaultStandbyPath;

function getDefaultStandbyPath() {
  return path.join(__dirname, 'assets', 'defaults', 'default-standby.png');
}

function getDefaultScriptureBackgrounds() {
  const defaultsDir = path.join(__dirname, 'assets', 'defaults');
  return [
    { id: 'scripture-bg-cross', name: 'Cross at Sunset', path: path.join(defaultsDir, 'scripture-bg-cross.jpg') },
    { id: 'scripture-bg-bible', name: 'Open Bible', path: path.join(defaultsDir, 'scripture-bg-bible.jpg') },
    { id: 'scripture-bg-church', name: 'Church Silhouette', path: path.join(defaultsDir, 'scripture-bg-church.jpg') }
  ].filter(bg => fs.existsSync(bg.path));
}

function getDefaultQuickSlideBackgrounds() {
  const defaultsDir = path.join(__dirname, 'assets', 'defaults');
  return [
    { id: 'scripture-bg-cross', name: 'Cross at Sunset', path: path.join(defaultsDir, 'scripture-bg-cross.jpg') },
    { id: 'scripture-bg-bible', name: 'Open Bible', path: path.join(defaultsDir, 'scripture-bg-bible.jpg') },
    { id: 'scripture-bg-church', name: 'Church Silhouette', path: path.join(defaultsDir, 'scripture-bg-church.jpg') }
  ].filter(bg => fs.existsSync(bg.path));
}

function getEffectiveStandbyPath() {
  if (settings.standbyImage && fs.existsSync(settings.standbyImage)) {
    return settings.standbyImage;
  }
  return getDefaultStandbyPath();
}

function validatePath(filePath) {
  if (!filePath) return false;
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function validateAllPaths() {
  const brokenItems = [];
  
  if (settings.standbyImage && !validatePath(settings.standbyImage)) {
    brokenItems.push({ type: 'standby', path: settings.standbyImage });
  }
  
  settings.mediaLibrary.forEach((item, index) => {
    if (!validatePath(item.path)) {
      brokenItems.push({ type: 'library', path: item.path, index });
    }
  });
  
  settings.slideshowPresets.forEach((preset) => {
    preset.images.forEach((img, imgIndex) => {
      if (!validatePath(img.path)) {
        brokenItems.push({ 
          type: 'preset', 
          presetId: preset.id, 
          presetName: preset.name,
          path: img.path, 
          index: imgIndex 
        });
      }
    });
  });
  
  return brokenItems;
}

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
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');

  controlWindow = new BrowserWindow({
    x: primaryDisplay.bounds.x + 50,
    y: primaryDisplay.bounds.y + 50,
    width: 1200,
    height: 800,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  controlWindow.loadFile(path.join(__dirname, 'src', 'control', 'control.html'));
  
  controlWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      controlWindow.webContents.toggleDevTools();
    }
  });

  presentationWindow = new BrowserWindow({
    x: presentationDisplay.bounds.x,
    y: presentationDisplay.bounds.y,
    width: presentationDisplay.bounds.width,
    height: presentationDisplay.bounds.height,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    icon: iconPath,
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

const BOOK_ALIASES = {
  'genesis': 'GEN', 'gen': 'GEN', 'gn': 'GEN',
  'exodus': 'EXO', 'exod': 'EXO', 'ex': 'EXO',
  'leviticus': 'LEV', 'lev': 'LEV', 'lv': 'LEV',
  'numbers': 'NUM', 'num': 'NUM', 'nm': 'NUM',
  'deuteronomy': 'DEU', 'deut': 'DEU', 'dt': 'DEU',
  'joshua': 'JOS', 'josh': 'JOS',
  'judges': 'JDG', 'judg': 'JDG', 'jdg': 'JDG',
  'ruth': 'RUT', 'ru': 'RUT',
  '1 samuel': '1SA', '1samuel': '1SA', '1sam': '1SA', '1 sam': '1SA', '1sa': '1SA',
  '2 samuel': '2SA', '2samuel': '2SA', '2sam': '2SA', '2 sam': '2SA', '2sa': '2SA',
  '1 kings': '1KI', '1kings': '1KI', '1kgs': '1KI', '1 kgs': '1KI', '1ki': '1KI',
  '2 kings': '2KI', '2kings': '2KI', '2kgs': '2KI', '2 kgs': '2KI', '2ki': '2KI',
  '1 chronicles': '1CH', '1chronicles': '1CH', '1chr': '1CH', '1 chr': '1CH', '1ch': '1CH',
  '2 chronicles': '2CH', '2chronicles': '2CH', '2chr': '2CH', '2 chr': '2CH', '2ch': '2CH',
  'ezra': 'EZR', 'ezr': 'EZR',
  'nehemiah': 'NEH', 'neh': 'NEH',
  'esther': 'EST', 'esth': 'EST', 'est': 'EST',
  'job': 'JOB',
  'psalms': 'PSA', 'psalm': 'PSA', 'ps': 'PSA', 'psa': 'PSA',
  'proverbs': 'PRO', 'prov': 'PRO', 'pr': 'PRO', 'pro': 'PRO',
  'ecclesiastes': 'ECC', 'eccl': 'ECC', 'ecc': 'ECC', 'eccles': 'ECC',
  'song of solomon': 'SNG', 'song': 'SNG', 'sos': 'SNG', 'sng': 'SNG', 'songs': 'SNG',
  'isaiah': 'ISA', 'isa': 'ISA', 'is': 'ISA',
  'jeremiah': 'JER', 'jer': 'JER',
  'lamentations': 'LAM', 'lam': 'LAM',
  'ezekiel': 'EZK', 'ezek': 'EZK', 'ezk': 'EZK',
  'daniel': 'DAN', 'dan': 'DAN', 'dn': 'DAN',
  'hosea': 'HOS', 'hos': 'HOS',
  'joel': 'JOL', 'jol': 'JOL',
  'amos': 'AMO', 'am': 'AMO', 'amo': 'AMO',
  'obadiah': 'OBA', 'obad': 'OBA', 'ob': 'OBA', 'oba': 'OBA',
  'jonah': 'JON', 'jon': 'JON',
  'micah': 'MIC', 'mic': 'MIC',
  'nahum': 'NAM', 'nah': 'NAM', 'nam': 'NAM',
  'habakkuk': 'HAB', 'hab': 'HAB',
  'zephaniah': 'ZEP', 'zeph': 'ZEP', 'zep': 'ZEP',
  'haggai': 'HAG', 'hag': 'HAG',
  'zechariah': 'ZEC', 'zech': 'ZEC', 'zec': 'ZEC',
  'malachi': 'MAL', 'mal': 'MAL',
  'matthew': 'MAT', 'matt': 'MAT', 'mt': 'MAT', 'mat': 'MAT',
  'mark': 'MRK', 'mk': 'MRK', 'mrk': 'MRK',
  'luke': 'LUK', 'lk': 'LUK', 'luk': 'LUK',
  'john': 'JHN', 'jn': 'JHN', 'jhn': 'JHN',
  'acts': 'ACT', 'act': 'ACT',
  'romans': 'ROM', 'rom': 'ROM', 'ro': 'ROM',
  '1 corinthians': '1CO', '1corinthians': '1CO', '1cor': '1CO', '1 cor': '1CO', '1co': '1CO',
  '2 corinthians': '2CO', '2corinthians': '2CO', '2cor': '2CO', '2 cor': '2CO', '2co': '2CO',
  'galatians': 'GAL', 'gal': 'GAL',
  'ephesians': 'EPH', 'eph': 'EPH',
  'philippians': 'PHP', 'phil': 'PHP', 'php': 'PHP',
  'colossians': 'COL', 'col': 'COL',
  '1 thessalonians': '1TH', '1thessalonians': '1TH', '1thess': '1TH', '1 thess': '1TH', '1th': '1TH',
  '2 thessalonians': '2TH', '2thessalonians': '2TH', '2thess': '2TH', '2 thess': '2TH', '2th': '2TH',
  '1 timothy': '1TI', '1timothy': '1TI', '1tim': '1TI', '1 tim': '1TI', '1ti': '1TI',
  '2 timothy': '2TI', '2timothy': '2TI', '2tim': '2TI', '2 tim': '2TI', '2ti': '2TI',
  'titus': 'TIT', 'tit': 'TIT',
  'philemon': 'PHM', 'phlm': 'PHM', 'phm': 'PHM',
  'hebrews': 'HEB', 'heb': 'HEB',
  'james': 'JAS', 'jas': 'JAS', 'jm': 'JAS',
  '1 peter': '1PE', '1peter': '1PE', '1pet': '1PE', '1 pet': '1PE', '1pe': '1PE',
  '2 peter': '2PE', '2peter': '2PE', '2pet': '2PE', '2 pet': '2PE', '2pe': '2PE',
  '1 john': '1JN', '1john': '1JN', '1jn': '1JN',
  '2 john': '2JN', '2john': '2JN', '2jn': '2JN',
  '3 john': '3JN', '3john': '3JN', '3jn': '3JN',
  'jude': 'JUD', 'jud': 'JUD',
  'revelation': 'REV', 'rev': 'REV', 'rv': 'REV', 'revelations': 'REV'
};

const BOOK_ORDER = [
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA',
  '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO',
  'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO',
  'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL',
  'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH',
  'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS',
  '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV'
];

const BOOK_NAMES = {
  'GEN': 'Genesis', 'EXO': 'Exodus', 'LEV': 'Leviticus', 'NUM': 'Numbers', 'DEU': 'Deuteronomy',
  'JOS': 'Joshua', 'JDG': 'Judges', 'RUT': 'Ruth', '1SA': '1 Samuel', '2SA': '2 Samuel',
  '1KI': '1 Kings', '2KI': '2 Kings', '1CH': '1 Chronicles', '2CH': '2 Chronicles',
  'EZR': 'Ezra', 'NEH': 'Nehemiah', 'EST': 'Esther', 'JOB': 'Job', 'PSA': 'Psalms',
  'PRO': 'Proverbs', 'ECC': 'Ecclesiastes', 'SNG': 'Song of Solomon', 'ISA': 'Isaiah',
  'JER': 'Jeremiah', 'LAM': 'Lamentations', 'EZK': 'Ezekiel', 'DAN': 'Daniel', 'HOS': 'Hosea',
  'JOL': 'Joel', 'AMO': 'Amos', 'OBA': 'Obadiah', 'JON': 'Jonah', 'MIC': 'Micah',
  'NAM': 'Nahum', 'HAB': 'Habakkuk', 'ZEP': 'Zephaniah', 'HAG': 'Haggai', 'ZEC': 'Zechariah',
  'MAL': 'Malachi', 'MAT': 'Matthew', 'MRK': 'Mark', 'LUK': 'Luke', 'JHN': 'John',
  'ACT': 'Acts', 'ROM': 'Romans', '1CO': '1 Corinthians', '2CO': '2 Corinthians',
  'GAL': 'Galatians', 'EPH': 'Ephesians', 'PHP': 'Philippians', 'COL': 'Colossians',
  '1TH': '1 Thessalonians', '2TH': '2 Thessalonians', '1TI': '1 Timothy', '2TI': '2 Timothy',
  'TIT': 'Titus', 'PHM': 'Philemon', 'HEB': 'Hebrews', 'JAS': 'James', '1PE': '1 Peter',
  '2PE': '2 Peter', '1JN': '1 John', '2JN': '2 John', '3JN': '3 John', 'JUD': 'Jude', 'REV': 'Revelation'
};

const VERSION_NAMES = {
  'de4e12af7f28f599-02': 'KJV',
  '06125adad2d5898a-01': 'ASV',
  '9879dbb7cfe39e4d-04': 'WEB',
  '592420522e16049f-01': 'RVR09'
};

function parseScriptureReference(reference) {
  const cleaned = reference.trim().toLowerCase();
  const match = cleaned.match(/^(\d?\s*[a-z]+)\s*(\d+)[\s:.,]+(\d+)$/i);
  if (!match) return null;
  
  let bookPart = match[1].replace(/\s+/g, ' ').trim();
  const chapter = parseInt(match[2], 10);
  const verse = parseInt(match[3], 10);
  
  if (bookPart.match(/^\d/)) {
    bookPart = bookPart.replace(/^(\d)\s*/, '$1 ');
  }
  
  const bookId = BOOK_ALIASES[bookPart];
  if (!bookId) return null;
  
  return {
    bookId,
    bookName: BOOK_NAMES[bookId],
    chapter,
    verse
  };
}

async function fetchVerse(apiKey, bibleId, verseId) {
  const url = `https://rest.api.bible/v1/bibles/${bibleId}/verses/${verseId}?content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=false`;
  
  const response = await fetch(url, {
    headers: { 'api-key': apiKey }
  });
  
  if (!response.ok) {
    if (response.status === 404) {
      return { error: 'Verse not found' };
    }
    return { error: `API error: ${response.status}` };
  }
  
  const data = await response.json();
  if (data.data) {
    return {
      text: data.data.content.trim(),
      version: VERSION_NAMES[bibleId] || bibleId
    };
  }
  return { error: 'Invalid response from API' };
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
      presentationWindow.webContents.send(IPC.SHOW_STANDBY, getEffectiveStandbyPath());
    }
  });

  ipcMain.on(IPC.SHOW_IMAGE, (event, imagePath) => {
    if (!fs.existsSync(imagePath)) {
      if (controlWindow) {
        controlWindow.webContents.send(IPC.IMAGE_ERROR, imagePath);
      }
      return;
    }
    if (presentationWindow) {
      presentationWindow.webContents.send(IPC.SHOW_IMAGE, imagePath);
    }
  });

  ipcMain.on(IPC.SHOW_SCRIPTURE, (event, scripture) => {
    if (presentationWindow) {
      presentationWindow.webContents.send(IPC.SHOW_SCRIPTURE, scripture);
    }
  });

  ipcMain.on(IPC.SHOW_QUICK_SLIDE, (event, slide) => {
    if (presentationWindow) {
      presentationWindow.webContents.send(IPC.SHOW_QUICK_SLIDE, slide);
    }
  });

  ipcMain.on(IPC.SHOW_VIDEO, (event, videoPath, startTime) => {
    if (!fs.existsSync(videoPath)) {
      if (controlWindow) {
        controlWindow.webContents.send(IPC.VIDEO_ERROR, videoPath);
      }
      return;
    }
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

  ipcMain.on(IPC.PLAY_AUDIO, (event, audioPath, startTime) => {
    if (presentationWindow) {
      presentationWindow.webContents.send(IPC.PLAY_AUDIO, audioPath, startTime);
    }
  });

  ipcMain.on(IPC.CONTROL_AUDIO, (event, command, value) => {
    if (presentationWindow) {
      presentationWindow.webContents.send(IPC.CONTROL_AUDIO, command, value);
    }
  });

  ipcMain.on(IPC.AUDIO_STATE, (event, state) => {
    if (controlWindow) {
      controlWindow.webContents.send(IPC.AUDIO_STATE, state);
    }
  });

  ipcMain.on(IPC.IMAGE_ERROR, (event, imagePath) => {
    if (controlWindow) {
      controlWindow.webContents.send(IPC.IMAGE_ERROR, imagePath);
    }
  });

  ipcMain.on(IPC.VIDEO_ERROR, (event, videoPath) => {
    if (controlWindow) {
      controlWindow.webContents.send(IPC.VIDEO_ERROR, videoPath);
    }
  });

  ipcMain.on(IPC.HIDE_PRESENTATION, () => {
    if (presentationWindow) {
      presentationWindow.hide();
      if (controlWindow) {
        controlWindow.webContents.send(IPC.PRESENTATION_VISIBILITY, false);
      }
    }
  });

  ipcMain.on(IPC.SHOW_PRESENTATION, () => {
    if (presentationWindow) {
      presentationWindow.show();
      if (controlWindow) {
        controlWindow.webContents.send(IPC.PRESENTATION_VISIBILITY, true);
      }
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

  ipcMain.handle(IPC.GET_QUICK_SLIDES, () => {
    return settings.quickSlides || [];
  });

  ipcMain.handle(IPC.SAVE_QUICK_SLIDE, (event, slide) => {
    if (!settings.quickSlides) settings.quickSlides = [];
    const existingIndex = settings.quickSlides.findIndex(s => s.id === slide.id);
    if (existingIndex >= 0) {
      settings.quickSlides[existingIndex] = { ...slide, updatedAt: Date.now() };
    } else {
      settings.quickSlides.push({ ...slide, createdAt: Date.now(), updatedAt: Date.now() });
    }
    saveSettings(settings);
    return { success: true, slides: settings.quickSlides };
  });

  ipcMain.handle(IPC.DELETE_QUICK_SLIDE, (event, slideId) => {
    if (!settings.quickSlides) return { success: true, slides: [] };
    settings.quickSlides = settings.quickSlides.filter(s => s.id !== slideId);
    saveSettings(settings);
    return { success: true, slides: settings.quickSlides };
  });

  ipcMain.handle(IPC.UPDATE_QUICK_SLIDE, (event, slideId, updates) => {
    if (!settings.quickSlides) return { success: false, slides: [] };
    const index = settings.quickSlides.findIndex(s => s.id === slideId);
    if (index >= 0) {
      settings.quickSlides[index] = { ...settings.quickSlides[index], ...updates, updatedAt: Date.now() };
      saveSettings(settings);
      return { success: true, slides: settings.quickSlides };
    }
    return { success: false, slides: settings.quickSlides };
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

  ipcMain.handle(IPC.GET_DEFAULT_STANDBY, () => {
    return getDefaultStandbyPath();
  });

  ipcMain.handle(IPC.GET_DEFAULT_SCRIPTURE_BACKGROUNDS, () => {
    return getDefaultScriptureBackgrounds();
  });

  ipcMain.handle(IPC.GET_DEFAULT_QUICKSLIDE_BACKGROUNDS, () => {
    return getDefaultQuickSlideBackgrounds();
  });

  ipcMain.handle(IPC.CLEAR_STANDBY, () => {
    settings.standbyImage = null;
    saveSettings(settings);
    if (controlWindow) {
      controlWindow.webContents.send(IPC.SETTINGS_UPDATED, settings);
    }
    if (presentationWindow) {
      presentationWindow.webContents.send(IPC.SETTINGS_UPDATED, settings);
    }
    return true;
  });

  ipcMain.handle(IPC.VALIDATE_PATHS, () => {
    return validateAllPaths();
  });

  ipcMain.handle(IPC.RELOCATE_LIBRARY_ITEM, async (event, oldPath, newPath) => {
    const item = settings.mediaLibrary.find(f => f.path === oldPath);
    if (item && fs.existsSync(newPath)) {
      item.path = newPath;
      settings.slideshowPresets.forEach(preset => {
        preset.images.forEach(img => {
          if (img.path === oldPath) {
            img.path = newPath;
          }
        });
      });
      saveSettings(settings);
      return { success: true, mediaLibrary: settings.mediaLibrary };
    }
    return { success: false, error: 'File not found or invalid' };
  });

  ipcMain.on(IPC.HIDE_PRESENTATION, () => {
    if (presentationWindow) {
      presentationWindow.hide();
      if (controlWindow) {
        controlWindow.webContents.send(IPC.PRESENTATION_VISIBILITY, false);
      }
    }
  });

  ipcMain.on(IPC.SHOW_PRESENTATION, () => {
    if (presentationWindow) {
      presentationWindow.show();
      presentationWindow.setFullScreen(true);
      if (controlWindow) {
        controlWindow.webContents.send(IPC.PRESENTATION_VISIBILITY, true);
      }
    }
  });

  ipcMain.handle(IPC.FETCH_SCRIPTURE, async (event, { reference, bibleId, bibleId2 }) => {
    const apiKey = settings.bibleApiKey || process.env.BIBLE_API_KEY;
    if (!apiKey) {
      return { error: 'API key not configured. Go to Settings to add your API.Bible key.' };
    }

    let verseId, bookId, chapter, verse, bookName;
    
    const directMatch = reference.match(/^([A-Z0-9]+)\.(\d+)\.(\d+)$/);
    if (directMatch) {
      bookId = directMatch[1];
      chapter = parseInt(directMatch[2], 10);
      verse = parseInt(directMatch[3], 10);
      verseId = reference;
      bookName = BOOK_NAMES[bookId] || bookId;
    } else {
      const parsed = parseScriptureReference(reference);
      if (!parsed) {
        return { error: `Could not parse reference: "${reference}"` };
      }
      bookId = parsed.bookId;
      chapter = parsed.chapter;
      verse = parsed.verse;
      bookName = parsed.bookName;
      verseId = `${bookId}.${chapter}.${verse}`;
    }
    
    try {
      const result = await fetchVerse(apiKey, bibleId, verseId);
      if (result.error) {
        return result;
      }

      const response = {
        reference: `${bookName} ${chapter}:${verse}`,
        bookId: bookId,
        chapter: chapter,
        verse: verse,
        text: result.text,
        version: result.version,
        bibleId: bibleId
      };

      if (bibleId2) {
        const result2 = await fetchVerse(apiKey, bibleId2, verseId);
        if (!result2.error) {
          response.compareText = result2.text;
          response.compareVersion = result2.version;
          response.bibleId2 = bibleId2;
        }
      }

      return response;
    } catch (err) {
      console.error('Scripture fetch error:', err);
      return { error: 'Failed to fetch scripture. Check internet connection.' };
    }
  });

  ipcMain.handle(IPC.FETCH_CHAPTER, async (event, { bibleId, bookId, chapter }) => {
    const apiKey = settings.bibleApiKey || process.env.BIBLE_API_KEY;
    if (!apiKey) {
      return { error: 'API key not configured' };
    }

    const chapterId = `${bookId}.${chapter}`;
    
    try {
      const response = await fetch(
        `https://rest.api.bible/v1/bibles/${bibleId}/chapters/${chapterId}?content-type=text&include-verse-numbers=true`,
        { headers: { 'api-key': apiKey } }
      );
      
      if (!response.ok) {
        if (response.status === 404) {
          return { error: 'Chapter not found' };
        }
        return { error: `API error: ${response.status}` };
      }
      
      const data = await response.json();
      if (!data.data || !data.data.content) {
        return { error: 'Invalid chapter response' };
      }
      
      const content = data.data.content;
      const verses = {};
      const versePattern = /\[(\d+)\]\s*([^\[]*)/g;
      let match;
      while ((match = versePattern.exec(content)) !== null) {
        const verseNum = parseInt(match[1], 10);
        const verseText = match[2].trim();
        if (verseText) {
          verses[verseNum] = verseText;
        }
      }
      
      return {
        bookId,
        chapter,
        verses,
        version: VERSION_NAMES[bibleId] || bibleId,
        verseCount: Object.keys(verses).length
      };
    } catch (err) {
      console.error('Chapter fetch error:', err);
      return { error: 'Failed to fetch chapter' };
    }
  });

  ipcMain.handle(IPC.GET_BIBLE_BOOKS, async (event, bibleId) => {
    const apiKey = settings.bibleApiKey || process.env.BIBLE_API_KEY;
    if (!apiKey) {
      return { error: 'API key not configured' };
    }

    try {
      const response = await fetch(`https://rest.api.bible/v1/bibles/${bibleId}/books`, {
        headers: { 'api-key': apiKey }
      });
      const data = await response.json();
      if (data.data) {
        return data.data.map(book => ({ id: book.id, name: book.name }));
      }
      return { error: 'Failed to load books' };
    } catch (err) {
      return { error: 'Network error loading books' };
    }
  });

  ipcMain.handle(IPC.GET_CHAPTERS, async (event, bibleId, bookId) => {
    const apiKey = settings.bibleApiKey || process.env.BIBLE_API_KEY;
    if (!apiKey) {
      return { error: 'API key not configured' };
    }

    try {
      const response = await fetch(`https://rest.api.bible/v1/bibles/${bibleId}/books/${bookId}/chapters`, {
        headers: { 'api-key': apiKey }
      });
      const data = await response.json();
      if (data.data) {
        return data.data.filter(ch => ch.number !== 'intro').map(ch => ({ id: ch.id, number: ch.number }));
      }
      return { error: 'Failed to load chapters' };
    } catch (err) {
      return { error: 'Network error loading chapters' };
    }
  });

  ipcMain.handle(IPC.GET_VERSES, async (event, bibleId, chapterId) => {
    const apiKey = settings.bibleApiKey || process.env.BIBLE_API_KEY;
    if (!apiKey) {
      return { error: 'API key not configured' };
    }

    try {
      const response = await fetch(`https://rest.api.bible/v1/bibles/${bibleId}/chapters/${chapterId}/verses`, {
        headers: { 'api-key': apiKey }
      });
      const data = await response.json();
      if (data.data) {
        return data.data.map(v => ({ id: v.id, number: v.reference.split(':')[1] || v.reference }));
      }
      return { error: 'Failed to load verses' };
    } catch (err) {
      return { error: 'Network error loading verses' };
    }
  });

  ipcMain.handle(IPC.GET_CHAPTER_INFO, async (event, bibleId, bookId, chapter) => {
    const apiKey = settings.bibleApiKey || process.env.BIBLE_API_KEY;
    if (!apiKey) {
      return { error: 'API key not configured' };
    }

    try {
      const chapterId = `${bookId}.${chapter}`;
      const versesResponse = await fetch(`https://rest.api.bible/v1/bibles/${bibleId}/chapters/${chapterId}/verses`, {
        headers: { 'api-key': apiKey }
      });
      
      if (!versesResponse.ok) {
        return { error: 'Chapter not found', notFound: true };
      }
      
      const versesData = await versesResponse.json();
      const lastVerse = versesData.data ? versesData.data.length : 0;

      const chaptersResponse = await fetch(`https://rest.api.bible/v1/bibles/${bibleId}/books/${bookId}/chapters`, {
        headers: { 'api-key': apiKey }
      });
      const chaptersData = await chaptersResponse.json();
      const chapters = chaptersData.data ? chaptersData.data.filter(c => c.number !== 'intro') : [];
      const chapterCount = chapters.length;

      return {
        lastVerse,
        chapterCount,
        bookOrder: BOOK_ORDER,
        bookId,
        chapter
      };
    } catch (err) {
      return { error: 'Network error' };
    }
  });
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
    if (controlWindow) {
      controlWindow.webContents.send(IPC.UPDATE_AVAILABLE, info);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info.version);
    if (controlWindow) {
      controlWindow.webContents.send(IPC.UPDATE_DOWNLOADED, info);
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err);
  });

  ipcMain.on(IPC.INSTALL_UPDATE, () => {
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle(IPC.CHECK_FOR_UPDATES, async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return { success: true, version: result?.updateInfo?.version };
    } catch (err) {
      console.error('Update check failed:', err);
      return { success: false, error: err.message };
    }
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  defaultStandbyPath = getDefaultStandbyPath();
  initSettings(app.getPath('userData'));
  settings = loadSettings();
  createWindows();
  setupIPC();
  setupAutoUpdater();
  
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => {
      console.log('Initial update check failed:', err.message);
    });
  }, 3000);

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
