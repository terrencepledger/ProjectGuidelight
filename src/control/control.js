const { ipcRenderer, shell } = require('electron');
const path = require('path');
const IPC = require('../shared/ipc-channels');

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

const PRESET_LAYOUT_DEFAULTS = {
  announcement: { verticalAlign: 'center', horizontalAlign: 'center', textWidth: 'wide', backgroundDim: 0 },
  welcome: { verticalAlign: 'center', horizontalAlign: 'center', textWidth: 'medium', backgroundDim: 0 },
  prayer: { verticalAlign: 'top', horizontalAlign: 'center', textWidth: 'wide', backgroundDim: 10 },
  lyrics: { verticalAlign: 'bottom', horizontalAlign: 'center', textWidth: 'medium', backgroundDim: 15 },
  countdown: { verticalAlign: 'center', horizontalAlign: 'center', textWidth: 'medium', backgroundDim: 0 },
  custom: { verticalAlign: 'center', horizontalAlign: 'center', textWidth: 'wide', backgroundDim: 0 }
};

let settings = {};
let currentMode = 'images';
let currentFilter = 'all';
let displays = [];
let mediaLibrary = [];
let selectedImage = null;
let displayResolution = { width: 1920, height: 1080 };

let slideshowPresets = [];
let quickSlides = [];
let currentPreset = null;
let modalSelectedImages = [];

let staged = null;
let live = null;
let isSynced = false;

let previewVideo = null;
let liveVideoState = null;

let previewAudio = null;
let liveAudioState = null;

const chapterCache = new Map();

let queuedSettings = {
  interval: 7000,
  loop: true,
  transition: 'fade'
};

let brokenPaths = new Set();
let contextMenuTarget = null;
let presentationVisible = true;

function getEffectivePath(file) {
  return file.internalPath || file.originalPath || file.path;
}

function getMediaThumbnailId(file) {
  if (file.id) return file.id;
  const filePath = file.path || file.originalPath || '';
  return 'hash_' + filePath.split('').reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0).toString(16);
}

function createStandby() {
  return { type: 'standby' };
}

function createSingleImage(filePath, displayName) {
  return {
    type: 'single-image',
    path: filePath,
    displayName: displayName || path.basename(filePath).replace(/\.[^/.]+$/, '')
  };
}

function createSlideshow(id, queue, index, interval, loop, transition) {
  return {
    type: 'slideshow',
    id: id || generateId(),
    queue: queue || [],
    index: index || 0,
    interval: interval || 7000,
    loop: loop !== undefined ? loop : true,
    transition: transition || 'fade',
    pendingAdds: [],
    pendingRemoves: []
  };
}

function createLiveSlideshow(stagedShow) {
  return {
    type: 'slideshow',
    id: stagedShow.id,
    queue: stagedShow.queue.map(img => ({ ...img })),
    index: stagedShow.index,
    interval: stagedShow.interval,
    loop: stagedShow.loop,
    transition: stagedShow.transition,
    paused: false,
    timer: null
  };
}

function createSingleVideo(filePath, displayName, currentTime) {
  return {
    type: 'single-video',
    path: filePath,
    displayName: displayName || path.basename(filePath).replace(/\.[^/.]+$/, ''),
    currentTime: currentTime || 0,
    duration: 0
  };
}

function createSingleAudio(filePath, displayName, currentTime) {
  return {
    type: 'single-audio',
    path: filePath,
    displayName: displayName || path.basename(filePath).replace(/\.[^/.]+$/, ''),
    currentTime: currentTime || 0,
    duration: 0
  };
}

function createScripture(reference, text, version, bibleId, bookId, chapter, verse, compareText, compareVersion, bibleId2) {
  return {
    type: 'scripture',
    reference,
    text,
    version,
    bibleId,
    bookId,
    chapter,
    verse,
    compareText: compareText || null,
    compareVersion: compareVersion || null,
    bibleId2: bibleId2 || null
  };
}

function parseBodyForLists(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const bulletPattern = /^[\u2022\-\*]\s+(.*)$/;
  const numberPattern = /^(\d+)\.\s+(.*)$/;
  
  let isBulletList = true;
  let isNumberedList = true;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (!bulletPattern.test(trimmed)) isBulletList = false;
    if (!numberPattern.test(trimmed)) isNumberedList = false;
  }
  
  const escapeHtml = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  if (isBulletList && lines.some(l => l.trim() !== '')) {
    const items = lines
      .filter(l => l.trim() !== '')
      .map(l => {
        const match = l.trim().match(bulletPattern);
        return match ? `<li>${escapeHtml(match[1])}</li>` : '';
      })
      .join('');
    return `<ul>${items}</ul>`;
  }
  
  if (isNumberedList && lines.some(l => l.trim() !== '')) {
    const items = lines
      .filter(l => l.trim() !== '')
      .map(l => {
        const match = l.trim().match(numberPattern);
        return match ? `<li>${escapeHtml(match[2])}</li>` : '';
      })
      .join('');
    return `<ol>${items}</ol>`;
  }
  
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function createQuickSlide({ id, preset, title, body, background, backgroundImage, fontFamily, titleFontSize, fontSize, fontColor, verticalAlign, horizontalAlign, textWidth, backgroundDim, elements, displayName, countdownLabel, durationMinutes, durationSeconds, endTime, labelVerticalAlign, labelHorizontalAlign, labelTextWidth, labelOffsetX, labelOffsetY, timerVerticalAlign, timerHorizontalAlign, timerTextWidth, timerOffsetX, timerOffsetY }) {
  const presetKey = preset || 'announcement';
  const defaults = PRESET_LAYOUT_DEFAULTS[presetKey] || PRESET_LAYOUT_DEFAULTS.announcement;
  return {
    type: 'quick-slide',
    id: id || generateId(),
    preset: presetKey,
    displayName: displayName || '',
    title: title || '',
    body: body || '',
    elements: elements || null,
    background: background || '#000000',
    backgroundImage: backgroundImage || null,
    fontFamily: fontFamily || 'Georgia',
    titleFontSize: titleFontSize || 60,
    fontSize: fontSize || 48,
    fontColor: fontColor || '#FFFFFF',
    verticalAlign: verticalAlign !== undefined ? verticalAlign : defaults.verticalAlign,
    horizontalAlign: horizontalAlign !== undefined ? horizontalAlign : defaults.horizontalAlign,
    textWidth: textWidth !== undefined ? textWidth : defaults.textWidth,
    backgroundDim: backgroundDim !== undefined ? backgroundDim : defaults.backgroundDim,
    countdownLabel: countdownLabel || '',
    durationMinutes: durationMinutes !== undefined ? durationMinutes : 5,
    durationSeconds: durationSeconds !== undefined ? durationSeconds : 0,
    endTime: endTime || null,
    labelVerticalAlign: labelVerticalAlign || 'center',
    labelHorizontalAlign: labelHorizontalAlign || 'center',
    labelTextWidth: labelTextWidth || 'wide',
    labelOffsetX: labelOffsetX || 0,
    labelOffsetY: labelOffsetY !== undefined ? labelOffsetY : -30,
    timerVerticalAlign: timerVerticalAlign || 'center',
    timerHorizontalAlign: timerHorizontalAlign || 'center',
    timerTextWidth: timerTextWidth || 'wide',
    timerOffsetX: timerOffsetX || 0,
    timerOffsetY: timerOffsetY !== undefined ? timerOffsetY : 30
  };
}

function createSlideElement({ type, text, verticalAlign, horizontalAlign, textWidth, offsetX, offsetY, fontColor, fontFamily, fontSize, durationMinutes, durationSeconds }) {
  return {
    type: type || 'body',
    text: text || '',
    verticalAlign: verticalAlign || 'center',
    horizontalAlign: horizontalAlign || 'center',
    textWidth: textWidth || 'wide',
    offsetX: offsetX || 0,
    offsetY: offsetY || 0,
    fontColor: fontColor || null,
    fontFamily: fontFamily || null,
    fontSize: fontSize || null,
    durationMinutes: durationMinutes !== undefined ? durationMinutes : 5,
    durationSeconds: durationSeconds !== undefined ? durationSeconds : 0
  };
}

function getCacheKey(bibleId, bookId, chapter) {
  return `${bibleId}:${bookId}.${chapter}`;
}

function getCachedVerse(bibleId, bookId, chapter, verse) {
  const key = getCacheKey(bibleId, bookId, chapter);
  const cached = chapterCache.get(key);
  if (cached && cached.verses[verse]) {
    return { text: cached.verses[verse], version: cached.version };
  }
  return null;
}

async function fetchAndCacheChapter(bibleId, bookId, chapter) {
  const key = getCacheKey(bibleId, bookId, chapter);
  if (chapterCache.has(key)) {
    return chapterCache.get(key);
  }
  
  const result = await ipcRenderer.invoke(IPC.FETCH_CHAPTER, { bibleId, bookId, chapter });
  if (!result.error) {
    chapterCache.set(key, result);
  }
  return result;
}

function prefetchNearbyChapter(bibleId, bookId, chapter, verse, bibleId2) {
  const key = getCacheKey(bibleId, bookId, chapter);
  const cached = chapterCache.get(key);
  if (!cached) return;
  
  const verseCount = cached.verseCount || Object.keys(cached.verses).length;
  
  if (verse <= 3 && chapter > 1) {
    const prevKey = getCacheKey(bibleId, bookId, chapter - 1);
    if (!chapterCache.has(prevKey)) {
      fetchAndCacheChapter(bibleId, bookId, chapter - 1).catch(() => {});
      if (bibleId2) fetchAndCacheChapter(bibleId2, bookId, chapter - 1).catch(() => {});
    }
  } else if (verse >= verseCount - 2) {
    const nextKey = getCacheKey(bibleId, bookId, chapter + 1);
    if (!chapterCache.has(nextKey)) {
      fetchAndCacheChapter(bibleId, bookId, chapter + 1).catch(() => {});
      if (bibleId2) fetchAndCacheChapter(bibleId2, bookId, chapter + 1).catch(() => {});
    }
  }
}

async function getVerseWithCache(bibleId, bookId, chapter, verse, bibleId2) {
  const cached = getCachedVerse(bibleId, bookId, chapter, verse);
  let cached2 = bibleId2 ? getCachedVerse(bibleId2, bookId, chapter, verse) : null;
  
  if (cached && (!bibleId2 || cached2)) {
    const bookName = BOOK_NAMES[bookId] || bookId;
    return {
      reference: `${bookName} ${chapter}:${verse}`,
      bookId,
      chapter,
      verse,
      text: cached.text,
      version: cached.version,
      bibleId,
      compareText: cached2 ? cached2.text : null,
      compareVersion: cached2 ? cached2.version : null,
      bibleId2: bibleId2 || null
    };
  }
  
  return null;
}

let previewScale = 0.2;
let formPreviewScale = 0.18;

function setPreviewAspectRatio() {
  const ratio = displayResolution.width / displayResolution.height;
  document.documentElement.style.setProperty('--monitor-aspect-ratio', ratio);
}

function updatePreviewScale() {
  const previewContent = document.getElementById('previewContent');
  if (!previewContent) return;
  const containerHeight = previewContent.clientHeight - 12;
  previewScale = containerHeight / displayResolution.height;
}

function updateFormPreviewScale() {
  const qsPreviewArea = document.getElementById('qsPreviewArea');
  if (!qsPreviewArea || qsPreviewArea.clientHeight <= 32) return;
  const containerHeight = qsPreviewArea.clientHeight - 32;
  formPreviewScale = containerHeight / displayResolution.height;
}

async function init() {
  settings = await ipcRenderer.invoke(IPC.GET_SETTINGS);
  displays = await ipcRenderer.invoke(IPC.GET_DISPLAYS);
  mediaLibrary = await ipcRenderer.invoke(IPC.GET_MEDIA_LIBRARY);
  displayResolution = await ipcRenderer.invoke(IPC.GET_DISPLAY_RESOLUTION);
  setPreviewAspectRatio();
  slideshowPresets = await ipcRenderer.invoke(IPC.GET_SLIDESHOW_PRESETS);
  quickSlides = await ipcRenderer.invoke(IPC.GET_QUICK_SLIDES);
  
  const appVersion = await ipcRenderer.invoke(IPC.GET_APP_VERSION);
  document.getElementById('versionInfo').textContent = `v${appVersion}`;
  
  await validateBrokenPaths();
  
  live = createStandby();
  staged = null;
  
  updateSettingsUI();
  setupNavigation();
  setupStandbyButton();
  setupSettingsControls();
  setupImageControls();
  setupFilterToggles();
  setupDisplayControls();
  setupSlideshowControls();
  setupStagedTransportControls();
  setupLiveTransportControls();
  setupVideoTransportControls();
  setupAudioTransportControls();
  setupScriptureControls();
  setupScriptureTransportControls();
  setupKeyboardNavigation();
  setupQuickSlidesControls();
  setupModal();
  setupContextMenu();
  setupBlackoutMode();
  setupUpdateBanner();
  setupCheckUpdatesButton();
  setupMediaCopyListeners();
  await migrateLegacyMedia();
  renderImageGrid();
  updateImportStatus();
  updateStorageDisplay();
  updateLiveDisplay();
  loadActivePreset();
  updatePreviewScale();
  updateFormPreviewScale();
  
  window.addEventListener('resize', () => {
    updatePreviewScale();
    updateFormPreviewScale();
    updatePreviewDisplay();
    updateLiveDisplay();
  });
}

async function validateBrokenPaths() {
  const broken = await ipcRenderer.invoke(IPC.VALIDATE_PATHS);
  brokenPaths.clear();
  broken.forEach(item => brokenPaths.add(item.path));
}

function isPathBroken(filePath) {
  return brokenPaths.has(filePath);
}

function setupNavigation() {
  const navButtons = document.querySelectorAll('.nav-btn');
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      switchMode(mode);
    });
  });
}

function switchMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  document.querySelectorAll('.mode-panel').forEach(panel => {
    panel.classList.toggle('active', panel.dataset.panel === mode);
  });
}

function setupStandbyButton() {
  const standbyBtn = document.getElementById('standbyBtn');
  standbyBtn.addEventListener('click', () => {
    stopLiveSlideshowTimer();
    stopLiveVideo();
    stopLiveAudio();
    ipcRenderer.send(IPC.SHOW_STANDBY);
    live = createStandby();
    isSynced = false;
    updatePreviewDisplay();
    updateLiveDisplay();
    updateGoLiveButton();
    updateVideoTransportUI();
    updateAudioTransportUI();
  });
}

function setupSettingsControls() {
  const pickStandbyBtn = document.getElementById('pickStandbyImage');
  pickStandbyBtn.addEventListener('click', async () => {
    const files = await ipcRenderer.invoke(IPC.PICK_FILE, [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }
    ]);
    if (files && files.length > 0) {
      settings.standbyImage = files[0];
      await ipcRenderer.invoke(IPC.SAVE_SETTINGS, { standbyImage: files[0] });
      updateSettingsUI();
    }
  });

  const clearStandbyBtn = document.getElementById('clearStandbyImage');
  clearStandbyBtn.addEventListener('click', async () => {
    await ipcRenderer.invoke(IPC.CLEAR_STANDBY);
    settings.standbyImage = null;
    updateSettingsUI();
  });

  const apiKeyInput = document.getElementById('bibleApiKey');
  apiKeyInput.addEventListener('change', async () => {
    settings.bibleApiKey = apiKeyInput.value.trim();
    await ipcRenderer.invoke(IPC.SAVE_SETTINGS, { bibleApiKey: settings.bibleApiKey });
  });

  const apiSignupLink = document.getElementById('apiSignupLink');
  apiSignupLink.addEventListener('click', (e) => {
    e.preventDefault();
    shell.openExternal('https://scripture.api.bible/signup');
  });

  const monitorSelect = document.getElementById('presentationMonitor');
  monitorSelect.addEventListener('change', async () => {
    const displayId = parseInt(monitorSelect.value, 10);
    await ipcRenderer.invoke(IPC.SET_PRESENTATION_DISPLAY, displayId);
  });

  const scalingSelect = document.getElementById('scalingMode');
  scalingSelect.addEventListener('change', async () => {
    settings.scalingMode = scalingSelect.value;
    await ipcRenderer.invoke(IPC.SAVE_SETTINGS, { scalingMode: scalingSelect.value });
  });

  const fontFamilySelect = document.getElementById('scriptureFontFamily');
  fontFamilySelect.addEventListener('change', async () => {
    settings.scriptureFontFamily = fontFamilySelect.value;
    await ipcRenderer.invoke(IPC.SAVE_SETTINGS, { scriptureFontFamily: fontFamilySelect.value });
    if (staged?.type === 'scripture') {
      updatePreviewDisplay();
      updateGoLiveButton();
    }
  });

  const fontSizeSelect = document.getElementById('scriptureFontSize');
  fontSizeSelect.addEventListener('change', async () => {
    settings.scriptureFontSize = parseInt(fontSizeSelect.value, 10);
    await ipcRenderer.invoke(IPC.SAVE_SETTINGS, { scriptureFontSize: settings.scriptureFontSize });
    if (staged?.type === 'scripture') {
      updatePreviewDisplay();
      updateGoLiveButton();
    }
  });

  const fontColorInput = document.getElementById('scriptureFontColor');
  fontColorInput.addEventListener('change', async () => {
    settings.scriptureFontColor = fontColorInput.value;
    await ipcRenderer.invoke(IPC.SAVE_SETTINGS, { scriptureFontColor: fontColorInput.value });
    if (staged?.type === 'scripture') {
      updatePreviewDisplay();
      updateGoLiveButton();
    }
  });

  const bgColorInput = document.getElementById('scriptureBackground');
  const bgColorPreview = document.getElementById('bgColorPreview');
  bgColorInput.addEventListener('input', () => {
    bgColorPreview.textContent = bgColorInput.value.toUpperCase();
  });
  bgColorInput.addEventListener('change', async () => {
    settings.scriptureBackground = bgColorInput.value;
    settings.scriptureBackgroundImage = null;
    await ipcRenderer.invoke(IPC.SAVE_SETTINGS, { 
      scriptureBackground: bgColorInput.value,
      scriptureBackgroundImage: null 
    });
    if (staged?.type === 'scripture') {
      updatePreviewDisplay();
      updateGoLiveButton();
    }
  });

  const bgTypeButtons = document.querySelectorAll('.scripture-bg-btn');
  const bgColorGroup = document.getElementById('scriptureBgColorGroup');
  const bgImageGroup = document.getElementById('scriptureBgImageGroup');
  const bgSelect = document.getElementById('scriptureBackgroundSelect');

  let defaultScriptureBackgrounds = [];

  async function loadDefaultScriptureBackgrounds() {
    defaultScriptureBackgrounds = await ipcRenderer.invoke(IPC.GET_DEFAULT_SCRIPTURE_BACKGROUNDS);
    bgSelect.innerHTML = '<option value="">-- Select --</option>';
    defaultScriptureBackgrounds.forEach(bg => {
      const opt = document.createElement('option');
      opt.value = bg.path;
      opt.textContent = bg.name;
      opt.dataset.isDefault = 'true';
      bgSelect.appendChild(opt);
    });
    const customOpt = document.createElement('option');
    customOpt.value = 'custom';
    customOpt.textContent = 'Custom Image...';
    bgSelect.appendChild(customOpt);
  }

  loadDefaultScriptureBackgrounds();

  bgTypeButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      bgTypeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const type = btn.dataset.bgType;
      if (type === 'color') {
        bgColorGroup.style.display = '';
        bgImageGroup.style.display = 'none';
        settings.scriptureBackgroundImage = null;
        await ipcRenderer.invoke(IPC.SAVE_SETTINGS, { scriptureBackgroundImage: null });
        if (staged?.type === 'scripture') {
          updatePreviewDisplay();
          updateGoLiveButton();
        }
      } else {
        bgColorGroup.style.display = 'none';
        bgImageGroup.style.display = '';
      }
    });
  });

  bgSelect.addEventListener('change', async () => {
    const value = bgSelect.value;
    if (value === 'custom') {
      const files = await ipcRenderer.invoke(IPC.PICK_FILE, [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }
      ]);
      if (files && files.length > 0) {
        settings.scriptureBackgroundImage = files[0];
        await ipcRenderer.invoke(IPC.SAVE_SETTINGS, { scriptureBackgroundImage: files[0] });
        if (staged?.type === 'scripture') {
          updatePreviewDisplay();
          updateGoLiveButton();
        }
      } else {
        bgSelect.value = settings.scriptureBackgroundImage || '';
      }
    } else if (value) {
      settings.scriptureBackgroundImage = value;
      await ipcRenderer.invoke(IPC.SAVE_SETTINGS, { scriptureBackgroundImage: value });
      if (staged?.type === 'scripture') {
        updatePreviewDisplay();
        updateGoLiveButton();
      }
    } else {
      settings.scriptureBackgroundImage = null;
      await ipcRenderer.invoke(IPC.SAVE_SETTINGS, { scriptureBackgroundImage: null });
      if (staged?.type === 'scripture') {
        updatePreviewDisplay();
        updateGoLiveButton();
      }
    }
  });

  const pickScriptureBgBtn = document.getElementById('pickScriptureBackground');
  pickScriptureBgBtn.addEventListener('click', async () => {
    const files = await ipcRenderer.invoke(IPC.PICK_FILE, [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }
    ]);
    if (files && files.length > 0) {
      settings.scriptureBackgroundImage = files[0];
      await ipcRenderer.invoke(IPC.SAVE_SETTINGS, { scriptureBackgroundImage: files[0] });
      if (staged?.type === 'scripture') {
        updatePreviewDisplay();
        updateGoLiveButton();
      }
    }
  });
}

function updateSettingsUI() {
  const standbyInput = document.getElementById('standbyImagePath');
  const clearStandbyBtn = document.getElementById('clearStandbyImage');
  if (settings.standbyImage) {
    if (isPathBroken(settings.standbyImage)) {
      standbyInput.value = '⚠ ' + path.basename(settings.standbyImage) + ' (missing)';
    } else {
      standbyInput.value = path.basename(settings.standbyImage);
    }
    clearStandbyBtn.style.display = '';
  } else {
    standbyInput.value = '';
    standbyInput.placeholder = 'Using default';
    clearStandbyBtn.style.display = 'none';
  }

  const monitorSelect = document.getElementById('presentationMonitor');
  monitorSelect.innerHTML = '';
  displays.forEach(display => {
    const option = document.createElement('option');
    option.value = display.id;
    option.textContent = display.label + (display.primary ? ' (Primary)' : '');
    if (settings.presentationDisplayId === display.id) {
      option.selected = true;
    } else if (!settings.presentationDisplayId && !display.primary) {
      option.selected = true;
    }
    monitorSelect.appendChild(option);
  });

  const scalingSelect = document.getElementById('scalingMode');
  scalingSelect.value = settings.scalingMode || 'fit';

  const fontFamilySelect = document.getElementById('scriptureFontFamily');
  fontFamilySelect.value = settings.scriptureFontFamily || 'Georgia';

  const fontSizeSelect = document.getElementById('scriptureFontSize');
  fontSizeSelect.value = settings.scriptureFontSize || 48;

  const fontColorInput = document.getElementById('scriptureFontColor');
  fontColorInput.value = settings.scriptureFontColor || '#FFFFFF';

  const bgColorInput = document.getElementById('scriptureBackground');
  bgColorInput.value = settings.scriptureBackground || '#000000';

  const bgTypeButtons = document.querySelectorAll('.scripture-bg-btn');
  const bgColorGroup = document.getElementById('scriptureBgColorGroup');
  const bgImageGroup = document.getElementById('scriptureBgImageGroup');
  const bgSelect = document.getElementById('scriptureBackgroundSelect');

  if (settings.scriptureBackgroundImage) {
    bgTypeButtons.forEach(b => b.classList.remove('active'));
    document.querySelector('.scripture-bg-btn[data-bg-type="image"]').classList.add('active');
    bgColorGroup.style.display = 'none';
    bgImageGroup.style.display = '';
    
    const isDefault = Array.from(bgSelect.options).some(
      opt => opt.value === settings.scriptureBackgroundImage && opt.dataset.isDefault === 'true'
    );
    if (isDefault) {
      bgSelect.value = settings.scriptureBackgroundImage;
    } else {
      bgSelect.value = 'custom';
    }
  } else {
    bgTypeButtons.forEach(b => b.classList.remove('active'));
    document.querySelector('.scripture-bg-btn[data-bg-type="color"]').classList.add('active');
    bgColorGroup.style.display = '';
    bgImageGroup.style.display = 'none';
    bgSelect.value = '';
  }

  const apiKeyInput = document.getElementById('bibleApiKey');
  apiKeyInput.value = settings.bibleApiKey || '';
}

function getStagedImagePath() {
  if (!staged) return null;
  if (staged.type === 'single-image') return staged.path;
  if (staged.type === 'single-video') return null;
  if (staged.type === 'slideshow' && staged.queue.length > 0) {
    const item = staged.queue[staged.index];
    if (item?.type === 'video') return null;
    return item?.path || null;
  }
  return null;
}

function getStagedVideoPath() {
  if (!staged) return null;
  if (staged.type === 'single-video') return staged.path;
  if (staged.type === 'slideshow' && staged.queue.length > 0) {
    const item = staged.queue[staged.index];
    if (item?.type === 'video') return item.path;
  }
  return null;
}

function getStagedAudioPath() {
  if (!staged) return null;
  if (staged.type === 'single-audio') return staged.path;
  return null;
}

function getLiveImagePath() {
  if (!live || live.type === 'standby') return null;
  if (live.type === 'single-image') return live.path;
  if (live.type === 'single-video') return null;
  if (live.type === 'slideshow' && live.queue.length > 0) {
    const item = live.queue[live.index];
    if (item?.type === 'video' || item?.type === 'quick-slide') return null;
    return item?.path || null;
  }
  return null;
}

function getLiveVideoPath() {
  if (!live || live.type === 'standby') return null;
  if (live.type === 'single-video') return live.path;
  if (live.type === 'slideshow' && live.queue.length > 0) {
    const item = live.queue[live.index];
    if (item?.type === 'video') return item.path;
  }
  return null;
}

function getLiveAudioPath() {
  if (!live || live.type === 'standby') return null;
  if (live.type === 'single-audio') return live.path;
  return null;
}

function getMediaName(content) {
  if (!content) return '';
  
  if (content.type === 'standby') return '';
  
  if (content.type === 'single-image' || content.type === 'single-video' || content.type === 'single-audio') {
    const libItem = mediaLibrary.find(f => f.path === content.path || f.internalPath === content.path || f.originalPath === content.path);
    if (libItem) {
      return libItem.displayName || libItem.name.replace(/\.[^/.]+$/, '');
    }
    return content.displayName || path.basename(content.path).replace(/\.[^/.]+$/, '');
  }
  
  if (content.type === 'slideshow') {
    const preset = slideshowPresets.find(p => p.id === content.id);
    return preset?.name || 'Slideshow';
  }
  
  if (content.type === 'scripture') {
    return `${content.reference} (${content.version})`;
  }
  
  if (content.type === 'quick-slide') {
    const presetLabel = content.preset.charAt(0).toUpperCase() + content.preset.slice(1);
    return content.title || presetLabel;
  }
  
  return '';
}

function updatePreviewDisplay() {
  const previewEl = document.getElementById('previewContent');
  const clearBtn = document.getElementById('clearPreviewBtn');
  const mediaNameEl = document.getElementById('previewMediaName');
  
  const imagePath = getStagedImagePath();
  const videoPath = getStagedVideoPath();
  const audioPath = getStagedAudioPath();
  
  if (!staged || staged.type === 'standby') {
    previewEl.innerHTML = '<span class="display-placeholder">Select content to preview</span>';
    clearBtn.classList.remove('visible');
    mediaNameEl.textContent = '';
    cleanupPreviewVideo();
    cleanupPreviewAudio();
    updateVideoTransportUI();
    updateAudioTransportUI();
    return;
  }
  
  if (audioPath) {
    const displayName = staged.displayName || path.basename(audioPath).replace(/\.[^/.]+$/, '');
    previewEl.innerHTML = `<div class="audio-icon-display"><span class="audio-icon">🎵</span><span class="audio-track-name">${displayName}</span></div><span class="muted-indicator" title="Preview is muted">🔇</span>`;
    previewAudio = document.createElement('audio');
    previewAudio.src = 'file://' + audioPath;
    previewAudio.muted = true;
    previewAudio.preload = 'metadata';
    setupPreviewAudioEvents();
    cleanupPreviewVideo();
  } else if (videoPath) {
    previewEl.innerHTML = `<video id="previewVideoEl" src="file://${videoPath}" muted></video><span class="muted-indicator" title="Preview is muted">🔇</span>`;
    previewVideo = document.getElementById('previewVideoEl');
    previewVideo.currentTime = staged.currentTime || 0;
    setupPreviewVideoEvents();
    cleanupPreviewAudio();
  } else if (imagePath) {
    previewEl.innerHTML = `<img src="file://${imagePath}" alt="Preview">`;
    cleanupPreviewVideo();
    cleanupPreviewAudio();
  } else if (staged.type === 'scripture') {
    const bg = settings.scriptureBackground || '#000000';
    const bgImage = settings.scriptureBackgroundImage ? settings.scriptureBackgroundImage.replace(/\\/g, '/') : null;
    const fontFamily = settings.scriptureFontFamily || 'Georgia';
    const fontSize = settings.scriptureFontSize || 48;
    const fontColor = settings.scriptureFontColor || '#FFFFFF';
    
    const previewFontSize = Math.round(fontSize * previewScale);
    const previewRefSize = Math.round(previewFontSize * 0.5);
    
    let bgStyle = bgImage 
      ? `background-image: url('file:///${bgImage}'); background-size: cover; background-position: center;`
      : `background-color: ${bg};`;
    
    const textStyle = `font-family: ${fontFamily}, serif; font-size: ${previewFontSize}px; color: ${fontColor};`;
    const refStyle = `font-family: ${fontFamily}, serif; font-size: ${previewRefSize}px; color: ${fontColor}; opacity: 0.7;`;
    
    const compareHtml = staged.compareText ? 
      `<div class="scripture-compare-preview"><div class="scripture-text" style="${textStyle}">${staged.compareText}</div><div class="scripture-ref" style="${refStyle}">${staged.reference} (${staged.compareVersion})</div></div>` : '';
    previewEl.innerHTML = `<div class="preview-frame"><div class="scripture-preview ${staged.compareText ? 'compare-mode' : ''}" style="${bgStyle}"><div class="scripture-main-preview"><div class="scripture-text" style="${textStyle}">${staged.text}</div><div class="scripture-ref" style="${refStyle}">${staged.reference} (${staged.version})</div></div>${compareHtml}</div></div>`;
    cleanupPreviewVideo();
    cleanupPreviewAudio();
  } else if (staged.type === 'quick-slide') {
    const bg = staged.background || '#000000';
    const bgImage = staged.backgroundImage ? staged.backgroundImage.replace(/\\/g, '/') : null;
    const fontFamily = staged.fontFamily || 'Georgia';
    const titleFontSize = staged.titleFontSize || 60;
    const fontSize = staged.fontSize || 48;
    const fontColor = staged.fontColor || '#FFFFFF';
    const backgroundDim = staged.backgroundDim !== undefined ? staged.backgroundDim : 0;
    
    const previewFontSize = Math.round(fontSize * previewScale);
    const previewTitleSize = Math.round(titleFontSize * previewScale);
    
    let bgStyle = bgImage 
      ? `background-image: url('file:///${bgImage}'); background-size: cover; background-position: center;`
      : `background-color: ${bg};`;
    
    if (staged.preset === 'custom' && staged.elements) {
      let elementsHtml = staged.elements.map(el => {
        const defaultSize = el.type === 'title' ? titleFontSize : fontSize;
        const elFontSize = Math.round((el.fontSize || defaultSize) * previewScale);
        const elColor = el.fontColor || fontColor;
        const elFont = el.fontFamily || fontFamily;
        const ox = el.offsetX || 0;
        const oy = el.offsetY || 0;
        const baseX = el.horizontalAlign === 'center' ? -50 : 0;
        const baseY = el.verticalAlign === 'center' ? -50 : 0;
        const transformStyle = `transform: translate(calc(${baseX}% + ${ox}%), calc(${baseY}% + ${oy}%));`;
        const fontWeight = el.type === 'title' ? 'font-weight: bold;' : '';
        return `<div class="qs-staged-el v-${el.verticalAlign} h-${el.horizontalAlign} w-${el.textWidth}" style="font-family: ${elFont}, serif; font-size: ${elFontSize}px; color: ${elColor}; ${fontWeight} ${transformStyle}">${el.text}</div>`;
      }).join('');
      previewEl.innerHTML = `<div class="preview-frame"><div class="quick-slide-preview custom-mode" style="${bgStyle} --dim-opacity: ${backgroundDim / 100};">${elementsHtml}</div></div>`;
    } else if (staged.preset === 'countdown') {
      const labelVAlign = staged.labelVerticalAlign || 'center';
      const labelHAlign = staged.labelHorizontalAlign || 'center';
      const labelOx = staged.labelOffsetX || 0;
      const labelOy = staged.labelOffsetY !== undefined ? staged.labelOffsetY : -30;
      const timerVAlign = staged.timerVerticalAlign || 'center';
      const timerHAlign = staged.timerHorizontalAlign || 'center';
      const timerOx = staged.timerOffsetX || 0;
      const timerOy = staged.timerOffsetY !== undefined ? staged.timerOffsetY : 30;
      const lbaseX = labelHAlign === 'center' ? -50 : 0;
      const lbaseY = labelVAlign === 'center' ? -50 : 0;
      const tbaseX = timerHAlign === 'center' ? -50 : 0;
      const tbaseY = timerVAlign === 'center' ? -50 : 0;
      const labelHtml = staged.countdownLabel 
        ? `<div class="qs-staged-el v-${labelVAlign} h-${labelHAlign}" style="font-family: ${fontFamily}, serif; font-size: ${previewFontSize}px; color: ${fontColor}; transform: translate(calc(${lbaseX}% + ${labelOx}%), calc(${lbaseY}% + ${labelOy}%));">${escapeHtml(staged.countdownLabel)}</div>`
        : '';
      const mins = staged.durationMinutes || 0;
      const secs = staged.durationSeconds || 0;
      const timerDisplay = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
      const timerHtml = `<div class="qs-staged-el v-${timerVAlign} h-${timerHAlign}" style="font-family: ${fontFamily}, serif; font-size: ${previewTitleSize * 1.5}px; color: ${fontColor}; font-weight: bold; transform: translate(calc(${tbaseX}% + ${timerOx}%), calc(${tbaseY}% + ${timerOy}%));">${timerDisplay}</div>`;
      previewEl.innerHTML = `<div class="preview-frame"><div class="quick-slide-preview custom-mode" style="${bgStyle}">${labelHtml}${timerHtml}</div></div>`;
    } else {
      const showTitle = staged.preset === 'announcement' || staged.preset === 'prayer';
      const titleHtml = showTitle && staged.title 
        ? `<div style="font-family: ${fontFamily}, serif; font-size: ${previewTitleSize}px; color: ${fontColor}; font-weight: bold; margin-bottom: 0.5rem;">${staged.title}</div>` 
        : '';
      const bodyHtml = `<div style="font-family: ${fontFamily}, serif; font-size: ${previewFontSize}px; color: ${fontColor}; white-space: pre-wrap;">${staged.body}</div>`;
      previewEl.innerHTML = `<div class="preview-frame"><div class="quick-slide-preview" style="${bgStyle}">${titleHtml}${bodyHtml}</div></div>`;
    }
    cleanupPreviewVideo();
    cleanupPreviewAudio();
  }
  
  mediaNameEl.textContent = getMediaName(staged);
  clearBtn.classList.add('visible');
  updateVideoTransportUI();
  updateAudioTransportUI();
}

function shouldEnableGoLive() {
  if (!staged) {
    return live && live.type !== 'standby';
  }
  
  if (staged.type === 'standby') {
    return live && live.type !== 'standby';
  }
  
  if (!live || live.type === 'standby') {
    return true;
  }
  
  if (staged.type !== live.type) {
    return true;
  }
  
  if (staged.type === 'single-image') {
    return staged.path !== live.path;
  }
  
  if (staged.type === 'single-video') {
    if (staged.path !== live.path) return true;
    if (!isSynced) return true;
    return false;
  }
  
  if (staged.type === 'single-audio') {
    if (staged.path !== live.path) return true;
    if (!isSynced) return true;
    return false;
  }
  
  if (staged.type === 'slideshow') {
    if (isSynced) return false;
    return true;
  }
  
  if (staged.type === 'scripture') {
    if (!live || live.type !== 'scripture') return true;
    if (staged.reference !== live.reference || staged.bibleId !== live.bibleId) return true;
    if (staged.compareText !== live.compareText) return true;
    const currentBg = settings.scriptureBackground || '#000000';
    const currentBgImage = settings.scriptureBackgroundImage || null;
    const currentFontFamily = settings.scriptureFontFamily || 'Georgia';
    const currentFontSize = settings.scriptureFontSize || 48;
    const currentFontColor = settings.scriptureFontColor || '#FFFFFF';
    if (currentBg !== live.liveBackground) return true;
    if (currentBgImage !== live.liveBackgroundImage) return true;
    if (currentFontFamily !== live.liveFontFamily) return true;
    if (currentFontSize !== live.liveFontSize) return true;
    if (currentFontColor !== live.liveFontColor) return true;
    return false;
  }
  
  if (staged.type === 'quick-slide') {
    if (!live || live.type !== 'quick-slide') return true;
    if (staged.id !== live.id) return true;
    return false;
  }
  
  return false;
}

function updateGoLiveButton() {
  const goLiveBtn = document.getElementById('goLiveBtn');
  goLiveBtn.disabled = !shouldEnableGoLive();
}

function updateLiveDisplay() {
  const liveEl = document.getElementById('liveContent');
  const mediaNameEl = document.getElementById('liveMediaName');
  
  if (!live || live.type === 'standby') {
    if (settings.standbyImage) {
      liveEl.innerHTML = `<img src="file://${settings.standbyImage}" alt="Live">`;
    } else {
      liveEl.innerHTML = '<span class="display-placeholder">Standby</span>';
    }
    mediaNameEl.textContent = '';
    updateVideoTransportUI();
    updateAudioTransportUI();
    return;
  }
  
  const imagePath = getLiveImagePath();
  const videoPath = getLiveVideoPath();
  const audioPath = getLiveAudioPath();
  
  if (audioPath) {
    const displayName = live.displayName || path.basename(audioPath).replace(/\.[^/.]+$/, '');
    liveEl.innerHTML = `<div class="audio-icon-display"><span class="audio-icon">🎵</span><span class="audio-track-name">${displayName}</span></div>`;
  } else if (videoPath) {
    liveEl.innerHTML = `<img src="" alt="Live Video" style="display:none"><span class="display-placeholder">▶ Video Playing</span>`;
  } else if (imagePath) {
    liveEl.innerHTML = `<img src="file://${imagePath}" alt="Live">`;
  } else if (live.type === 'scripture') {
    const bg = live.liveBackground || '#000000';
    const bgImage = live.liveBackgroundImage ? live.liveBackgroundImage.replace(/\\/g, '/') : null;
    const fontFamily = live.liveFontFamily || 'Georgia';
    const fontSize = live.liveFontSize || 48;
    const fontColor = live.liveFontColor || '#FFFFFF';

    const previewFontSize = Math.round(fontSize * previewScale);
    const previewRefSize = Math.round(previewFontSize * 0.5);

    let bgStyle = bgImage
      ? `background: url('file:///${bgImage}') center/cover no-repeat;`
      : `background: ${bg};`;

    const textStyle = `font-family: ${fontFamily}, serif; font-size: ${previewFontSize}px; color: ${fontColor};`;
    const refStyle = `font-family: ${fontFamily}, serif; font-size: ${previewRefSize}px; color: ${fontColor}; opacity: 0.7;`;

    const compareHtml = live.compareText ?
      `<div class="scripture-compare-preview"><div class="scripture-text" style="${textStyle}">${live.compareText}</div><div class="scripture-ref" style="${refStyle}">${live.reference} (${live.compareVersion})</div></div>` : '';
    liveEl.innerHTML = `<div class="preview-frame"><div class="scripture-preview ${live.compareText ? 'compare-mode' : ''}" style="${bgStyle}"><div class="scripture-main-preview"><div class="scripture-text" style="${textStyle}">${live.text}</div><div class="scripture-ref" style="${refStyle}">${live.reference} (${live.version})</div></div>${compareHtml}</div></div>`;
  } else if (live.type === 'quick-slide') {
    const bg = live.background || '#000000';
    const bgImage = live.backgroundImage ? live.backgroundImage.replace(/\\/g, '/') : null;
    const fontFamily = live.fontFamily || 'Georgia';
    const titleFontSize = live.titleFontSize || 60;
    const fontSize = live.fontSize || 48;
    const fontColor = live.fontColor || '#FFFFFF';
    const backgroundDim = live.backgroundDim !== undefined ? live.backgroundDim : 0;
    
    const previewFontSize = Math.round(fontSize * previewScale);
    const previewTitleSize = Math.round(titleFontSize * previewScale);
    
    let bgStyle = bgImage 
      ? `background-image: url('file:///${bgImage}'); background-size: cover; background-position: center;`
      : `background-color: ${bg};`;
    
    let contentHtml = '';
    let isCustomMode = false;
    
    if (live.preset === 'countdown') {
      isCustomMode = true;
      const labelVAlign = live.labelVerticalAlign || 'center';
      const labelHAlign = live.labelHorizontalAlign || 'center';
      const labelOx = live.labelOffsetX || 0;
      const labelOy = live.labelOffsetY !== undefined ? live.labelOffsetY : -30;
      const timerVAlign = live.timerVerticalAlign || 'center';
      const timerHAlign = live.timerHorizontalAlign || 'center';
      const timerOx = live.timerOffsetX || 0;
      const timerOy = live.timerOffsetY !== undefined ? live.timerOffsetY : 30;
      const lbaseX = labelHAlign === 'center' ? -50 : 0;
      const lbaseY = labelVAlign === 'center' ? -50 : 0;
      const tbaseX = timerHAlign === 'center' ? -50 : 0;
      const tbaseY = timerVAlign === 'center' ? -50 : 0;
      const labelHtml = live.countdownLabel 
        ? `<div class="qs-staged-el v-${labelVAlign} h-${labelHAlign}" style="font-family: ${fontFamily}, serif; font-size: ${previewFontSize}px; color: ${fontColor}; transform: translate(calc(${lbaseX}% + ${labelOx}%), calc(${lbaseY}% + ${labelOy}%));">${escapeHtml(live.countdownLabel)}</div>`
        : '';
      const timerHtml = `<div class="qs-staged-el v-${timerVAlign} h-${timerHAlign}" style="font-family: ${fontFamily}, serif; font-size: ${previewTitleSize * 1.5}px; color: ${fontColor}; font-weight: bold; transform: translate(calc(${tbaseX}% + ${timerOx}%), calc(${tbaseY}% + ${timerOy}%));">⏱</div>`;
      contentHtml = labelHtml + timerHtml;
    } else if (live.preset === 'custom' && live.elements) {
      isCustomMode = true;
      contentHtml = live.elements.map(el => {
        const defaultSize = el.type === 'title' ? titleFontSize : fontSize;
        const elFontSize = Math.round((el.fontSize || defaultSize) * previewScale);
        const elColor = el.fontColor || fontColor;
        const elFont = el.fontFamily || fontFamily;
        const ox = el.offsetX || 0;
        const oy = el.offsetY || 0;
        const baseX = el.horizontalAlign === 'center' ? -50 : 0;
        const baseY = el.verticalAlign === 'center' ? -50 : 0;
        const transformStyle = `transform: translate(calc(${baseX}% + ${ox}%), calc(${baseY}% + ${oy}%));`;
        const fontWeight = el.type === 'title' ? 'font-weight: bold;' : '';
        const displayText = el.type === 'countdown' ? '⏱' : escapeHtml(el.text);
        return `<div class="qs-staged-el v-${el.verticalAlign} h-${el.horizontalAlign} w-${el.textWidth}" style="font-family: ${elFont}, serif; font-size: ${elFontSize}px; color: ${elColor}; ${fontWeight} ${transformStyle}">${displayText}</div>`;
      }).join('');
    } else {
      const showTitle = live.preset === 'announcement' || live.preset === 'prayer';
      const titleHtml = showTitle && live.title 
        ? `<div style="font-family: ${fontFamily}, serif; font-size: ${previewTitleSize}px; color: ${fontColor}; font-weight: bold; margin-bottom: 0.5rem;">${escapeHtml(live.title)}</div>` 
        : '';
      const bodyHtml = `<div style="font-family: ${fontFamily}, serif; font-size: ${previewFontSize}px; color: ${fontColor}; white-space: pre-wrap;">${escapeHtml(live.body)}</div>`;
      contentHtml = titleHtml + bodyHtml;
    }
    
    const customModeClass = isCustomMode ? ' custom-mode' : '';
    liveEl.innerHTML = `<div class="preview-frame"><div class="quick-slide-preview${customModeClass}" style="${bgStyle} --dim-opacity: ${backgroundDim / 100};">${contentHtml}</div></div>`;
  }
  
  mediaNameEl.textContent = getMediaName(live);
  updateVideoTransportUI();
  updateAudioTransportUI();
}

function setupDisplayControls() {
  const goLiveBtn = document.getElementById('goLiveBtn');
  const clearBtn = document.getElementById('clearPreviewBtn');
  
  goLiveBtn.addEventListener('click', () => {
    if (!staged) {
      stopLiveSlideshowTimer();
      stopLiveVideo();
      stopLiveAudio();
      ipcRenderer.send(IPC.SHOW_STANDBY);
      live = createStandby();
      updateLiveDisplay();
      updateGoLiveButton();
      return;
    }
    
    if (staged.type === 'single-image') {
      stopLiveSlideshowTimer();
      stopLiveVideo();
      stopLiveAudio();
      ipcRenderer.send(IPC.SHOW_IMAGE, staged.path);
      live = { ...staged };
      isSynced = false;
      updateLiveDisplay();
      updateGoLiveButton();
      updateTransportUI();
      return;
    }
    
    if (staged.type === 'single-video') {
      stopLiveSlideshowTimer();
      stopLiveVideo();
      stopLiveAudio();
      const startTime = staged.currentTime || 0;
      ipcRenderer.send(IPC.SHOW_VIDEO, staged.path, startTime);
      live = { ...staged };
      isSynced = true;
      updateLiveDisplay();
      updateGoLiveButton();
      updateTransportUI();
      return;
    }
    
    if (staged.type === 'single-audio') {
      stopLiveSlideshowTimer();
      stopLiveVideo();
      stopLiveAudio();
      const startTime = staged.currentTime || 0;
      ipcRenderer.send(IPC.PLAY_AUDIO, staged.path, startTime);
      live = { ...staged };
      isSynced = true;
      updateLiveDisplay();
      updateGoLiveButton();
      updateTransportUI();
      return;
    }
    
    if (staged.type === 'scripture') {
      stopLiveSlideshowTimer();
      stopLiveVideo();
      stopLiveAudio();
      ipcRenderer.send(IPC.SHOW_SCRIPTURE, {
        reference: staged.reference,
        text: staged.text,
        version: staged.version,
        compareText: staged.compareText,
        compareVersion: staged.compareVersion,
        background: settings.scriptureBackground || '#000000',
        backgroundImage: settings.scriptureBackgroundImage || null,
        fontFamily: settings.scriptureFontFamily || 'Georgia',
        fontSize: settings.scriptureFontSize || 48,
        fontColor: settings.scriptureFontColor || '#FFFFFF'
      });
      live = { 
        ...staged,
        liveBackground: settings.scriptureBackground || '#000000',
        liveBackgroundImage: settings.scriptureBackgroundImage || null,
        liveFontFamily: settings.scriptureFontFamily || 'Georgia',
        liveFontSize: settings.scriptureFontSize || 48,
        liveFontColor: settings.scriptureFontColor || '#FFFFFF'
      };
      isSynced = true;
      
      fetchAndCacheChapter(live.bibleId, live.bookId, live.chapter).then(() => {
        prefetchNearbyChapter(live.bibleId, live.bookId, live.chapter, live.verse, live.bibleId2);
      });
      if (live.bibleId2) {
        fetchAndCacheChapter(live.bibleId2, live.bookId, live.chapter).catch(() => {});
      }
      
      updateLiveDisplay();
      updateGoLiveButton();
      updateTransportUI();
      renderScriptureLists();
      return;
    }

    if (staged.type === 'quick-slide') {
      stopLiveSlideshowTimer();
      stopLiveVideo();
      stopLiveAudio();
      
      const slideData = {
        preset: staged.preset,
        title: staged.title,
        body: staged.body,
        elements: staged.elements,
        background: staged.background,
        backgroundImage: staged.backgroundImage,
        backgroundDim: staged.backgroundDim,
        fontFamily: staged.fontFamily,
        titleFontSize: staged.titleFontSize,
        fontSize: staged.fontSize,
        fontColor: staged.fontColor,
        verticalAlign: staged.verticalAlign,
        horizontalAlign: staged.horizontalAlign,
        textWidth: staged.textWidth,
        countdownLabel: staged.countdownLabel,
        durationMinutes: staged.durationMinutes,
        durationSeconds: staged.durationSeconds,
        endTime: staged.endTime
      };
      
      if (staged.preset === 'countdown' && !staged.endTime) {
        const durationMs = ((staged.durationMinutes || 0) * 60 + (staged.durationSeconds || 0)) * 1000;
        slideData.endTime = Date.now() + durationMs;
      }
      
      if (staged.preset === 'custom' && staged.elements) {
        slideData.elements = staged.elements.map(el => {
          if (el.type === 'countdown') {
            const durationMs = ((el.durationMinutes || 0) * 60 + (el.durationSeconds || 0)) * 1000;
            return { ...el, endTime: Date.now() + durationMs };
          }
          return el;
        });
      }
      
      ipcRenderer.send(IPC.SHOW_QUICK_SLIDE, slideData);
      live = { ...staged, endTime: slideData.endTime };
      isSynced = true;
      updateLiveDisplay();
      updateGoLiveButton();
      updateTransportUI();
      return;
    }
    
    if (staged.type === 'slideshow') {
      pushSlideshowLive();
      return;
    }
  });

  clearBtn.addEventListener('click', () => {
    selectedImage = null;
    document.querySelectorAll('.thumbnail-item').forEach(item => {
      item.classList.remove('selected');
    });
    staged = null;
    isSynced = false;
    cleanupPreviewVideo();
    updatePreviewDisplay();
    updateGoLiveButton();
    updateQueueButton();
    updateTransportUI();
    renderSlideshowQueue();
  });
}

function setupImageControls() {
  const addFolderBtn = document.getElementById('addFolderBtn');
  const addFilesBtn = document.getElementById('addFilesBtn');

  addFolderBtn.addEventListener('click', async () => {
    const folder = await ipcRenderer.invoke(IPC.PICK_FOLDER);
    if (folder) {
      const files = await ipcRenderer.invoke(IPC.SCAN_FOLDER, folder);
      const mediaFiles = files.filter(f => f.type === 'image' || f.type === 'video');
      if (mediaFiles.length > 0) {
        const newItems = mediaFiles.map(f => ({
          id: generateMediaId(),
          originalPath: f.path,
          internalPath: null,
          name: f.name,
          type: f.type,
          displayName: path.basename(f.path).replace(/\.[^/.]+$/, ''),
          copyStatus: 'pending'
        }));
        mediaLibrary = await ipcRenderer.invoke(IPC.ADD_TO_LIBRARY, newItems);
        renderImageGrid();
        queueMediaCopies(newItems);
      }
    }
  });

  addFilesBtn.addEventListener('click', async () => {
    const filePaths = await ipcRenderer.invoke(IPC.PICK_FILE, [
      { name: 'Media', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'webm', 'mov', 'avi', 'mkv', 'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'] }
    ]);
    if (filePaths.length > 0) {
      const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
      const videoExts = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
      const newItems = filePaths.map(p => {
        const ext = path.extname(p).toLowerCase();
        let type = 'audio';
        if (imageExts.includes(ext)) type = 'image';
        else if (videoExts.includes(ext)) type = 'video';
        return {
          id: generateMediaId(),
          originalPath: p,
          internalPath: null,
          name: path.basename(p),
          type,
          displayName: path.basename(p).replace(/\.[^/.]+$/, ''),
          copyStatus: 'pending'
        };
      });
      mediaLibrary = await ipcRenderer.invoke(IPC.ADD_TO_LIBRARY, newItems);
      renderImageGrid();
      queueMediaCopies(newItems);
    }
  });
}

function setupFilterToggles() {
  const filterBtns = document.querySelectorAll('.filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.filter;
      filterBtns.forEach(b => b.classList.toggle('active', b === btn));
      renderImageGrid();
    });
  });
}

async function generateMissingThumbnails(videoFiles) {
  for (const file of videoFiles) {
    const mediaId = getMediaThumbnailId(file);
    const effectivePath = getEffectivePath(file);
    const existing = await ipcRenderer.invoke(IPC.GET_THUMBNAIL, mediaId);
    if (!existing) {
      await generateVideoThumbnail(mediaId, effectivePath);
    }
  }
}

function generateVideoThumbnail(mediaId, videoPath) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.src = 'file://' + videoPath;
    video.muted = true;
    video.preload = 'metadata';
    
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1, video.duration / 4);
    };
    
    video.onseeked = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      await ipcRenderer.invoke(IPC.SAVE_THUMBNAIL, mediaId, dataUrl);
      video.src = '';
      resolve();
    };
    
    video.onerror = () => {
      resolve();
    };
  });
}

function renderImageGrid() {
  const grid = document.getElementById('imageGrid');
  let items = [...mediaLibrary, ...quickSlides];
  
  if (currentFilter === 'image') {
    items = mediaLibrary.filter(f => f.type === 'image');
  } else if (currentFilter === 'video') {
    items = mediaLibrary.filter(f => f.type === 'video');
  } else if (currentFilter === 'audio') {
    items = mediaLibrary.filter(f => f.type === 'audio');
  } else if (currentFilter === 'quick-slide') {
    items = quickSlides;
  }

  grid.innerHTML = '';

  if (items.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'empty-library';
    const filterText = currentFilter === 'all' ? 'media' : currentFilter + 's';
    const hint = currentFilter === 'quick-slide' 
      ? 'Create slides in the Quick Slides tab'
      : 'Add a folder or individual files to get started';
    emptyDiv.innerHTML = `<p>No ${filterText} in library</p><p class="hint">${hint}</p>`;
    grid.appendChild(emptyDiv);
    return;
  }

  items.forEach(file => {
    const item = document.createElement('div');
    item.className = 'thumbnail-item';
    item.dataset.path = file.id || file.path;
    item.dataset.type = file.type;
    
    const isQuickSlide = file.type === 'quick-slide';
    const isBroken = !isQuickSlide && isPathBroken(file.originalPath || file.path);
    const isCopying = !isQuickSlide && file.copyStatus === 'pending';
    const hasCopyError = !isQuickSlide && file.copyStatus === 'error';
    
    if (isBroken) {
      item.classList.add('broken');
    }
    if (isCopying) {
      item.classList.add('copying');
    }

    const imgContainer = document.createElement('div');
    imgContainer.className = 'thumbnail-image';

    if (isBroken) {
      const brokenOverlay = document.createElement('div');
      brokenOverlay.className = 'broken-overlay';
      brokenOverlay.innerHTML = '!';
      brokenOverlay.title = 'File not found';
      imgContainer.appendChild(brokenOverlay);
      
      const placeholder = document.createElement('div');
      placeholder.style.cssText = 'width:100%;height:100%;background:#333;';
      imgContainer.appendChild(placeholder);
    } else if (isQuickSlide) {
      renderQuickSlideThumbnail(file, imgContainer);
    } else if (file.type === 'video') {
      renderVideoThumbnail(file, imgContainer);
    } else if (file.type === 'audio') {
      renderAudioThumbnail(file, imgContainer);
    } else {
      const img = document.createElement('img');
      const imgPath = file.internalPath || file.originalPath || file.path;
      img.src = 'file://' + imgPath;
      img.alt = file.displayName || file.name;

      img.onload = () => {
        const warnings = checkImageWarnings(img.naturalWidth, img.naturalHeight);
        if (warnings.length > 0) {
          const warningBadge = document.createElement('div');
          warningBadge.className = 'resolution-warning';
          warningBadge.title = warnings.join('\n');
          warningBadge.innerHTML = '⚠';
          imgContainer.appendChild(warningBadge);
        }
      };
      imgContainer.appendChild(img);
    }

    if (isCopying) {
      const spinner = document.createElement('div');
      spinner.className = 'copy-spinner';
      spinner.title = 'Importing...';
      imgContainer.appendChild(spinner);
    } else if (hasCopyError) {
      const errorOverlay = document.createElement('div');
      errorOverlay.className = 'copy-error-overlay';
      errorOverlay.innerHTML = '!';
      errorOverlay.title = file.copyError || 'Import failed';
      imgContainer.appendChild(errorOverlay);
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.innerHTML = '×';
    removeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (isQuickSlide) {
        const result = await ipcRenderer.invoke(IPC.DELETE_QUICK_SLIDE, file.id);
        if (result.success) {
          quickSlides = result.slides;
        }
      } else {
        mediaLibrary = await ipcRenderer.invoke(IPC.REMOVE_FROM_LIBRARY, file.id || file.path);
        brokenPaths.delete(file.originalPath || file.path);
        updateStorageDisplay();
      }
      const itemId = file.id || file.path;
      if (selectedImage === itemId) {
        selectedImage = null;
        staged = null;
        updatePreviewDisplay();
      }
      renderImageGrid();
    });

    imgContainer.appendChild(removeBtn);

    if (isQuickSlide && !isBroken) {
      const editBtn = document.createElement('button');
      editBtn.className = 'edit-btn';
      editBtn.innerHTML = '✏️';
      editBtn.title = 'Edit Quick Slide';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        switchMode('quick-slides');
        loadQuickSlideForEdit(file);
      });
      imgContainer.appendChild(editBtn);
    }

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'thumbnail-name';
    if (isQuickSlide) {
      const presetLabel = file.preset.charAt(0).toUpperCase() + file.preset.slice(1);
      nameInput.value = file.displayName || file.title || file.body.substring(0, 20) || presetLabel;
    } else {
      nameInput.value = file.displayName || file.name.replace(/\.[^/.]+$/, '');
    }
    nameInput.addEventListener('click', (e) => e.stopPropagation());
    nameInput.addEventListener('change', async (e) => {
      const newName = e.target.value.trim();
      if (!newName) return;
      if (isQuickSlide) {
        const result = await ipcRenderer.invoke(IPC.UPDATE_QUICK_SLIDE, file.id, { displayName: newName });
        if (result.success) {
          file.displayName = newName;
          quickSlides = result.slides;
        }
      } else {
        await ipcRenderer.invoke(IPC.UPDATE_LIBRARY_ITEM, file.id || file.path, { displayName: newName });
        file.displayName = newName;
      }
    });

    item.appendChild(imgContainer);
    item.appendChild(nameInput);
    
    if (isBroken) {
      imgContainer.addEventListener('click', (e) => showBrokenContextMenu(e, file));
    } else {
      imgContainer.addEventListener('click', () => selectMedia(file));
      if (isQuickSlide) {
        imgContainer.addEventListener('dblclick', () => {
          switchMode('quick-slides');
          loadQuickSlideForEdit(file);
        });
      }
    }
    grid.appendChild(item);
  });
}

async function renderVideoThumbnail(file, container) {
  const mediaId = getMediaThumbnailId(file);
  const thumbnailPath = await ipcRenderer.invoke(IPC.GET_THUMBNAIL, mediaId);
  
  if (thumbnailPath) {
    const img = document.createElement('img');
    img.src = 'file://' + thumbnailPath;
    img.alt = file.displayName || file.name;
    container.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'video-placeholder';
    placeholder.innerHTML = '🎬';
    container.appendChild(placeholder);
  }
  
  const videoBadge = document.createElement('div');
  videoBadge.className = 'video-badge';
  videoBadge.innerHTML = '▶';
  container.appendChild(videoBadge);
}

function renderAudioThumbnail(file, container) {
  const placeholder = document.createElement('div');
  placeholder.style.cssText = 'width:100%;height:100%;background:#1a2744;display:flex;align-items:center;justify-content:center;';
  container.appendChild(placeholder);
  
  const audioBadge = document.createElement('div');
  audioBadge.className = 'audio-badge';
  audioBadge.innerHTML = '🎵';
  container.appendChild(audioBadge);
}

function renderQuickSlideThumbnail(slide, container) {
  const preview = document.createElement('div');
  preview.className = 'quick-slide-thumbnail';
  
  if (slide.backgroundImage) {
    preview.style.backgroundImage = `url('file:///${slide.backgroundImage.replace(/\\/g, '/')}')`;
    preview.style.backgroundSize = 'cover';
    preview.style.backgroundPosition = 'center';
  } else {
    preview.style.backgroundColor = slide.background || '#000';
  }
  
  if (slide.preset === 'countdown') {
    if (slide.countdownLabel) {
      const labelEl = document.createElement('div');
      labelEl.className = 'qs-thumb-body';
      labelEl.style.color = slide.fontColor || '#fff';
      labelEl.style.fontFamily = slide.fontFamily || 'Georgia';
      labelEl.textContent = slide.countdownLabel;
      preview.appendChild(labelEl);
    }
    const timerEl = document.createElement('div');
    timerEl.className = 'qs-thumb-title';
    timerEl.style.color = slide.fontColor || '#fff';
    timerEl.style.fontFamily = slide.fontFamily || 'Georgia';
    const mins = slide.durationMinutes || 0;
    const secs = slide.durationSeconds || 0;
    timerEl.textContent = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    preview.appendChild(timerEl);
  } else if (slide.preset === 'custom' && slide.elements && slide.elements.length > 0) {
    const summaryText = slide.elements.map(el => el.text || '').filter(t => t).join(' / ');
    const truncated = summaryText.length > 40 ? summaryText.substring(0, 40) + '...' : summaryText;
    if (truncated) {
      const bodyEl = document.createElement('div');
      bodyEl.className = 'qs-thumb-body';
      bodyEl.style.color = slide.fontColor || '#fff';
      bodyEl.style.fontFamily = slide.fontFamily || 'Georgia';
      bodyEl.textContent = truncated;
      preview.appendChild(bodyEl);
    }
  } else {
    const showTitle = slide.preset === 'announcement' || slide.preset === 'prayer';
    
    if (showTitle && slide.title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'qs-thumb-title';
      titleEl.style.color = slide.fontColor || '#fff';
      titleEl.style.fontFamily = slide.fontFamily || 'Georgia';
      titleEl.textContent = slide.title;
      preview.appendChild(titleEl);
    }
    
    if (slide.body) {
      const bodyEl = document.createElement('div');
      bodyEl.className = 'qs-thumb-body';
      bodyEl.style.color = slide.fontColor || '#fff';
      bodyEl.style.fontFamily = slide.fontFamily || 'Georgia';
      bodyEl.textContent = slide.body.length > 50 ? slide.body.substring(0, 50) + '...' : slide.body;
      preview.appendChild(bodyEl);
    }
  }
  
  const badge = document.createElement('div');
  badge.className = 'quick-slide-badge';
  badge.textContent = 'QS';
  preview.appendChild(badge);
  
  container.appendChild(preview);
}

function checkImageWarnings(imgWidth, imgHeight) {
  const warnings = [];
  const monitorWidth = displayResolution.width;
  const monitorHeight = displayResolution.height;
  
  if (imgWidth < monitorWidth || imgHeight < monitorHeight) {
    const maxScale = Math.max(monitorWidth / imgWidth, monitorHeight / imgHeight);
    if (maxScale > 1.5) {
      warnings.push(`Low resolution: ${imgWidth}×${imgHeight} (monitor: ${monitorWidth}×${monitorHeight})`);
    }
  }
  
  const imgRatio = imgWidth / imgHeight;
  const monitorRatio = monitorWidth / monitorHeight;
  const ratioDiff = Math.abs(imgRatio - monitorRatio);
  
  if (ratioDiff > 0.3) {
    warnings.push('Aspect ratio differs significantly from monitor');
  }
  
  return warnings;
}

function selectImage(imagePath) {
  const file = mediaLibrary.find(f => f.path === imagePath);
  if (file) {
    selectMedia(file);
  }
}

function selectMedia(file) {
  const itemId = file.id || file.path;
  selectedImage = itemId;
  document.querySelectorAll('.thumbnail-item').forEach(item => {
    item.classList.toggle('selected', item.dataset.path === itemId);
  });
  
  if (file.type === 'quick-slide') {
    staged = { ...file };
    if (file.preset === 'countdown') {
      const durationMs = ((file.durationMinutes || 0) * 60 + (file.durationSeconds || 0)) * 1000;
      staged.endTime = Date.now() + durationMs;
    }
  } else {
    const effectivePath = getEffectivePath(file);
    const displayName = file.displayName || path.basename(effectivePath).replace(/\.[^/.]+$/, '');
    
    if (file.type === 'video') {
      staged = createSingleVideo(effectivePath, displayName);
    } else if (file.type === 'audio') {
      staged = createSingleAudio(effectivePath, displayName);
    } else {
      staged = createSingleImage(effectivePath, displayName);
    }
  }
  isSynced = false;
  
  updatePreviewDisplay();
  updateGoLiveButton();
  updateTransportUI();
}

function setupSlideshowControls() {
  const presetSelect = document.getElementById('presetSelect');
  const renameBtn = document.getElementById('renamePresetBtn');
  const deleteBtn = document.getElementById('deletePresetBtn');
  const saveBtn = document.getElementById('savePresetBtn');
  const addBtn = document.getElementById('addToSlideshowBtn');
  const queueBtn = document.getElementById('queueSlideshowBtn');
  
  const intervalInput = document.getElementById('intervalInput');
  const intervalDown = document.getElementById('intervalDown');
  const intervalUp = document.getElementById('intervalUp');
  const loopCheckbox = document.getElementById('loopCheckbox');
  const transitionSelect = document.getElementById('transitionSelect');

  updatePresetDropdown();

  presetSelect.addEventListener('change', async () => {
    const presetId = presetSelect.value;
    if (presetId) {
      const preset = slideshowPresets.find(p => p.id === presetId);
      const brokenImages = preset.images.filter(img => isPathBroken(img.path));
      
      if (brokenImages.length > 0) {
        await ipcRenderer.invoke(IPC.CONFIRM_DIALOG, {
          type: 'warning',
          title: 'Cannot Load Preset',
          message: `"${preset.name}" has ${brokenImages.length} missing file(s). Please fix broken links in the Media Library first.`,
          buttons: ['OK']
        });
        presetSelect.value = currentPreset?.id || '';
        return;
      }
      
      currentPreset = preset;
      loadPresetToStaged();
    } else {
      currentPreset = null;
      resetStagedSlideshow();
    }
    isSynced = false;
    updatePresetButtons();
  });

  renameBtn.addEventListener('click', async () => {
    if (!currentPreset) return;
    const newName = await ipcRenderer.invoke(IPC.PROMPT_DIALOG, {
      title: 'Rename Preset',
      defaultValue: currentPreset.name
    });
    if (newName && newName.trim()) {
      currentPreset.name = newName.trim();
      await ipcRenderer.invoke(IPC.SAVE_SLIDESHOW_PRESET, currentPreset);
      updatePresetDropdown();
    }
  });

  deleteBtn.addEventListener('click', async () => {
    if (!currentPreset) return;
    const confirmed = await ipcRenderer.invoke(IPC.CONFIRM_DIALOG, {
      title: 'Delete Preset',
      message: `Delete "${currentPreset.name}"?`,
      buttons: ['Cancel', 'Delete']
    });
    if (confirmed) {
      const result = await ipcRenderer.invoke(IPC.DELETE_SLIDESHOW_PRESET, currentPreset.id);
      slideshowPresets = result.presets;
      currentPreset = null;
      resetStagedSlideshow();
      updatePresetDropdown();
      updatePresetButtons();
    }
  });

  saveBtn.addEventListener('click', async () => {
    const stagedQueue = getStagedSlideshowQueue();
    if (!stagedQueue || stagedQueue.length === 0) return;
    
    const stagedShow = staged?.type === 'slideshow' ? staged : null;
    
    const preset = {
      id: currentPreset?.id || generateId(),
      name: currentPreset?.name || `Slideshow ${slideshowPresets.length + 1}`,
      images: stagedQueue.map(img => ({ path: img.path, displayName: img.displayName })),
      settings: {
        interval: stagedShow?.interval || queuedSettings.interval,
        loop: stagedShow?.loop !== undefined ? stagedShow.loop : queuedSettings.loop,
        transition: stagedShow?.transition || queuedSettings.transition
      }
    };
    
    if (!currentPreset && slideshowPresets.length >= 3) {
      await ipcRenderer.invoke(IPC.CONFIRM_DIALOG, {
        title: 'Limit Reached',
        message: 'Maximum of 3 presets allowed. Delete one first.',
        buttons: ['OK']
      });
      return;
    }
    
    const result = await ipcRenderer.invoke(IPC.SAVE_SLIDESHOW_PRESET, preset);
    if (result.error) {
      await ipcRenderer.invoke(IPC.CONFIRM_DIALOG, {
        title: 'Error',
        message: result.error,
        buttons: ['OK']
      });
      return;
    }
    slideshowPresets = result.presets;
    currentPreset = preset;
    if (staged?.type === 'slideshow') {
      staged.id = preset.id;
    }
    updatePresetDropdown();
    updatePresetButtons();
  });

  addBtn.addEventListener('click', () => openModal());
  
  queueBtn.addEventListener('click', () => {
    let queue = getStagedSlideshowQueue();
    if (!queue) queue = [];
    
    if (staged?.type === 'slideshow') {
      queue = [...queue];
      staged.pendingAdds.forEach(img => {
        if (!queue.some(q => q.path === img.path)) {
          queue.push(img);
        }
      });
      staged.pendingRemoves.forEach(imgPath => {
        const idx = queue.findIndex(q => q.path === imgPath);
        if (idx >= 0) {
          queue.splice(idx, 1);
        }
      });
    }
    
    if (queue.length === 0) return;
    
    staged = createSlideshow(
      currentPreset?.id || null,
      queue,
      0,
      queuedSettings.interval,
      queuedSettings.loop,
      queuedSettings.transition
    );
    
    isSynced = false;
    
    renderSlideshowQueue();
    updateQueueButton();
    updateTransportUI();
    updateGoLiveButton();
    updatePreviewDisplay();
  });

  intervalInput.addEventListener('change', () => {
    queuedSettings.interval = parseInt(intervalInput.value, 10) * 1000;
    updateQueueButton();
  });

  intervalDown.addEventListener('click', () => {
    const val = parseInt(intervalInput.value, 10);
    if (val > 1) {
      intervalInput.value = val - 1;
      queuedSettings.interval = (val - 1) * 1000;
      updateQueueButton();
    }
  });

  intervalUp.addEventListener('click', () => {
    const val = parseInt(intervalInput.value, 10);
    if (val < 60) {
      intervalInput.value = val + 1;
      queuedSettings.interval = (val + 1) * 1000;
      updateQueueButton();
    }
  });

  loopCheckbox.addEventListener('change', () => {
    queuedSettings.loop = loopCheckbox.checked;
    updateQueueButton();
  });

  transitionSelect.addEventListener('change', () => {
    queuedSettings.transition = transitionSelect.value;
    updateQueueButton();
    if (!live || live.type !== 'slideshow') {
      ipcRenderer.send(IPC.SET_TRANSITION, transitionSelect.value);
    }
  });
}

function setupStagedTransportControls() {
  const prevBtn = document.getElementById('stagedPrevBtn');
  const pauseBtn = document.getElementById('stagedPauseBtn');
  const nextBtn = document.getElementById('stagedNextBtn');
  
  prevBtn.addEventListener('click', () => {
    if (staged?.type !== 'slideshow') return;
    staged.index--;
    if (staged.index < 0) {
      staged.index = staged.queue.length - 1;
    }
    if (isSynced && live?.type === 'slideshow') {
      live.index = staged.index;
      showCurrentLiveSlide();
      if (!live.paused) resetLiveTimer();
    }
    updatePreviewDisplay();
    renderSlideshowQueue();
    updateTransportUI();
    updateGoLiveButton();
  });
  
  pauseBtn.addEventListener('click', () => {
    if (!isSynced || live?.type !== 'slideshow') {
      if (previewVideo) {
        if (previewVideo.paused) {
          previewVideo.play();
        } else {
          previewVideo.pause();
        }
        updateTransportUI();
      }
      return;
    }
    if (live.paused) {
      resumeLiveSlideshow();
    } else {
      pauseLiveSlideshow();
    }
  });
  
  nextBtn.addEventListener('click', () => {
    if (staged?.type !== 'slideshow') return;
    staged.index++;
    if (staged.index >= staged.queue.length) {
      staged.index = 0;
    }
    if (isSynced && live?.type === 'slideshow') {
      live.index = staged.index;
      showCurrentLiveSlide();
      if (!live.paused) resetLiveTimer();
    }
    updatePreviewDisplay();
    renderSlideshowQueue();
    updateTransportUI();
    updateGoLiveButton();
  });
}

function setupLiveTransportControls() {
  const prevBtn = document.getElementById('livePrevBtn');
  const pauseBtn = document.getElementById('livePauseBtn');
  const nextBtn = document.getElementById('liveNextBtn');
  const stopBtn = document.getElementById('liveStopBtn');
  
  prevBtn.addEventListener('click', () => {
    if (live?.type !== 'slideshow') return;
    live.index--;
    if (live.index < 0) {
      live.index = live.queue.length - 1;
    }
    showCurrentLiveSlide();
    if (!live.paused) resetLiveTimer();
    updateLiveDisplay();
    updateTransportUI();
    
    if (isSynced && staged?.type === 'slideshow') {
      staged.index = live.index;
      updatePreviewDisplay();
      renderSlideshowQueue();
    }
  });
  
  pauseBtn.addEventListener('click', () => {
    if (live?.type !== 'slideshow') return;
    if (live.paused) {
      resumeLiveSlideshow();
    } else {
      pauseLiveSlideshow();
    }
  });
  
  nextBtn.addEventListener('click', () => {
    if (live?.type !== 'slideshow') return;
    live.index++;
    if (live.index >= live.queue.length) {
      live.index = 0;
    }
    showCurrentLiveSlide();
    if (!live.paused) resetLiveTimer();
    updateLiveDisplay();
    updateTransportUI();
    
    if (isSynced && staged?.type === 'slideshow') {
      staged.index = live.index;
      updatePreviewDisplay();
      renderSlideshowQueue();
    }
  });
  
  stopBtn.addEventListener('click', () => {
    if (live?.type !== 'slideshow') return;
    stopLiveSlideshow();
  });
}

function setupVideoTransportControls() {
  const previewPlayBtn = document.getElementById('previewVideoPlayBtn');
  const previewSlider = document.getElementById('previewVideoSlider');
  const livePlayBtn = document.getElementById('liveVideoPlayBtn');
  const liveRestartBtn = document.getElementById('liveVideoRestartBtn');
  const liveStopBtn = document.getElementById('liveVideoStopBtn');
  const liveSlider = document.getElementById('liveVideoSlider');
  
  previewPlayBtn.addEventListener('click', () => {
    if (!previewVideo) return;
    if (previewVideo.paused) {
      previewVideo.play();
      previewPlayBtn.textContent = '⏸️';
    } else {
      previewVideo.pause();
      previewPlayBtn.textContent = '▶️';
    }
    if (live?.type === 'single-video') {
      isSynced = false;
      updateGoLiveButton();
    }
  });
  
  previewSlider.addEventListener('input', () => {
    if (!previewVideo || !previewVideo.duration) return;
    const time = (previewSlider.value / 100) * previewVideo.duration;
    previewVideo.currentTime = time;
    previewSlider.style.setProperty('--progress', previewSlider.value + '%');
    if (staged?.type === 'single-video') {
      staged.currentTime = time;
      isSynced = false;
      updateGoLiveButton();
    }
    const isStagedSlideshowVideo = staged?.type === 'slideshow' && staged.queue[staged.index]?.type === 'video';
    if (isSynced && isStagedSlideshowVideo && live?.waitingForVideo) {
      ipcRenderer.send(IPC.CONTROL_VIDEO, 'seek', time);
    }
  });
  
  livePlayBtn.addEventListener('click', () => {
    const isSlideVideo = live?.type === 'slideshow' && live.waitingForVideo;
    if (live?.type !== 'single-video' && !isSlideVideo) return;
    if (liveVideoState?.paused) {
      ipcRenderer.send(IPC.CONTROL_VIDEO, 'play');
      if (isSynced && staged?.type === 'single-video' && previewVideo) {
        previewVideo.play();
      }
    } else {
      ipcRenderer.send(IPC.CONTROL_VIDEO, 'pause');
      if (isSynced && staged?.type === 'single-video' && previewVideo) {
        previewVideo.pause();
      }
    }
  });
  
  liveRestartBtn.addEventListener('click', () => {
    const isSlideVideo = live?.type === 'slideshow' && live.waitingForVideo;
    if (live?.type !== 'single-video' && !isSlideVideo) return;
    ipcRenderer.send(IPC.CONTROL_VIDEO, 'restart');
    if (isSynced && staged?.type === 'single-video' && previewVideo) {
      previewVideo.currentTime = 0;
      staged.currentTime = 0;
      previewVideo.play();
    }
  });
  
  liveStopBtn.addEventListener('click', () => {
    if (live?.type !== 'single-video') return;
    const wasSynced = isSynced;
    stopLiveVideo();
    ipcRenderer.send(IPC.SHOW_STANDBY);
    live = createStandby();
    isSynced = false;
    if (wasSynced) {
      staged = null;
      cleanupPreviewVideo();
      updatePreviewDisplay();
    }
    updateLiveDisplay();
    updateGoLiveButton();
    updateVideoTransportUI();
  });
  
  liveSlider.addEventListener('input', () => {
    const isLiveSlideshowVideo = live?.type === 'slideshow' && live.waitingForVideo;
    if (live?.type !== 'single-video' && !isLiveSlideshowVideo) return;
    if (!liveVideoState?.duration) return;
    const time = (liveSlider.value / 100) * liveVideoState.duration;
    ipcRenderer.send(IPC.CONTROL_VIDEO, 'seek', time);
    liveSlider.style.setProperty('--progress', liveSlider.value + '%');
    if (isSynced && staged?.type === 'single-video' && previewVideo) {
      previewVideo.currentTime = time;
      staged.currentTime = time;
    }
    if (isSynced && isLiveSlideshowVideo && previewVideo) {
      previewVideo.currentTime = time;
    }
  });
  
  ipcRenderer.on(IPC.VIDEO_STATE, (event, state) => {
    if (state.ended && live?.type === 'slideshow' && live.waitingForVideo) {
      live.waitingForVideo = false;
      advanceLiveSlide();
      return;
    }
    
    if (live?.type === 'slideshow' && live.waitingForVideo) {
      liveVideoState = state;
      updateLiveVideoUI();
      updateVideoTransportUI();
      updateTransportUI();
      
      if (isSynced && previewVideo) {
        if (state.playing && previewVideo.paused) {
          previewVideo.play();
        } else if (state.paused && !previewVideo.paused) {
          previewVideo.pause();
        }
        if (state.playing) {
          previewVideo.currentTime = state.currentTime;
          updatePreviewVideoUI();
        }
      }
      return;
    }
    
    if (live?.type !== 'single-video') {
      return;
    }
    
    if (state.stopped) {
      if (live.path === state.path) {
        live = createStandby();
        updateLiveDisplay();
        updateGoLiveButton();
      }
      return;
    }
    
    liveVideoState = state;
    
    updateLiveVideoUI();
    
    if (isSynced && staged?.type === 'single-video' && previewVideo) {
      if (state.playing && previewVideo.paused) {
        previewVideo.play();
      } else if (state.paused && !previewVideo.paused) {
        previewVideo.pause();
      }
      
      if (state.playing) {
        previewVideo.currentTime = state.currentTime;
        staged.currentTime = state.currentTime;
        updatePreviewVideoUI();
      }
    }
  });
  
  ipcRenderer.on(IPC.IMAGE_ERROR, (event, imagePath) => {
    brokenPaths.add(imagePath);
    if (live?.type === 'slideshow') {
      advanceLiveSlide();
    } else if (live?.type === 'single-image' && live.path === imagePath) {
      ipcRenderer.send(IPC.SHOW_STANDBY);
      live = createStandby();
      updateLiveDisplay();
    }
    renderImageGrid();
  });
  
  ipcRenderer.on(IPC.VIDEO_ERROR, (event, videoPath) => {
    brokenPaths.add(videoPath);
    if (live?.type === 'slideshow') {
      live.waitingForVideo = false;
      advanceLiveSlide();
    } else if (live?.type === 'single-video' && live.path === videoPath) {
      ipcRenderer.send(IPC.SHOW_STANDBY);
      live = createStandby();
      updateLiveDisplay();
    }
    renderImageGrid();
  });
}

function setupAudioTransportControls() {
  const previewPlayBtn = document.getElementById('previewAudioPlayBtn');
  const previewSlider = document.getElementById('previewAudioSlider');
  const livePlayBtn = document.getElementById('liveAudioPlayBtn');
  const liveRestartBtn = document.getElementById('liveAudioRestartBtn');
  const liveStopBtn = document.getElementById('liveAudioStopBtn');
  const liveSlider = document.getElementById('liveAudioSlider');
  
  previewPlayBtn.addEventListener('click', () => {
    if (!previewAudio) return;
    if (previewAudio.paused) {
      previewAudio.play();
      previewPlayBtn.textContent = '⏸️';
    } else {
      previewAudio.pause();
      previewPlayBtn.textContent = '▶️';
    }
    if (live?.type === 'single-audio') {
      isSynced = false;
      updateGoLiveButton();
    }
  });
  
  previewSlider.addEventListener('input', () => {
    if (!previewAudio || !previewAudio.duration) return;
    const time = (previewSlider.value / 100) * previewAudio.duration;
    previewAudio.currentTime = time;
    previewSlider.style.setProperty('--progress', previewSlider.value + '%');
    if (staged?.type === 'single-audio') {
      staged.currentTime = time;
      isSynced = false;
      updateGoLiveButton();
    }
  });
  
  livePlayBtn.addEventListener('click', () => {
    if (live?.type !== 'single-audio') return;
    if (liveAudioState?.paused) {
      ipcRenderer.send(IPC.CONTROL_AUDIO, 'play');
      if (isSynced && staged?.type === 'single-audio' && previewAudio) {
        previewAudio.play();
      }
    } else {
      ipcRenderer.send(IPC.CONTROL_AUDIO, 'pause');
      if (isSynced && staged?.type === 'single-audio' && previewAudio) {
        previewAudio.pause();
      }
    }
  });
  
  liveRestartBtn.addEventListener('click', () => {
    if (live?.type !== 'single-audio') return;
    ipcRenderer.send(IPC.CONTROL_AUDIO, 'restart');
    if (isSynced && staged?.type === 'single-audio' && previewAudio) {
      previewAudio.currentTime = 0;
      staged.currentTime = 0;
      previewAudio.play();
      updatePreviewAudioUI();
    }
  });
  
  liveStopBtn.addEventListener('click', () => {
    if (live?.type !== 'single-audio') return;
    const wasSynced = isSynced;
    stopLiveAudio();
    ipcRenderer.send(IPC.SHOW_STANDBY);
    live = createStandby();
    isSynced = false;
    if (wasSynced) {
      staged = null;
      cleanupPreviewAudio();
      updatePreviewDisplay();
    }
    updateLiveDisplay();
    updateGoLiveButton();
    updateAudioTransportUI();
  });
  
  liveSlider.addEventListener('input', () => {
    if (live?.type !== 'single-audio' || !liveAudioState?.duration) return;
    const time = (liveSlider.value / 100) * liveAudioState.duration;
    ipcRenderer.send(IPC.CONTROL_AUDIO, 'seek', time);
    liveSlider.style.setProperty('--progress', liveSlider.value + '%');
    if (isSynced && staged?.type === 'single-audio' && previewAudio) {
      previewAudio.currentTime = time;
      staged.currentTime = time;
    }
  });
  
  ipcRenderer.on(IPC.AUDIO_STATE, (event, state) => {
    if (live?.type !== 'single-audio') {
      return;
    }
    
    if (state.stopped) {
      if (live.path === state.path) {
        live = createStandby();
        updateLiveDisplay();
        updateGoLiveButton();
      }
      return;
    }
    
    liveAudioState = state;
    updateLiveAudioUI();
    
    if (isSynced && staged?.type === 'single-audio' && previewAudio) {
      if (state.playing && previewAudio.paused) {
        previewAudio.play();
      } else if (state.paused && !previewAudio.paused) {
        previewAudio.pause();
      }
      
      if (state.playing) {
        previewAudio.currentTime = state.currentTime;
        staged.currentTime = state.currentTime;
        updatePreviewAudioUI();
      }
    }
  });
}

function setupScriptureControls() {
  const compareModeCheckbox = document.getElementById('compareModeCheckbox');
  const compareVersionRow = document.getElementById('compareVersionRow');
  
  compareModeCheckbox.addEventListener('change', () => {
    if (compareModeCheckbox.checked) {
      compareVersionRow.classList.add('visible');
    } else {
      compareVersionRow.classList.remove('visible');
    }
  });
  
  const scriptureTextInput = document.getElementById('scriptureTextInput');
  const parsePreview = document.getElementById('parsePreview');
  const lookupTextBtn = document.getElementById('lookupTextBtn');
  
  scriptureTextInput.addEventListener('input', () => {
    const val = scriptureTextInput.value.trim();
    if (val) {
      parsePreview.textContent = `Will lookup: "${val}"`;
      parsePreview.style.color = '#888';
    } else {
      parsePreview.textContent = '';
    }
  });
  
  scriptureTextInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      lookupTextBtn.click();
    }
  });
  
  lookupTextBtn.addEventListener('click', async () => {
    const reference = scriptureTextInput.value.trim();
    if (!reference) return;
    
    const bibleId = document.getElementById('bibleVersionSelect').value;
    const compareMode = compareModeCheckbox.checked;
    const bibleId2 = compareMode ? document.getElementById('bibleVersion2Select').value : null;
    
    parsePreview.textContent = 'Looking up...';
    parsePreview.style.color = '#888';
    lookupTextBtn.disabled = true;
    
    const result = await ipcRenderer.invoke(IPC.FETCH_SCRIPTURE, { reference, bibleId, bibleId2 });
    
    lookupTextBtn.disabled = false;
    
    if (result.error) {
      parsePreview.textContent = result.error;
      parsePreview.style.color = '#e94560';
      return;
    }
    
    parsePreview.textContent = `✓ ${result.reference} (${result.version})`;
    parsePreview.style.color = '#4ade80';
    
    staged = createScripture(
      result.reference,
      result.text,
      result.version,
      result.bibleId,
      result.bookId,
      result.chapter,
      result.verse,
      result.compareText,
      result.compareVersion,
      result.bibleId2
    );
    isSynced = false;
    
    fetchAndCacheChapter(result.bibleId, result.bookId, result.chapter).then(() => {
      prefetchNearbyChapter(result.bibleId, result.bookId, result.chapter, result.verse, result.bibleId2);
    });
    if (result.bibleId2) {
      fetchAndCacheChapter(result.bibleId2, result.bookId, result.chapter).catch(() => {});
    }
    
    addToRecentScriptures(result);
    updatePreviewDisplay();
    updateGoLiveButton();
    updateTransportUI();
  });
  
  const pinCurrentBtn = document.getElementById('pinCurrentBtn');
  pinCurrentBtn.addEventListener('click', async () => {
    if (staged?.type !== 'scripture') return;
    
    const pinned = settings.pinnedScriptures || [];
    const exists = pinned.some(p => 
      p.reference === staged.reference && p.bibleId === staged.bibleId
    );
    
    if (exists) return;
    
    const newPin = {
      reference: staged.reference,
      bookId: staged.bookId,
      chapter: staged.chapter,
      verse: staged.verse,
      bibleId: staged.bibleId,
      version: staged.version,
      text: staged.text,
      compareText: staged.compareText,
      compareVersion: staged.compareVersion,
      bibleId2: staged.bibleId2
    };
    
    pinned.unshift(newPin);
    if (pinned.length > 10) pinned.pop();
    
    settings.pinnedScriptures = pinned;
    await ipcRenderer.invoke(IPC.SAVE_SETTINGS, { pinnedScriptures: pinned });
    renderScriptureLists();
  });
  
  const bookSelect = document.getElementById('bookSelect');
  const chapterSelect = document.getElementById('chapterSelect');
  const verseSelect = document.getElementById('verseSelect');
  const lookupManualBtn = document.getElementById('lookupManualBtn');
  
  async function loadBooks() {
    const bibleId = document.getElementById('bibleVersionSelect').value;
    const books = await ipcRenderer.invoke(IPC.GET_BIBLE_BOOKS, bibleId);
    if (books.error) {
      bookSelect.innerHTML = '<option value="">Error loading</option>';
      return;
    }
    bookSelect.innerHTML = '<option value="">Book...</option>' + 
      books.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
  }
  
  loadBooks();
  
  document.getElementById('bibleVersionSelect').addEventListener('change', () => {
    loadBooks();
    chapterSelect.innerHTML = '<option value="">Ch...</option>';
    chapterSelect.disabled = true;
    verseSelect.innerHTML = '<option value="">Vs...</option>';
    verseSelect.disabled = true;
    lookupManualBtn.disabled = true;
  });
  
  bookSelect.addEventListener('change', async () => {
    const bookId = bookSelect.value;
    if (!bookId) {
      chapterSelect.innerHTML = '<option value="">Ch...</option>';
      chapterSelect.disabled = true;
      verseSelect.innerHTML = '<option value="">Vs...</option>';
      verseSelect.disabled = true;
      lookupManualBtn.disabled = true;
      return;
    }
    
    const bibleId = document.getElementById('bibleVersionSelect').value;
    const chapters = await ipcRenderer.invoke(IPC.GET_CHAPTERS, bibleId, bookId);
    if (chapters.error) {
      chapterSelect.innerHTML = '<option value="">Error</option>';
      return;
    }
    chapterSelect.innerHTML = '<option value="">Ch...</option>' + 
      chapters.map(c => `<option value="${c.id}">${c.number}</option>`).join('');
    chapterSelect.disabled = false;
    verseSelect.innerHTML = '<option value="">Vs...</option>';
    verseSelect.disabled = true;
    lookupManualBtn.disabled = true;
  });
  
  chapterSelect.addEventListener('change', async () => {
    const chapterId = chapterSelect.value;
    if (!chapterId) {
      verseSelect.innerHTML = '<option value="">Vs...</option>';
      verseSelect.disabled = true;
      lookupManualBtn.disabled = true;
      return;
    }
    
    const bibleId = document.getElementById('bibleVersionSelect').value;
    const verses = await ipcRenderer.invoke(IPC.GET_VERSES, bibleId, chapterId);
    if (verses.error) {
      verseSelect.innerHTML = '<option value="">Error</option>';
      return;
    }
    verseSelect.innerHTML = '<option value="">Vs...</option>' + 
      verses.map(v => `<option value="${v.id}">${v.number}</option>`).join('');
    verseSelect.disabled = false;
    lookupManualBtn.disabled = true;
  });
  
  verseSelect.addEventListener('change', () => {
    lookupManualBtn.disabled = !verseSelect.value;
  });
  
  lookupManualBtn.addEventListener('click', async () => {
    const verseId = verseSelect.value;
    if (!verseId) return;
    
    const bibleId = document.getElementById('bibleVersionSelect').value;
    const compareMode = compareModeCheckbox.checked;
    const bibleId2 = compareMode ? document.getElementById('bibleVersion2Select').value : null;
    
    lookupManualBtn.disabled = true;
    parsePreview.textContent = 'Looking up...';
    parsePreview.style.color = '#888';
    
    const result = await ipcRenderer.invoke(IPC.FETCH_SCRIPTURE, { 
      reference: verseId,
      bibleId, 
      bibleId2 
    });
    
    lookupManualBtn.disabled = false;
    
    if (result.error) {
      parsePreview.textContent = result.error;
      parsePreview.style.color = '#e94560';
      return;
    }
    
    parsePreview.textContent = `✓ ${result.reference} (${result.version})`;
    parsePreview.style.color = '#4ade80';
    
    staged = createScripture(
      result.reference, result.text, result.version, result.bibleId,
      result.bookId, result.chapter, result.verse,
      result.compareText, result.compareVersion, result.bibleId2
    );
    isSynced = false;
    
    fetchAndCacheChapter(result.bibleId, result.bookId, result.chapter).then(() => {
      prefetchNearbyChapter(result.bibleId, result.bookId, result.chapter, result.verse, result.bibleId2);
    });
    if (result.bibleId2) {
      fetchAndCacheChapter(result.bibleId2, result.bookId, result.chapter).catch(() => {});
    }
    
    addToRecentScriptures(result);
    updatePreviewDisplay();
    updateGoLiveButton();
    updateTransportUI();
  });
  
  const clearRecentsBtn = document.getElementById('clearRecentsBtn');
  clearRecentsBtn.addEventListener('click', async () => {
    settings.recentScriptures = [];
    await ipcRenderer.invoke(IPC.SAVE_SETTINGS, { recentScriptures: [] });
    renderScriptureLists();
  });
  
  renderScriptureLists();
}

function addToRecentScriptures(result) {
  const recent = settings.recentScriptures || [];
  const filtered = recent.filter(r => 
    !(r.reference === result.reference && r.bibleId === result.bibleId)
  );
  
  filtered.unshift({
    reference: result.reference,
    bookId: result.bookId,
    chapter: result.chapter,
    verse: result.verse,
    bibleId: result.bibleId,
    version: result.version,
    text: result.text
  });
  
  if (filtered.length > 3) filtered.pop();
  
  settings.recentScriptures = filtered;
  ipcRenderer.invoke(IPC.SAVE_SETTINGS, { recentScriptures: filtered });
  renderScriptureLists();
}

function renderScriptureLists() {
  const pinnedList = document.getElementById('pinnedScripturesList');
  const recentList = document.getElementById('recentScripturesList');
  const pinBtn = document.getElementById('pinCurrentBtn');
  
  pinBtn.disabled = !(staged?.type === 'scripture');
  
  const pinned = settings.pinnedScriptures || [];
  if (pinned.length === 0) {
    pinnedList.innerHTML = '<div class="empty-list">No pinned scriptures</div>';
  } else {
    pinnedList.innerHTML = pinned.map((p, i) => `
      <div class="scripture-item" data-type="pinned" data-index="${i}">
        <span class="scripture-ref">${p.reference}</span>
        <span class="scripture-version">${p.version}</span>
        <button class="remove-pin" data-index="${i}">×</button>
      </div>
    `).join('');
  }
  
  const recent = settings.recentScriptures || [];
  if (recent.length === 0) {
    recentList.innerHTML = '<div class="empty-list">No recent lookups</div>';
  } else {
    recentList.innerHTML = recent.map((r, i) => `
      <div class="scripture-item" data-type="recent" data-index="${i}">
        <span class="scripture-ref">${r.reference}</span>
        <span class="scripture-version">${r.version}</span>
      </div>
    `).join('');
  }
  
  pinnedList.querySelectorAll('.scripture-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('remove-pin')) return;
      const idx = parseInt(item.dataset.index, 10);
      loadPinnedScripture(idx);
    });
  });
  
  pinnedList.querySelectorAll('.remove-pin').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index, 10);
      settings.pinnedScriptures.splice(idx, 1);
      await ipcRenderer.invoke(IPC.SAVE_SETTINGS, { pinnedScriptures: settings.pinnedScriptures });
      renderScriptureLists();
    });
  });
  
  recentList.querySelectorAll('.scripture-item').forEach(item => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.dataset.index, 10);
      loadRecentScripture(idx);
    });
  });
}

function loadPinnedScripture(index) {
  const pinned = settings.pinnedScriptures || [];
  const p = pinned[index];
  if (!p) return;
  
  staged = createScripture(
    p.reference, p.text, p.version, p.bibleId,
    p.bookId, p.chapter, p.verse,
    p.compareText, p.compareVersion, p.bibleId2
  );
  isSynced = false;
  
  fetchAndCacheChapter(p.bibleId, p.bookId, p.chapter).then(() => {
    prefetchNearbyChapter(p.bibleId, p.bookId, p.chapter, p.verse, p.bibleId2);
  });
  if (p.bibleId2) {
    fetchAndCacheChapter(p.bibleId2, p.bookId, p.chapter).catch(() => {});
  }
  
  updatePreviewDisplay();
  updateGoLiveButton();
  updateTransportUI();
}

function loadRecentScripture(index) {
  const recent = settings.recentScriptures || [];
  const r = recent[index];
  if (!r) return;
  
  staged = createScripture(
    r.reference, r.text, r.version, r.bibleId,
    r.bookId, r.chapter, r.verse
  );
  isSynced = false;
  
  fetchAndCacheChapter(r.bibleId, r.bookId, r.chapter).then(() => {
    prefetchNearbyChapter(r.bibleId, r.bookId, r.chapter, r.verse, null);
  });
  
  updatePreviewDisplay();
  updateGoLiveButton();
  updateTransportUI();
}

async function navigateVerse(direction) {
  if (!staged || staged.type !== 'scripture') return;
  
  const parsePreview = document.getElementById('parsePreview');
  const bibleId = staged.bibleId;
  const bibleId2 = staged.bibleId2;
  
  let targetBook = staged.bookId;
  let targetChapter = staged.chapter;
  let targetVerse = staged.verse + direction;
  
  parsePreview.textContent = 'Navigating...';
  parsePreview.style.color = '#888';
  
  if (targetVerse < 1) {
    const prevChapterKey = getCacheKey(bibleId, targetBook, targetChapter - 1);
    const prevChapterCached = chapterCache.get(prevChapterKey);
    
    if (prevChapterCached && targetChapter > 1) {
      targetChapter = targetChapter - 1;
      targetVerse = prevChapterCached.verseCount || Object.keys(prevChapterCached.verses).length;
    } else {
      const info = await ipcRenderer.invoke(IPC.GET_CHAPTER_INFO, bibleId, targetBook, targetChapter);
      if (info.error) {
        parsePreview.textContent = info.error;
        parsePreview.style.color = '#e94560';
        return;
      }
      
      const bookOrder = info.bookOrder;
      const bookIndex = bookOrder.indexOf(targetBook);
      
      if (targetChapter > 1) {
        targetChapter = targetChapter - 1;
        const prevChapterInfo = await ipcRenderer.invoke(IPC.GET_CHAPTER_INFO, bibleId, targetBook, targetChapter);
        if (prevChapterInfo.error || !prevChapterInfo.lastVerse) {
          parsePreview.textContent = 'Could not navigate';
          parsePreview.style.color = '#e94560';
          return;
        }
        targetVerse = prevChapterInfo.lastVerse;
      } else if (bookIndex > 0) {
        targetBook = bookOrder[bookIndex - 1];
        const prevBookInfo = await ipcRenderer.invoke(IPC.GET_CHAPTER_INFO, bibleId, targetBook, 1);
        if (prevBookInfo.error) {
          parsePreview.textContent = 'Could not navigate';
          parsePreview.style.color = '#e94560';
          return;
        }
        targetChapter = prevBookInfo.chapterCount;
        const lastChapterInfo = await ipcRenderer.invoke(IPC.GET_CHAPTER_INFO, bibleId, targetBook, targetChapter);
        if (lastChapterInfo.error || !lastChapterInfo.lastVerse) {
          parsePreview.textContent = 'Could not navigate';
          parsePreview.style.color = '#e94560';
          return;
        }
        targetVerse = lastChapterInfo.lastVerse;
      } else {
        parsePreview.textContent = 'Beginning of Bible';
        parsePreview.style.color = '#888';
        return;
      }
    }
  }
  
  let result = await getVerseWithCache(bibleId, targetBook, targetChapter, targetVerse, bibleId2);
  
  if (!result) {
    await fetchAndCacheChapter(bibleId, targetBook, targetChapter);
    if (bibleId2) {
      await fetchAndCacheChapter(bibleId2, targetBook, targetChapter);
    }
    result = await getVerseWithCache(bibleId, targetBook, targetChapter, targetVerse, bibleId2);
  }
  
  if (!result && direction > 0) {
    const cacheKey = getCacheKey(bibleId, targetBook, targetChapter);
    const cachedChapter = chapterCache.get(cacheKey);
    if (cachedChapter) {
      const verseCount = cachedChapter.verseCount || Object.keys(cachedChapter.verses).length;
      if (targetVerse > verseCount) {
        result = { error: 'Verse not found' };
      }
    }
  }
  
  if (!result) {
    result = await ipcRenderer.invoke(IPC.FETCH_SCRIPTURE, { 
      reference: `${targetBook}.${targetChapter}.${targetVerse}`,
      bibleId, 
      bibleId2 
    });
  }
  
  if (result.error && result.error.includes('not found') && direction > 0) {
    const nextChapterKey = getCacheKey(bibleId, targetBook, targetChapter + 1);
    const nextChapterCached = chapterCache.get(nextChapterKey);
    
    if (nextChapterCached && nextChapterCached.verses[1]) {
      targetChapter = targetChapter + 1;
      targetVerse = 1;
      result = await getVerseWithCache(bibleId, targetBook, targetChapter, targetVerse, bibleId2);
    } else {
      const info = await ipcRenderer.invoke(IPC.GET_CHAPTER_INFO, bibleId, targetBook, targetChapter);
      if (!info.error) {
        const bookOrder = info.bookOrder;
        const bookIndex = bookOrder.indexOf(targetBook);
        
        if (targetChapter < info.chapterCount) {
          targetChapter = targetChapter + 1;
          targetVerse = 1;
        } else if (bookIndex < bookOrder.length - 1) {
          targetBook = bookOrder[bookIndex + 1];
          targetChapter = 1;
          targetVerse = 1;
        } else {
          parsePreview.textContent = 'End of Bible';
          parsePreview.style.color = '#888';
          return;
        }
        
        result = await getVerseWithCache(bibleId, targetBook, targetChapter, targetVerse, bibleId2);
        
        if (!result) {
          await fetchAndCacheChapter(bibleId, targetBook, targetChapter);
          if (bibleId2) {
            await fetchAndCacheChapter(bibleId2, targetBook, targetChapter);
          }
          result = await getVerseWithCache(bibleId, targetBook, targetChapter, targetVerse, bibleId2);
        }
        
        if (!result) {
          result = await ipcRenderer.invoke(IPC.FETCH_SCRIPTURE, { 
            reference: `${targetBook}.${targetChapter}.${targetVerse}`,
            bibleId, 
            bibleId2 
          });
        }
      }
    }
  }
  
  if (result.error) {
    parsePreview.textContent = result.error;
    parsePreview.style.color = '#e94560';
    return;
  }
  
  parsePreview.textContent = `✓ ${result.reference} (${result.version})`;
  parsePreview.style.color = '#4ade80';
  
  staged = createScripture(
    result.reference, result.text, result.version, result.bibleId,
    result.bookId, result.chapter, result.verse,
    result.compareText, result.compareVersion, result.bibleId2
  );
  isSynced = false;
  
  prefetchNearbyChapter(bibleId, result.bookId, result.chapter, result.verse, bibleId2);
  
  updatePreviewDisplay();
  updateGoLiveButton();
  updateTransportUI();
}

function setupPreviewVideoEvents() {
  if (!previewVideo) return;
  
  previewVideo.onloadedmetadata = () => {
    if (staged?.type === 'single-video') {
      staged.duration = previewVideo.duration;
    }
    updatePreviewVideoUI();
  };
  
  previewVideo.ontimeupdate = () => {
    if (staged?.type === 'single-video') {
      staged.currentTime = previewVideo.currentTime;
    }
    updatePreviewVideoUI();
  };
  
  previewVideo.onplay = () => {
    document.getElementById('previewVideoPlayBtn').textContent = '⏸️';
  };
  
  previewVideo.onpause = () => {
    document.getElementById('previewVideoPlayBtn').textContent = '▶️';
  };
}

function setupPreviewAudioEvents() {
  if (!previewAudio) return;
  
  previewAudio.onloadedmetadata = () => {
    if (staged?.type === 'single-audio') {
      staged.duration = previewAudio.duration;
    }
    updatePreviewAudioUI();
  };
  
  previewAudio.ontimeupdate = () => {
    if (staged?.type === 'single-audio') {
      staged.currentTime = previewAudio.currentTime;
    }
    updatePreviewAudioUI();
  };
  
  previewAudio.onplay = () => {
    document.getElementById('previewAudioPlayBtn').textContent = '⏸️';
  };
  
  previewAudio.onpause = () => {
    document.getElementById('previewAudioPlayBtn').textContent = '▶️';
  };
}

function cleanupPreviewVideo() {
  if (previewVideo) {
    previewVideo.pause();
    previewVideo.src = '';
    previewVideo = null;
  }
}

function cleanupPreviewAudio() {
  if (previewAudio) {
    previewAudio.pause();
    previewAudio.src = '';
    previewAudio = null;
  }
}

function stopLiveVideo() {
  if (live?.type === 'single-video') {
    ipcRenderer.send(IPC.CONTROL_VIDEO, 'stop');
  }
  liveVideoState = null;
}

function stopLiveAudio() {
  if (live?.type === 'single-audio') {
    ipcRenderer.send(IPC.CONTROL_AUDIO, 'stop');
  }
  liveAudioState = null;
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function updatePreviewVideoUI() {
  if (!previewVideo) return;
  const timeEl = document.getElementById('previewVideoTime');
  const durationEl = document.getElementById('previewVideoDuration');
  const slider = document.getElementById('previewVideoSlider');
  
  timeEl.textContent = formatTime(previewVideo.currentTime);
  durationEl.textContent = formatTime(previewVideo.duration);
  
  if (previewVideo.duration) {
    const progress = (previewVideo.currentTime / previewVideo.duration) * 100;
    slider.value = progress;
    slider.style.setProperty('--progress', progress + '%');
  }
}

function updateLiveVideoUI() {
  if (!liveVideoState) return;
  const timeEl = document.getElementById('liveVideoTime');
  const durationEl = document.getElementById('liveVideoDuration');
  const slider = document.getElementById('liveVideoSlider');
  const playBtn = document.getElementById('liveVideoPlayBtn');
  
  timeEl.textContent = formatTime(liveVideoState.currentTime);
  durationEl.textContent = formatTime(liveVideoState.duration);
  
  if (liveVideoState.duration) {
    const progress = (liveVideoState.currentTime / liveVideoState.duration) * 100;
    slider.value = progress;
    slider.style.setProperty('--progress', progress + '%');
  }
  
  playBtn.textContent = liveVideoState.paused ? '▶️' : '⏸️';
}

function updatePreviewAudioUI() {
  if (!previewAudio) return;
  const timeEl = document.getElementById('previewAudioTime');
  const durationEl = document.getElementById('previewAudioDuration');
  const slider = document.getElementById('previewAudioSlider');
  
  timeEl.textContent = formatTime(previewAudio.currentTime);
  durationEl.textContent = formatTime(previewAudio.duration);
  
  if (previewAudio.duration) {
    const progress = (previewAudio.currentTime / previewAudio.duration) * 100;
    slider.value = progress;
    slider.style.setProperty('--progress', progress + '%');
  }
}

function updateLiveAudioUI() {
  if (!liveAudioState) return;
  const timeEl = document.getElementById('liveAudioTime');
  const durationEl = document.getElementById('liveAudioDuration');
  const slider = document.getElementById('liveAudioSlider');
  const playBtn = document.getElementById('liveAudioPlayBtn');
  
  timeEl.textContent = formatTime(liveAudioState.currentTime);
  durationEl.textContent = formatTime(liveAudioState.duration);
  
  if (liveAudioState.duration) {
    const progress = (liveAudioState.currentTime / liveAudioState.duration) * 100;
    slider.value = progress;
    slider.style.setProperty('--progress', progress + '%');
  }
  
  playBtn.textContent = liveAudioState.paused ? '▶️' : '⏸️';
}

function updateVideoTransportUI() {
  const previewTransport = document.getElementById('previewVideoTransport');
  const liveTransport = document.getElementById('liveVideoTransport');
  
  const isStagedSlideshowVideo = staged?.type === 'slideshow' && staged.queue[staged.index]?.type === 'video';
  const showPreviewVideo = !!getStagedVideoPath();
  const isLiveSlideshowVideo = live?.type === 'slideshow' && live.waitingForVideo;
  const showLiveVideo = !!getLiveVideoPath() || isLiveSlideshowVideo;
  
  previewTransport.classList.toggle('visible', showPreviewVideo);
  previewTransport.classList.toggle('slideshow-video', isStagedSlideshowVideo);
  liveTransport.classList.toggle('visible', showLiveVideo);
  liveTransport.classList.toggle('slideshow-video', isLiveSlideshowVideo);
}

function updateAudioTransportUI() {
  const previewTransport = document.getElementById('previewAudioTransport');
  const liveTransport = document.getElementById('liveAudioTransport');
  
  const showPreviewAudio = staged?.type === 'single-audio';
  const showLiveAudio = live?.type === 'single-audio';
  
  previewTransport.classList.toggle('visible', showPreviewAudio);
  liveTransport.classList.toggle('visible', showLiveAudio);
}

function getStagedSlideshowQueue() {
  if (staged?.type === 'slideshow') {
    return staged.queue;
  }
  if (currentPreset) {
    return currentPreset.images.map(img => ({
      path: img.path,
      displayName: img.displayName || path.basename(img.path)
    }));
  }
  return [];
}

function pushSlideshowLive() {
  stopLiveSlideshowTimer();
  
  if (staged?.type === 'slideshow') {
    applyPendingQueueChanges();
  }
  
  live = createLiveSlideshow(staged);
  isSynced = true;
  
  ipcRenderer.send(IPC.SET_TRANSITION, live.transition);
  showCurrentLiveSlide();
  startLiveTimer();
  
  updateTransportUI();
  updateGoLiveButton();
  updateQueueButton();
  updateLiveDisplay();
  renderSlideshowQueue();
}

function applyPendingQueueChanges() {
  if (staged?.type !== 'slideshow') return;
  
  staged.pendingAdds.forEach(img => {
    const matchFn = img.type === 'quick-slide' 
      ? (q) => q.type === 'quick-slide' && q.id === img.id
      : (q) => q.path === img.path;
    if (!staged.queue.some(matchFn)) {
      staged.queue.push(img);
    }
  });
  
  staged.pendingRemoves.forEach(itemId => {
    const idx = staged.queue.findIndex(q => {
      return q.type === 'quick-slide' ? q.id === itemId : q.path === itemId;
    });
    if (idx >= 0) {
      staged.queue.splice(idx, 1);
    }
  });
  
  staged.pendingAdds = [];
  staged.pendingRemoves = [];
  
  if (staged.index >= staged.queue.length) {
    staged.index = Math.max(0, staged.queue.length - 1);
  }
}

function showCurrentLiveSlide(skipAttempts = 0) {
  if (live?.type !== 'slideshow' || live.queue.length === 0) return;
  
  if (skipAttempts >= live.queue.length) {
    handleNaturalSlideshowEnd();
    return;
  }
  
  const wasVideo = live.waitingForVideo;
  const wasVideoPaused = wasVideo && liveVideoState?.paused;
  if (wasVideo) {
    ipcRenderer.send(IPC.CONTROL_VIDEO, 'pause');
    live.waitingForVideo = false;
    if (!wasVideoPaused) {
      live.paused = false;
    }
    liveVideoState = null;
  }
  
  const currentItem = live.queue[live.index];
  const isGoingToVideo = currentItem.type === 'video';
  
  if (currentItem.type !== 'quick-slide' && isPathBroken(currentItem.path)) {
    advanceLiveSlide(skipAttempts + 1);
    return;
  }
  
  if (currentItem.type === 'quick-slide') {
    ipcRenderer.send(IPC.SHOW_QUICK_SLIDE, {
      preset: currentItem.preset,
      title: currentItem.title,
      body: currentItem.body,
      background: currentItem.background,
      backgroundImage: currentItem.backgroundImage,
      fontFamily: currentItem.fontFamily,
      fontSize: currentItem.fontSize,
      fontColor: currentItem.fontColor
    });
    live.waitingForVideo = false;
    if (!live.paused && !live.timer) {
      startLiveTimer();
    }
  } else if (currentItem.type === 'video') {
    if (live.timer) {
      clearInterval(live.timer);
      live.timer = null;
    }
    ipcRenderer.send(IPC.SHOW_VIDEO, currentItem.path, 0, !live.paused);
    live.waitingForVideo = true;
  } else {
    ipcRenderer.send(IPC.SHOW_IMAGE, currentItem.path);
    live.waitingForVideo = false;
    if (!live.paused && !live.timer) {
      startLiveTimer();
    }
  }
  
  if (isSynced && staged?.type === 'slideshow') {
    staged.index = live.index;
    updatePreviewDisplay();
  }
  
  updateLiveDisplay();
  updateTransportUI();
  updateVideoTransportUI();
  renderSlideshowQueue();
}

function startLiveTimer() {
  if (live?.type !== 'slideshow') return;
  if (live.timer) {
    clearInterval(live.timer);
  }
  live.timer = setInterval(() => {
    advanceLiveSlide();
  }, live.interval);
}

function resetLiveTimer() {
  if (live?.type !== 'slideshow' || live.paused) return;
  startLiveTimer();
}

function stopLiveSlideshowTimer() {
  if (live?.type === 'slideshow' && live.timer) {
    clearInterval(live.timer);
    live.timer = null;
  }
}

function advanceLiveSlide(skipAttempts = 0) {
  if (live?.type !== 'slideshow') return;
  if (live.waitingForVideo) return;
  
  live.index++;
  
  if (live.index >= live.queue.length) {
    if (live.loop) {
      live.index = 0;
    } else {
      live.index = live.queue.length - 1;
      handleNaturalSlideshowEnd();
      return;
    }
  }
  
  if (isSynced && staged?.type === 'slideshow') {
    staged.index = live.index;
  }
  
  showCurrentLiveSlide(skipAttempts);
}

function handleNaturalSlideshowEnd() {
  stopLiveSlideshowTimer();
  
  ipcRenderer.send(IPC.SHOW_STANDBY);
  live = createStandby();
  
  if (isSynced) {
    staged = null;
    isSynced = false;
  }
  
  updatePreviewDisplay();
  updateLiveDisplay();
  updateTransportUI();
  updateGoLiveButton();
  updateQueueButton();
  renderSlideshowQueue();
}

function pauseLiveSlideshow() {
  if (live?.type !== 'slideshow') return;
  live.paused = true;
  if (live.timer) {
    clearInterval(live.timer);
    live.timer = null;
  }
  if (live.waitingForVideo) {
    ipcRenderer.send(IPC.CONTROL_VIDEO, 'pause');
    if (isSynced && previewVideo) {
      previewVideo.pause();
    }
  }
  updateTransportUI();
}

function resumeLiveSlideshow() {
  if (live?.type !== 'slideshow') return;
  live.paused = false;
  if (live.waitingForVideo) {
    ipcRenderer.send(IPC.CONTROL_VIDEO, 'play');
    if (isSynced && previewVideo) {
      previewVideo.play();
    }
  } else {
    startLiveTimer();
  }
  updateTransportUI();
}

function stopLiveSlideshow() {
  stopLiveSlideshowTimer();
  
  if (staged?.type === 'slideshow') {
    staged.pendingAdds.forEach(item => {
      const matchFn = item.type === 'quick-slide'
        ? (q) => q.type === 'quick-slide' && q.id === item.id
        : (q) => q.path === item.path;
      if (!staged.queue.some(matchFn)) {
        staged.queue.push(item);
      }
    });
    staged.pendingAdds = [];
    
    staged.pendingRemoves.forEach(itemId => {
      const idx = staged.queue.findIndex(q => {
        if (q.type === 'quick-slide') return q.id === itemId;
        return q.path === itemId;
      });
      if (idx >= 0) {
        staged.queue.splice(idx, 1);
      }
    });
    staged.pendingRemoves = [];
    
    if (staged.index >= staged.queue.length) {
      staged.index = Math.max(0, staged.queue.length - 1);
    }
  }
  
  ipcRenderer.send(IPC.SHOW_STANDBY);
  live = createStandby();
  
  isSynced = false;
  
  updatePreviewDisplay();
  updateLiveDisplay();
  updateTransportUI();
  updateGoLiveButton();
  updateQueueButton();
  renderSlideshowQueue();
}

function generateId() {
  return 'preset_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function generateMediaId() {
  return 'media_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

async function queueMediaCopies(items) {
  for (const item of items) {
    ipcRenderer.invoke(IPC.COPY_MEDIA_FILE, { id: item.id, sourcePath: item.originalPath });
  }
  updateImportStatus();
}

async function migrateLegacyMedia() {
  const needsMigration = mediaLibrary.filter(item => {
    if (!item.id) return true;
    if (!item.internalPath && item.copyStatus !== 'pending') return true;
    return false;
  });
  
  if (needsMigration.length === 0) return;
  
  for (const item of needsMigration) {
    if (!item.id) {
      item.id = generateMediaId();
    }
    if (!item.originalPath && item.path) {
      item.originalPath = item.path;
    }
    item.copyStatus = 'pending';
    
    await ipcRenderer.invoke(IPC.UPDATE_LIBRARY_ITEM, item.id, {
      id: item.id,
      originalPath: item.originalPath,
      copyStatus: item.copyStatus
    });
  }
  
  queueMediaCopies(needsMigration);
}

function setupMediaCopyListeners() {
  ipcRenderer.on(IPC.MEDIA_COPY_PROGRESS, (event, { id, progress }) => {
    const item = mediaLibrary.find(m => m.id === id);
    if (item) {
      item.copyProgress = progress;
    }
    updateImportStatus();
  });

  ipcRenderer.on(IPC.MEDIA_COPY_COMPLETE, async (event, { id, success, internalPath, error }) => {
    const item = mediaLibrary.find(m => m.id === id);
    if (item) {
      if (success) {
        item.internalPath = internalPath;
        item.copyStatus = 'complete';
        if (item.type === 'video') {
          await generateMissingThumbnails([item]);
        }
      } else {
        item.copyStatus = 'error';
        item.copyError = error;
      }
      item.copyProgress = null;
      await ipcRenderer.invoke(IPC.UPDATE_LIBRARY_ITEM, item.id, {
        internalPath: item.internalPath,
        copyStatus: item.copyStatus,
        copyError: item.copyError
      });
      renderImageGrid();
      updateImportStatus();
      updateStorageDisplay();
    }
  });
}

function updateImportStatus() {
  const statusEl = document.getElementById('importStatus');
  const textEl = document.getElementById('importStatusText');
  const pendingCount = mediaLibrary.filter(m => m.copyStatus === 'pending').length;
  
  if (pendingCount > 0) {
    statusEl.classList.add('active');
    textEl.textContent = `Importing ${pendingCount} file${pendingCount > 1 ? 's' : ''}...`;
  } else {
    statusEl.classList.remove('active');
  }
}

async function updateStorageDisplay() {
  const displayEl = document.getElementById('storageDisplay');
  if (!displayEl) return;
  
  const result = await ipcRenderer.invoke(IPC.GET_MEDIA_STORAGE_SIZE);
  if (result.success) {
    const bytes = result.size;
    let sizeText;
    if (bytes < 1024) {
      sizeText = bytes + ' B';
    } else if (bytes < 1024 * 1024) {
      sizeText = (bytes / 1024).toFixed(1) + ' KB';
    } else if (bytes < 1024 * 1024 * 1024) {
      sizeText = (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    } else {
      sizeText = (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }
    displayEl.textContent = sizeText;
  } else {
    displayEl.textContent = 'Unable to calculate';
  }
}

function setupCheckUpdatesButton() {
  const checkBtn = document.getElementById('checkUpdatesBtn');
  const statusEl = document.getElementById('updateCheckStatus');
  
  checkBtn.addEventListener('click', async () => {
    checkBtn.textContent = 'Checking...';
    checkBtn.disabled = true;
    statusEl.textContent = '';
    statusEl.className = 'update-check-status';
    
    try {
      const result = await ipcRenderer.invoke(IPC.CHECK_FOR_UPDATES);
      if (result.updateAvailable) {
        statusEl.textContent = '';
      } else {
        statusEl.textContent = '✓ You\'re up to date';
        statusEl.classList.add('success');
        setTimeout(() => {
          statusEl.textContent = '';
        }, 5000);
      }
    } catch (err) {
      statusEl.textContent = 'Could not check for updates';
      statusEl.classList.add('error');
    }
    
    checkBtn.textContent = 'Check for Updates';
    checkBtn.disabled = false;
  });
}

function updatePresetDropdown() {
  const select = document.getElementById('presetSelect');
  select.innerHTML = '<option value="">-- New Slideshow --</option>';
  slideshowPresets.forEach(preset => {
    const option = document.createElement('option');
    option.value = preset.id;
    
    const hasBroken = preset.images.some(img => isPathBroken(img.path));
    if (hasBroken) {
      option.textContent = '⚠ ' + preset.name;
      option.classList.add('has-broken');
    } else {
      option.textContent = preset.name;
    }
    
    if (currentPreset && currentPreset.id === preset.id) {
      option.selected = true;
    }
    select.appendChild(option);
  });
}

function updatePresetButtons() {
  const hasPreset = !!currentPreset;
  document.getElementById('renamePresetBtn').disabled = !hasPreset;
  document.getElementById('deletePresetBtn').disabled = !hasPreset;
}

function hasQueuedChanges() {
  if (staged?.type === 'slideshow') {
    if (staged.pendingAdds.length > 0) return true;
    if (staged.pendingRemoves.length > 0) return true;
    if (queuedSettings.interval !== staged.interval) return true;
    if (queuedSettings.loop !== staged.loop) return true;
    if (queuedSettings.transition !== staged.transition) return true;
  }
  return false;
}

function updateQueueButton() {
  const queueBtn = document.getElementById('queueSlideshowBtn');
  const queue = getStagedSlideshowQueue();
  queueBtn.disabled = !queue || queue.length === 0;
  
  const hasChanges = hasQueuedChanges();
  queueBtn.classList.toggle('has-changes', hasChanges);
}

function loadActivePreset() {
  if (settings.activePresetId) {
    currentPreset = slideshowPresets.find(p => p.id === settings.activePresetId);
    if (currentPreset) {
      loadPresetToStaged();
      updatePresetDropdown();
    }
  }
  updatePresetButtons();
  updateQueueButton();
}

function loadPresetToStaged() {
  if (!currentPreset) return;
  
  const queue = currentPreset.images.map(img => ({
    path: img.path,
    displayName: img.displayName || path.basename(img.path)
  }));
  
  const s = currentPreset.settings;
  
  queuedSettings.interval = s.interval;
  queuedSettings.loop = s.loop;
  queuedSettings.transition = s.transition;
  
  document.getElementById('intervalInput').value = Math.round(s.interval / 1000);
  document.getElementById('loopCheckbox').checked = s.loop;
  document.getElementById('transitionSelect').value = s.transition;
  
  if (!live || live.type !== 'slideshow') {
    ipcRenderer.send(IPC.SET_TRANSITION, s.transition);
  }
  
  renderSlideshowQueue();
  updateQueueButton();
  updateTransportUI();
}

function resetStagedSlideshow() {
  staged = null;
  
  queuedSettings.interval = 7000;
  queuedSettings.loop = true;
  queuedSettings.transition = 'fade';
  
  document.getElementById('intervalInput').value = 7;
  document.getElementById('loopCheckbox').checked = true;
  document.getElementById('transitionSelect').value = 'fade';
  
  renderSlideshowQueue();
  updateQueueButton();
  updateTransportUI();
  updatePreviewDisplay();
  updateGoLiveButton();
}

function renderSlideshowQueue() {
  const container = document.getElementById('slideshowQueue');
  container.innerHTML = '';
  
  const queue = getStagedSlideshowQueue();
  const pendingAdds = staged?.type === 'slideshow' ? staged.pendingAdds : [];
  const pendingRemoves = staged?.type === 'slideshow' ? staged.pendingRemoves : [];
  
  if (queue.length === 0 && pendingAdds.length === 0) {
    container.innerHTML = '<div class="empty-queue"><p>No media in slideshow</p><p class="hint">Pick media from your library</p></div>';
    return;
  }
  
  const isLiveSlideshow = live?.type === 'slideshow';
  const isStagedSlideshow = staged?.type === 'slideshow';
  
  queue.forEach((img, index) => {
    const isPendingRemove = pendingRemoves.includes(img.path);
    const item = createQueueItem(img, index, isStagedSlideshow, isLiveSlideshow, false, isPendingRemove);
    container.appendChild(item);
  });
  
  pendingAdds.forEach((img, i) => {
    const index = queue.length + i;
    const item = createQueueItem(img, index, isStagedSlideshow, isLiveSlideshow, true, false);
    container.appendChild(item);
  });
}

function createQueueItem(img, index, isStagedSlideshow, isLiveSlideshow, isPendingAdd, isPendingRemove) {
  const item = document.createElement('div');
  item.className = 'queue-item';
  
  const isQuickSlide = img.type === 'quick-slide';
  const isVideo = img.type === 'video';
  const itemId = isQuickSlide ? img.id : img.path;
  const isBroken = !isQuickSlide && !isVideo && isPathBroken(img.path);
  if (isBroken) {
    item.classList.add('broken');
  }
  
  const stagedIndex = staged?.type === 'slideshow' ? staged.index : -1;
  const liveIndex = live?.type === 'slideshow' ? live.index : -1;
  
  const isStagedIndex = isStagedSlideshow && index === stagedIndex;
  const liveItem = isLiveSlideshow && live.queue[liveIndex];
  const liveItemId = liveItem ? (liveItem.type === 'quick-slide' ? liveItem.id : liveItem.path) : null;
  const isLiveIndex = liveItemId === itemId;
  
  if (isPendingAdd) {
    item.classList.add('pending-add');
  } else if (isPendingRemove) {
    item.classList.add('pending-remove');
  }
  
  if (isStagedIndex && !isPendingAdd && !isPendingRemove) {
    item.classList.add('staged');
  }
  if (isLiveIndex) {
    item.classList.add('live');
  }
  
  item.draggable = !isLiveSlideshow && !isPendingAdd && !isPendingRemove && !isBroken;
  item.dataset.index = index;
  item.dataset.path = itemId;
  item.dataset.type = img.type;
  
  let thumb;
  
  if (isQuickSlide) {
    thumb = document.createElement('div');
    thumb.className = 'queue-thumb quick-slide-queue-thumb';
    if (img.backgroundImage) {
      thumb.style.backgroundImage = `url('file:///${img.backgroundImage.replace(/\\/g, '/')}')`;
      thumb.style.backgroundSize = 'cover';
    } else {
      thumb.style.backgroundColor = img.background || '#000';
    }
    const bodyPreview = document.createElement('div');
    bodyPreview.style.cssText = `font-size:8px;color:${img.fontColor || '#fff'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px;`;
    bodyPreview.textContent = img.body?.substring(0, 15) || '';
    thumb.appendChild(bodyPreview);
    const badge = document.createElement('div');
    badge.className = 'quick-slide-badge';
    badge.textContent = img.preset.charAt(0).toUpperCase();
    badge.style.cssText = 'position:absolute;top:2px;right:2px;width:14px;height:14px;background:rgba(0,0,0,0.6);color:#fff;border-radius:50%;font-size:8px;display:flex;align-items:center;justify-content:center;';
    item.appendChild(badge);
  } else {
    thumb = document.createElement('img');
    thumb.className = 'queue-thumb';
  
    if (isBroken) {
      thumb.style.background = '#333';
      const brokenBadge = document.createElement('span');
      brokenBadge.className = 'broken-badge';
      brokenBadge.innerHTML = '!';
      brokenBadge.title = 'File not found';
      item.appendChild(brokenBadge);
    } else if (img.type === 'video') {
      const mediaId = getMediaThumbnailId(img);
      ipcRenderer.invoke(IPC.GET_THUMBNAIL, mediaId).then(thumbnailPath => {
        if (thumbnailPath) {
          thumb.src = 'file://' + thumbnailPath;
        } else {
          thumb.style.background = '#1a2744';
        }
      });
      thumb.style.background = '#1a2744';
      const videoBadge = document.createElement('div');
      videoBadge.className = 'video-badge';
      videoBadge.innerHTML = '▶';
      item.appendChild(videoBadge);
    } else {
      thumb.src = 'file://' + img.path;
    }
  }
  
  const indexBadge = document.createElement('span');
  indexBadge.className = 'queue-index';
  indexBadge.textContent = index + 1;
  
  if (isPendingAdd) {
    const addBadge = document.createElement('span');
    addBadge.className = 'pending-badge pending-add-badge';
    addBadge.innerHTML = '✓';
    item.appendChild(addBadge);
  } else if (isPendingRemove) {
    const removeBadge = document.createElement('span');
    removeBadge.className = 'pending-badge pending-remove-badge';
    removeBadge.innerHTML = '×';
    item.appendChild(removeBadge);
  }
  
  const removeBtn = document.createElement('button');
  removeBtn.className = 'queue-remove';
  removeBtn.innerHTML = '×';
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleQueueItemRemove(itemId, isPendingAdd, isQuickSlide);
  });
  
  item.appendChild(thumb);
  item.appendChild(indexBadge);
  item.appendChild(removeBtn);
  
  if (!isPendingAdd && !isPendingRemove) {
    item.addEventListener('click', () => {
      if (staged?.type !== 'slideshow') {
        const queue = getStagedSlideshowQueue();
        staged = createSlideshow(
          currentPreset?.id || null,
          queue,
          index,
          queuedSettings.interval,
          queuedSettings.loop,
          queuedSettings.transition
        );
      } else {
        staged.index = index;
      }
      isSynced = false;
      updatePreviewDisplay();
      renderSlideshowQueue();
      updateTransportUI();
      updateGoLiveButton();
    });
    
    if (!isLiveSlideshow) {
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', index);
        item.classList.add('dragging');
      });
      
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
      });
      
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
      });
      
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
        const toIndex = index;
        if (fromIndex !== toIndex && staged?.type === 'slideshow') {
          const [moved] = staged.queue.splice(fromIndex, 1);
          staged.queue.splice(toIndex, 0, moved);
          updateQueueButton();
          renderSlideshowQueue();
        }
      });
    }
  }
  
  return item;
}

function handleQueueItemRemove(itemId, isPendingAdd, isQuickSlide) {
  const matchFn = (q) => isQuickSlide ? q.id === itemId : q.path === itemId;
  
  if (isPendingAdd) {
    if (staged?.type === 'slideshow') {
      const idx = staged.pendingAdds.findIndex(matchFn);
      if (idx >= 0) {
        staged.pendingAdds.splice(idx, 1);
        updateQueueButton();
      }
    }
  } else if (live?.type === 'slideshow') {
    if (staged?.type === 'slideshow' && !staged.pendingRemoves.some(r => r === itemId)) {
      staged.pendingRemoves.push(itemId);
      updateQueueButton();
    }
  } else {
    if (staged?.type === 'slideshow') {
      const idx = staged.queue.findIndex(matchFn);
      if (idx >= 0) {
        staged.queue.splice(idx, 1);
        if (staged.index >= staged.queue.length) {
          staged.index = Math.max(0, staged.queue.length - 1);
        }
      }
      if (staged.queue.length === 0) {
        staged = null;
      }
    }
  }
  
  renderSlideshowQueue();
  updateQueueButton();
  updateGoLiveButton();
  updateTransportUI();
  updatePreviewDisplay();
}

function updateTransportUI() {
  const stagedTransport = document.querySelector('.staged-transport');
  const stagedBanner = document.getElementById('stagedSlideshowBanner');
  const stagedControls = document.getElementById('stagedTransportControls');
  const stagedProgressText = document.getElementById('stagedProgressText');
  const stagedPauseBtn = document.getElementById('stagedPauseBtn');
  
  const liveTransport = document.querySelector('.live-transport');
  const liveBanner = document.getElementById('liveSlideshowBanner');
  const liveControls = document.getElementById('liveTransportControls');
  const liveProgressText = document.getElementById('liveProgressText');
  const livePauseBtn = document.getElementById('livePauseBtn');
  
  const isStagedSlideshow = staged?.type === 'slideshow';
  const isLiveSlideshow = live?.type === 'slideshow';
  
  if (isStagedSlideshow && staged.queue.length > 0) {
    const effectiveLength = staged.queue.length + staged.pendingAdds.length - staged.pendingRemoves.length;
    stagedTransport.classList.add('visible');
    stagedBanner.classList.add('visible');
    stagedControls.classList.add('visible');
    stagedProgressText.textContent = `${staged.index + 1} / ${effectiveLength}`;
    if (isSynced && isLiveSlideshow) {
      const isVideoPaused = live.waitingForVideo && liveVideoState?.paused;
      const isPaused = live.paused || isVideoPaused;
      stagedPauseBtn.textContent = isPaused ? '▶️' : '⏸️';
      stagedPauseBtn.title = isPaused ? 'Resume' : 'Pause';
    } else if (previewVideo) {
      stagedPauseBtn.textContent = previewVideo.paused ? '▶️' : '⏸️';
      stagedPauseBtn.title = previewVideo.paused ? 'Play' : 'Pause';
    } else {
      stagedPauseBtn.textContent = '⏸️';
      stagedPauseBtn.title = 'Pause';
    }
  } else {
    stagedTransport.classList.remove('visible');
    stagedBanner.classList.remove('visible');
    stagedControls.classList.remove('visible');
  }
  
  if (isLiveSlideshow) {
    liveTransport.classList.add('visible');
    liveBanner.classList.add('visible');
    liveControls.classList.add('visible');
    liveProgressText.textContent = `${live.index + 1} / ${live.queue.length}`;
    const isVideoPaused = live.waitingForVideo && liveVideoState?.paused;
    const isPaused = live.paused || isVideoPaused;
    livePauseBtn.textContent = isPaused ? '▶️' : '⏸️';
    livePauseBtn.title = isPaused ? 'Resume' : 'Pause';
  } else {
    liveTransport.classList.remove('visible');
    liveBanner.classList.remove('visible');
    liveControls.classList.remove('visible');
  }
  
  updateScriptureTransportUI();
}

function updateScriptureTransportUI() {
  const previewTransport = document.getElementById('previewScriptureTransport');
  const liveTransport = document.getElementById('liveScriptureTransport');
  
  const showPreview = staged?.type === 'scripture';
  const showLive = live?.type === 'scripture';
  
  previewTransport.classList.toggle('visible', showPreview);
  liveTransport.classList.toggle('visible', showLive);
}

function setupScriptureTransportControls() {
  const previewPrevBtn = document.getElementById('previewScripturePrevBtn');
  const previewNextBtn = document.getElementById('previewScriptureNextBtn');
  const livePrevBtn = document.getElementById('liveScripturePrevBtn');
  const liveNextBtn = document.getElementById('liveScriptureNextBtn');
  
  previewPrevBtn.addEventListener('click', () => navigateVerse(-1));
  previewNextBtn.addEventListener('click', () => navigateVerse(1));
  
  livePrevBtn.addEventListener('click', () => navigateLiveVerse(-1));
  liveNextBtn.addEventListener('click', () => navigateLiveVerse(1));
}

function setupKeyboardNavigation() {
  const previewArrowKeysCheckbox = document.getElementById('previewScriptureArrowKeys');
  const liveArrowKeysCheckbox = document.getElementById('liveScriptureArrowKeys');
  
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    
    const direction = e.key === 'ArrowLeft' ? -1 : 1;
    
    if (previewArrowKeysCheckbox.checked && staged && staged.type === 'scripture') {
      navigateVerse(direction);
    }
    
    if (liveArrowKeysCheckbox.checked && live && live.type === 'scripture') {
      navigateLiveVerse(direction);
    }
  });
}

let currentQsPreset = 'announcement';
let currentQsBgType = 'color';
let editingQuickSlideId = null;
let customSlideElements = [];
let defaultQuickSlideBackgrounds = [];
let customQsBgImagePath = null;
let countdownLabelPos = { vAlign: 'center', hAlign: 'center', width: 'wide', offsetX: 0, offsetY: -30 };
let countdownTimerPos = { vAlign: 'center', hAlign: 'center', width: 'wide', offsetX: 0, offsetY: 30 };

function setupQuickSlidesControls() {
  const presetBtns = document.querySelectorAll('.qs-preset-btn');
  const titleRow = document.getElementById('qsTitleRow');
  const bodyRow = document.getElementById('qsBodyRow');
  const elementsRow = document.getElementById('qsElementsRow');
  const countdownLabelRow = document.getElementById('qsCountdownLabelRow');
  const countdownDurationRow = document.getElementById('qsCountdownDurationRow');
  const titleInput = document.getElementById('qsTitle');
  const bodyInput = document.getElementById('qsBody');
  const addTitleBtn = document.getElementById('qsAddTitleBtn');
  const addBodyBtn = document.getElementById('qsAddBodyBtn');
  const addCountdownBtn = document.getElementById('qsAddCountdownBtn');
  const elementsList = document.getElementById('qsElementsList');
  const elementsHint = document.getElementById('qsElementsHint');
  const fontFamily = document.getElementById('qsFontFamily');
  const titleFontSize = document.getElementById('qsTitleFontSize');
  const fontSize = document.getElementById('qsFontSize');
  const fontColor = document.getElementById('qsFontColor');
  const bgBtns = document.querySelectorAll('.qs-bg-btn');
  const bgColorGroup = document.getElementById('qsBgColorGroup');
  const bgImageGroup = document.getElementById('qsBgImageGroup');
  const bgColor = document.getElementById('qsBgColor');
  const bgImageSelect = document.getElementById('qsBgImageSelect');
  const saveBtn = document.getElementById('qsSaveBtn');
  const backgroundDim = document.getElementById('qsBackgroundDim');
  const dimValue = document.getElementById('qsDimValue');

  loadQuickSlideBackgrounds();

  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      presetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentQsPreset = btn.dataset.preset;
      
      const isCustom = currentQsPreset === 'custom';
      const isCountdown = currentQsPreset === 'countdown';
      const showTitle = currentQsPreset === 'announcement' || currentQsPreset === 'prayer';
      
      titleRow.classList.toggle('hidden', isCustom || isCountdown || !showTitle);
      bodyRow.style.display = (isCustom || isCountdown) ? 'none' : '';
      elementsRow.style.display = isCustom ? '' : 'none';
      countdownLabelRow.style.display = isCountdown ? '' : 'none';
      countdownDurationRow.style.display = isCountdown ? '' : 'none';
      document.getElementById('qsLabelPosRow').style.display = isCountdown ? '' : 'none';
      document.getElementById('qsTimerPosRow').style.display = isCountdown ? '' : 'none';
      
      if (isCustom) {
        customSlideElements = [];
        renderCustomElementsList();
      }
      
      if (isCountdown) {
        countdownLabelPos = { vAlign: 'center', hAlign: 'center', width: 'wide', offsetX: 0, offsetY: -30 };
        countdownTimerPos = { vAlign: 'center', hAlign: 'center', width: 'wide', offsetX: 0, offsetY: 30 };
        resetCountdownPosControls();
      }
      
      applyPresetLayoutDefaults(currentQsPreset);
      updateQsPreview();
    });
  });

  addTitleBtn.addEventListener('click', () => {
    const hasTitle = customSlideElements.some(el => el.type === 'title');
    if (hasTitle) return;
    customSlideElements.unshift(createSlideElement({ type: 'title', text: '' }));
    renderCustomElementsList();
    updateQsPreview();
  });

  addBodyBtn.addEventListener('click', () => {
    const bodyCount = customSlideElements.filter(el => el.type === 'body').length;
    if (bodyCount >= 4) return;
    customSlideElements.push(createSlideElement({ type: 'body', text: '' }));
    renderCustomElementsList();
    updateQsPreview();
  });

  addCountdownBtn.addEventListener('click', () => {
    const hasCountdown = customSlideElements.some(el => el.type === 'countdown');
    if (hasCountdown) return;
    customSlideElements.push(createSlideElement({ type: 'countdown', durationMinutes: 5, durationSeconds: 0 }));
    renderCustomElementsList();
    updateQsPreview();
  });

  backgroundDim.addEventListener('input', () => {
    const pct = (backgroundDim.value / backgroundDim.max) * 100;
    backgroundDim.style.setProperty('--fill-percent', pct + '%');
    dimValue.textContent = backgroundDim.value + '%';
    updateQsPreview();
  });

  bgBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      bgBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentQsBgType = btn.dataset.bgType;
      bgColorGroup.style.display = currentQsBgType === 'color' ? '' : 'none';
      bgImageGroup.style.display = currentQsBgType === 'image' ? '' : 'none';
      updateQsPreview();
    });
  });

  bgImageSelect.addEventListener('change', () => {
    customQsBgImagePath = null;
    document.getElementById('qsCustomBgLabel').textContent = '';
    updateQsPreview();
  });

  const bgBrowseBtn = document.getElementById('qsBgBrowseBtn');
  bgBrowseBtn.addEventListener('click', async () => {
    const files = await ipcRenderer.invoke(IPC.PICK_FILE, [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }
    ]);
    if (files && files.length > 0) {
      customQsBgImagePath = files[0];
      bgImageSelect.value = '';
      document.getElementById('qsCustomBgLabel').textContent = path.basename(files[0]);
      updateQsPreview();
    }
  });

  titleInput.addEventListener('input', updateQsPreview);
  bodyInput.addEventListener('input', updateQsPreview);
  bodyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const start = bodyInput.selectionStart;
      const end = bodyInput.selectionEnd;
      const value = bodyInput.value;
      bodyInput.value = value.substring(0, start) + '\n' + value.substring(end);
      bodyInput.selectionStart = bodyInput.selectionEnd = start + 1;
      updateQsPreview();
    }
  });
  fontFamily.addEventListener('change', updateQsPreview);
  titleFontSize.addEventListener('change', updateQsPreview);
  fontSize.addEventListener('change', updateQsPreview);
  fontColor.addEventListener('input', updateQsPreview);
  bgColor.addEventListener('input', updateQsPreview);

  const countdownLabelInput = document.getElementById('qsCountdownLabel');
  const countdownMinInput = document.getElementById('qsCountdownMin');
  const countdownSecInput = document.getElementById('qsCountdownSec');
  countdownLabelInput.addEventListener('input', updateQsPreview);
  countdownMinInput.addEventListener('input', updateQsPreview);
  countdownSecInput.addEventListener('input', updateQsPreview);

  setupCountdownPosControls();

  saveBtn.addEventListener('click', saveQuickSlide);

  const stageBtn = document.getElementById('qsStageBtn');
  stageBtn.addEventListener('click', stageQuickSlide);

  const initDimSlider = document.getElementById('qsBackgroundDim');
  initDimSlider.style.setProperty('--fill-percent', (initDimSlider.value / initDimSlider.max) * 100 + '%');

  updateQsPreview();
}

function applyPresetLayoutDefaults(preset) {
  const defaults = PRESET_LAYOUT_DEFAULTS[preset] || PRESET_LAYOUT_DEFAULTS.announcement;
  const dimSlider = document.getElementById('qsBackgroundDim');
  dimSlider.value = defaults.backgroundDim;
  dimSlider.style.setProperty('--fill-percent', (defaults.backgroundDim / dimSlider.max) * 100 + '%');
  document.getElementById('qsDimValue').textContent = defaults.backgroundDim + '%';
}

function setupCountdownPosControls() {
  document.getElementById('qsLabelVAlign').addEventListener('change', (e) => {
    countdownLabelPos.vAlign = e.target.value;
    updateQsPreview();
  });
  document.getElementById('qsLabelHAlign').addEventListener('change', (e) => {
    countdownLabelPos.hAlign = e.target.value;
    updateQsPreview();
  });
  document.getElementById('qsLabelWidth').addEventListener('change', (e) => {
    countdownLabelPos.width = e.target.value;
    updateQsPreview();
  });
  document.getElementById('qsLabelNudgeLeft').addEventListener('click', () => {
    countdownLabelPos.offsetX = Math.max(-50, countdownLabelPos.offsetX - 5);
    updateLabelNudgeIndicator();
    updateQsPreview();
  });
  document.getElementById('qsLabelNudgeRight').addEventListener('click', () => {
    countdownLabelPos.offsetX = Math.min(50, countdownLabelPos.offsetX + 5);
    updateLabelNudgeIndicator();
    updateQsPreview();
  });
  document.getElementById('qsLabelNudgeUp').addEventListener('click', () => {
    countdownLabelPos.offsetY = Math.max(-50, countdownLabelPos.offsetY - 5);
    updateLabelNudgeIndicator();
    updateQsPreview();
  });
  document.getElementById('qsLabelNudgeDown').addEventListener('click', () => {
    countdownLabelPos.offsetY = Math.min(50, countdownLabelPos.offsetY + 5);
    updateLabelNudgeIndicator();
    updateQsPreview();
  });

  document.getElementById('qsTimerVAlign').addEventListener('change', (e) => {
    countdownTimerPos.vAlign = e.target.value;
    updateQsPreview();
  });
  document.getElementById('qsTimerHAlign').addEventListener('change', (e) => {
    countdownTimerPos.hAlign = e.target.value;
    updateQsPreview();
  });
  document.getElementById('qsTimerWidth').addEventListener('change', (e) => {
    countdownTimerPos.width = e.target.value;
    updateQsPreview();
  });
  document.getElementById('qsTimerNudgeLeft').addEventListener('click', () => {
    countdownTimerPos.offsetX = Math.max(-50, countdownTimerPos.offsetX - 5);
    updateTimerNudgeIndicator();
    updateQsPreview();
  });
  document.getElementById('qsTimerNudgeRight').addEventListener('click', () => {
    countdownTimerPos.offsetX = Math.min(50, countdownTimerPos.offsetX + 5);
    updateTimerNudgeIndicator();
    updateQsPreview();
  });
  document.getElementById('qsTimerNudgeUp').addEventListener('click', () => {
    countdownTimerPos.offsetY = Math.max(-50, countdownTimerPos.offsetY - 5);
    updateTimerNudgeIndicator();
    updateQsPreview();
  });
  document.getElementById('qsTimerNudgeDown').addEventListener('click', () => {
    countdownTimerPos.offsetY = Math.min(50, countdownTimerPos.offsetY + 5);
    updateTimerNudgeIndicator();
    updateQsPreview();
  });
}

function updateLabelNudgeIndicator() {
  const indicator = document.getElementById('qsLabelNudgeIndicator');
  const ox = countdownLabelPos.offsetX;
  const oy = countdownLabelPos.offsetY;
  indicator.textContent = (ox !== 0 || oy !== 0) ? `(${ox}, ${oy})` : '';
}

function updateTimerNudgeIndicator() {
  const indicator = document.getElementById('qsTimerNudgeIndicator');
  const ox = countdownTimerPos.offsetX;
  const oy = countdownTimerPos.offsetY;
  indicator.textContent = (ox !== 0 || oy !== 0) ? `(${ox}, ${oy})` : '';
}

function resetCountdownPosControls() {
  document.getElementById('qsLabelVAlign').value = countdownLabelPos.vAlign;
  document.getElementById('qsLabelHAlign').value = countdownLabelPos.hAlign;
  document.getElementById('qsLabelWidth').value = countdownLabelPos.width;
  updateLabelNudgeIndicator();
  
  document.getElementById('qsTimerVAlign').value = countdownTimerPos.vAlign;
  document.getElementById('qsTimerHAlign').value = countdownTimerPos.hAlign;
  document.getElementById('qsTimerWidth').value = countdownTimerPos.width;
  updateTimerNudgeIndicator();
}

async function loadQuickSlideBackgrounds() {
  defaultQuickSlideBackgrounds = await ipcRenderer.invoke(IPC.GET_DEFAULT_QUICKSLIDE_BACKGROUNDS);
  const bgSelect = document.getElementById('qsBgImageSelect');
  bgSelect.innerHTML = '<option value="">-- Select --</option>';
  defaultQuickSlideBackgrounds.forEach(bg => {
    const opt = document.createElement('option');
    opt.value = bg.path;
    opt.textContent = bg.name;
    bgSelect.appendChild(opt);
  });
}

function getQsFormState() {
  const bgImageSelect = document.getElementById('qsBgImageSelect');
  const bgImagePath = customQsBgImagePath || bgImageSelect.value;
  return {
    preset: currentQsPreset,
    title: document.getElementById('qsTitle').value.trim(),
    body: document.getElementById('qsBody').value.trim(),
    elements: currentQsPreset === 'custom' ? JSON.stringify(customSlideElements) : null,
    background: currentQsBgType === 'color' ? document.getElementById('qsBgColor').value : '#000000',
    backgroundImage: currentQsBgType === 'image' && bgImagePath ? bgImagePath : null,
    fontFamily: document.getElementById('qsFontFamily').value,
    titleFontSize: parseInt(document.getElementById('qsTitleFontSize').value),
    fontSize: parseInt(document.getElementById('qsFontSize').value),
    fontColor: document.getElementById('qsFontColor').value,
    backgroundDim: parseInt(document.getElementById('qsBackgroundDim').value),
    countdownLabel: document.getElementById('qsCountdownLabel').value.trim(),
    durationMinutes: parseInt(document.getElementById('qsCountdownMin').value) || 0,
    durationSeconds: parseInt(document.getElementById('qsCountdownSec').value) || 0
  };
}

function hasQsStagedChanges() {
  if (!staged || staged.type !== 'quick-slide') {
    const form = getQsFormState();
    if (currentQsPreset === 'custom') {
      return customSlideElements.length > 0;
    } else if (currentQsPreset === 'countdown') {
      return form.countdownLabel !== '' || form.durationMinutes > 0 || form.durationSeconds > 0;
    } else {
      return form.title !== '' || form.body !== '';
    }
  }
  const form = getQsFormState();
  if (form.preset !== staged.preset) return true;
  if (form.fontFamily !== staged.fontFamily) return true;
  if (form.titleFontSize !== staged.titleFontSize) return true;
  if (form.fontSize !== staged.fontSize) return true;
  if (form.fontColor !== staged.fontColor) return true;
  if (form.background !== staged.background) return true;
  if (form.backgroundImage !== staged.backgroundImage) return true;
  if (form.backgroundDim !== staged.backgroundDim) return true;
  if (currentQsPreset === 'custom') {
    if (form.elements !== JSON.stringify(staged.elements || [])) return true;
  } else if (currentQsPreset === 'countdown') {
    if (form.countdownLabel !== staged.countdownLabel) return true;
    if (form.durationMinutes !== staged.durationMinutes) return true;
    if (form.durationSeconds !== staged.durationSeconds) return true;
  } else {
    if (form.title !== staged.title) return true;
    if (form.body !== staged.body) return true;
  }
  return false;
}

function updateQsStageButton() {
  const stageBtn = document.getElementById('qsStageBtn');
  const hasChanges = hasQsStagedChanges();
  stageBtn.classList.toggle('has-changes', hasChanges);
}

function updateQsPreview() {
  const previewArea = document.getElementById('qsPreviewArea');
  const previewTitle = document.getElementById('qsPreviewTitle');
  const previewBody = document.getElementById('qsPreviewBody');
  const previewCustom = document.getElementById('qsPreviewCustom');
  const titleInput = document.getElementById('qsTitle');
  const bodyInput = document.getElementById('qsBody');
  const fontFamily = document.getElementById('qsFontFamily').value;
  const titleFontSize = parseInt(document.getElementById('qsTitleFontSize').value);
  const fontSize = parseInt(document.getElementById('qsFontSize').value);
  const fontColor = document.getElementById('qsFontColor').value;
  const bgColor = document.getElementById('qsBgColor').value;
  const bgImageSelect = document.getElementById('qsBgImageSelect');
  const bgImagePath = customQsBgImagePath || bgImageSelect.value;

  const defaults = PRESET_LAYOUT_DEFAULTS[currentQsPreset] || PRESET_LAYOUT_DEFAULTS.announcement;
  const backgroundDim = parseInt(document.getElementById('qsBackgroundDim').value) || defaults.backgroundDim;

  updateFormPreviewScale();
  const scaledFontSize = Math.round(fontSize * formPreviewScale);
  const scaledTitleSize = Math.round(titleFontSize * formPreviewScale);

  if (currentQsBgType === 'image' && bgImagePath) {
    previewArea.style.backgroundImage = `url('file:///${bgImagePath.replace(/\\/g, '/')}')`;
    previewArea.style.backgroundSize = 'cover';
    previewArea.style.backgroundPosition = 'center';
    previewArea.style.backgroundColor = 'transparent';
  } else {
    previewArea.style.backgroundImage = 'none';
    previewArea.style.backgroundColor = currentQsBgType === 'color' ? bgColor : '#000';
  }

  previewArea.style.setProperty('--dim-opacity', backgroundDim / 100);

  if (currentQsPreset === 'custom') {
    previewTitle.style.display = 'none';
    previewBody.style.display = 'none';
    previewCustom.classList.add('active');
    previewArea.style.justifyContent = '';
    previewArea.style.alignItems = '';
    previewArea.style.textAlign = '';
    
    previewCustom.innerHTML = '';
    customSlideElements.forEach(el => {
      const div = document.createElement('div');
      div.className = `qs-preview-custom-el v-${el.verticalAlign} h-${el.horizontalAlign} w-${el.textWidth}`;
      if (el.type === 'title') div.classList.add('el-title');
      if (el.type === 'countdown') div.classList.add('el-countdown');
      div.style.fontFamily = el.fontFamily || fontFamily;
      const elSize = el.fontSize || (el.type === 'title' || el.type === 'countdown' ? titleFontSize : fontSize);
      const scaledElSize = Math.round(elSize * formPreviewScale);
      div.style.fontSize = scaledElSize + 'px';
      div.style.color = el.fontColor || fontColor;
      const ox = el.offsetX || 0;
      const oy = el.offsetY || 0;
      const baseX = el.horizontalAlign === 'center' ? -50 : 0;
      const baseY = el.verticalAlign === 'center' ? -50 : 0;
      div.style.transform = `translate(calc(${baseX}% + ${ox}%), calc(${baseY}% + ${oy}%))`;
      if (el.type === 'countdown') {
        const mins = el.durationMinutes || 0;
        const secs = el.durationSeconds || 0;
        div.textContent = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
      } else if (el.type === 'title') {
        div.innerHTML = escapeHtml(el.text);
      } else {
        div.innerHTML = parseBodyForLists(el.text);
      }
      previewCustom.appendChild(div);
    });
  } else if (currentQsPreset === 'countdown') {
    previewTitle.style.display = 'none';
    previewBody.style.display = 'none';
    previewCustom.classList.add('active');
    previewCustom.innerHTML = '';
    
    const countdownLabel = document.getElementById('qsCountdownLabel').value;
    const mins = parseInt(document.getElementById('qsCountdownMin').value) || 0;
    const secs = parseInt(document.getElementById('qsCountdownSec').value) || 0;
    const timerDisplay = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    
    previewArea.style.justifyContent = '';
    previewArea.style.alignItems = '';
    previewArea.style.textAlign = '';
    
    if (countdownLabel) {
      const labelDiv = document.createElement('div');
      labelDiv.className = `qs-preview-custom-el v-${countdownLabelPos.vAlign} h-${countdownLabelPos.hAlign} w-${countdownLabelPos.width}`;
      labelDiv.style.fontFamily = fontFamily;
      labelDiv.style.fontSize = scaledFontSize + 'px';
      labelDiv.style.color = fontColor;
      const lox = countdownLabelPos.offsetX;
      const loy = countdownLabelPos.offsetY;
      const lbaseX = countdownLabelPos.hAlign === 'center' ? -50 : 0;
      const lbaseY = countdownLabelPos.vAlign === 'center' ? -50 : 0;
      labelDiv.style.transform = `translate(calc(${lbaseX}% + ${lox}%), calc(${lbaseY}% + ${loy}%))`;
      labelDiv.textContent = countdownLabel;
      previewCustom.appendChild(labelDiv);
    }
    
    const timerDiv = document.createElement('div');
    timerDiv.className = `qs-preview-custom-el el-countdown v-${countdownTimerPos.vAlign} h-${countdownTimerPos.hAlign} w-${countdownTimerPos.width}`;
    timerDiv.style.fontFamily = fontFamily;
    timerDiv.style.fontSize = (scaledTitleSize * 1.5) + 'px';
    timerDiv.style.color = fontColor;
    const tox = countdownTimerPos.offsetX;
    const toy = countdownTimerPos.offsetY;
    const tbaseX = countdownTimerPos.hAlign === 'center' ? -50 : 0;
    const tbaseY = countdownTimerPos.vAlign === 'center' ? -50 : 0;
    timerDiv.style.transform = `translate(calc(${tbaseX}% + ${tox}%), calc(${tbaseY}% + ${toy}%))`;
    timerDiv.textContent = timerDisplay;
    previewCustom.appendChild(timerDiv);
  } else {
    previewTitle.style.display = '';
    previewBody.style.display = '';
    previewCustom.classList.remove('active');
    previewCustom.innerHTML = '';
    
    const verticalAlign = defaults.verticalAlign;
    const horizontalAlign = defaults.horizontalAlign;
    const textWidth = defaults.textWidth;
    
    const vAlignMap = { top: 'flex-start', center: 'center', bottom: 'flex-end' };
    const hAlignMap = { left: 'flex-start', center: 'center', right: 'flex-end' };
    const textAlignMap = { left: 'left', center: 'center', right: 'right' };
    const widthMap = { wide: '90%', medium: '70%', narrow: '50%' };

    previewArea.style.justifyContent = vAlignMap[verticalAlign] || 'center';
    previewArea.style.alignItems = hAlignMap[horizontalAlign] || 'center';
    previewArea.style.textAlign = textAlignMap[horizontalAlign] || 'center';

    const maxWidth = widthMap[textWidth] || '90%';
    const showTitle = currentQsPreset === 'announcement' || currentQsPreset === 'prayer';

    previewTitle.style.display = showTitle && titleInput.value ? '' : 'none';
    previewTitle.style.fontFamily = fontFamily;
    previewTitle.style.fontSize = scaledTitleSize + 'px';
    previewTitle.style.color = fontColor;
    previewTitle.style.maxWidth = maxWidth;
    previewTitle.textContent = titleInput.value;

    previewBody.style.fontFamily = fontFamily;
    previewBody.style.fontSize = scaledFontSize + 'px';
    previewBody.style.color = fontColor;
    previewBody.style.maxWidth = maxWidth;
    previewBody.innerHTML = parseBodyForLists(bodyInput.value);
  }
  
  updateQsStageButton();
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function saveQuickSlide() {
  const displayName = document.getElementById('qsDisplayName').value.trim();
  const titleInput = document.getElementById('qsTitle');
  const bodyInput = document.getElementById('qsBody');
  const fontFamily = document.getElementById('qsFontFamily').value;
  const titleFontSize = parseInt(document.getElementById('qsTitleFontSize').value);
  const fontSize = parseInt(document.getElementById('qsFontSize').value);
  const fontColor = document.getElementById('qsFontColor').value;
  const bgColor = document.getElementById('qsBgColor').value;
  const bgImageSelect = document.getElementById('qsBgImageSelect');
  const bgImagePath = customQsBgImagePath || bgImageSelect.value;
  const backgroundDim = parseInt(document.getElementById('qsBackgroundDim').value);
  const countdownLabel = document.getElementById('qsCountdownLabel').value.trim();
  const countdownMin = parseInt(document.getElementById('qsCountdownMin').value) || 0;
  const countdownSec = parseInt(document.getElementById('qsCountdownSec').value) || 0;

  if (currentQsPreset !== 'custom' && currentQsPreset !== 'countdown' && !bodyInput.value.trim()) {
    alert('Please enter content for the slide.');
    return;
  }

  const defaults = PRESET_LAYOUT_DEFAULTS[currentQsPreset] || PRESET_LAYOUT_DEFAULTS.announcement;

  const slide = createQuickSlide({
    id: editingQuickSlideId || null,
    preset: currentQsPreset,
    displayName,
    title: (currentQsPreset !== 'custom' && currentQsPreset !== 'countdown') ? titleInput.value.trim() : '',
    body: (currentQsPreset !== 'custom' && currentQsPreset !== 'countdown') ? bodyInput.value.trim() : '',
    elements: currentQsPreset === 'custom' ? customSlideElements : null,
    background: currentQsBgType === 'color' ? bgColor : '#000000',
    backgroundImage: currentQsBgType === 'image' && bgImagePath ? bgImagePath : null,
    fontFamily,
    titleFontSize,
    fontSize,
    fontColor,
    verticalAlign: defaults.verticalAlign,
    horizontalAlign: defaults.horizontalAlign,
    textWidth: defaults.textWidth,
    backgroundDim,
    countdownLabel: currentQsPreset === 'countdown' ? countdownLabel : '',
    durationMinutes: currentQsPreset === 'countdown' ? countdownMin : 5,
    durationSeconds: currentQsPreset === 'countdown' ? countdownSec : 0,
    endTime: null,
    labelVerticalAlign: currentQsPreset === 'countdown' ? countdownLabelPos.vAlign : 'center',
    labelHorizontalAlign: currentQsPreset === 'countdown' ? countdownLabelPos.hAlign : 'center',
    labelTextWidth: currentQsPreset === 'countdown' ? countdownLabelPos.width : 'wide',
    labelOffsetX: currentQsPreset === 'countdown' ? countdownLabelPos.offsetX : 0,
    labelOffsetY: currentQsPreset === 'countdown' ? countdownLabelPos.offsetY : -20,
    timerVerticalAlign: currentQsPreset === 'countdown' ? countdownTimerPos.vAlign : 'center',
    timerHorizontalAlign: currentQsPreset === 'countdown' ? countdownTimerPos.hAlign : 'center',
    timerTextWidth: currentQsPreset === 'countdown' ? countdownTimerPos.width : 'wide',
    timerOffsetX: currentQsPreset === 'countdown' ? countdownTimerPos.offsetX : 0,
    timerOffsetY: currentQsPreset === 'countdown' ? countdownTimerPos.offsetY : 20
  });

  const result = await ipcRenderer.invoke(IPC.SAVE_QUICK_SLIDE, slide);
  if (result.success) {
    const wasEditing = !!editingQuickSlideId;
    quickSlides = result.slides;
    clearQuickSlideForm();
    renderImageGrid();
    alert(wasEditing ? 'Slide updated!' : 'Slide saved!');
  }
}

function stageQuickSlide() {
  const displayName = document.getElementById('qsDisplayName').value.trim();
  const titleInput = document.getElementById('qsTitle');
  const bodyInput = document.getElementById('qsBody');
  const fontFamily = document.getElementById('qsFontFamily').value;
  const titleFontSize = parseInt(document.getElementById('qsTitleFontSize').value);
  const fontSize = parseInt(document.getElementById('qsFontSize').value);
  const fontColor = document.getElementById('qsFontColor').value;
  const bgColor = document.getElementById('qsBgColor').value;
  const bgImageSelect = document.getElementById('qsBgImageSelect');
  const bgImagePath = customQsBgImagePath || bgImageSelect.value;
  const backgroundDim = parseInt(document.getElementById('qsBackgroundDim').value);
  const countdownLabel = document.getElementById('qsCountdownLabel').value.trim();
  const countdownMin = parseInt(document.getElementById('qsCountdownMin').value) || 0;
  const countdownSec = parseInt(document.getElementById('qsCountdownSec').value) || 0;

  const defaults = PRESET_LAYOUT_DEFAULTS[currentQsPreset] || PRESET_LAYOUT_DEFAULTS.announcement;

  let endTime = null;
  if (currentQsPreset === 'countdown') {
    const durationMs = (countdownMin * 60 + countdownSec) * 1000;
    endTime = Date.now() + durationMs;
  }

  staged = createQuickSlide({
    id: null,
    preset: currentQsPreset,
    displayName,
    title: (currentQsPreset !== 'custom' && currentQsPreset !== 'countdown') ? titleInput.value.trim() : '',
    body: (currentQsPreset !== 'custom' && currentQsPreset !== 'countdown') ? bodyInput.value.trim() : '',
    elements: currentQsPreset === 'custom' ? customSlideElements : null,
    background: currentQsBgType === 'color' ? bgColor : '#000000',
    backgroundImage: currentQsBgType === 'image' && bgImagePath ? bgImagePath : null,
    fontFamily,
    titleFontSize,
    fontSize,
    fontColor,
    verticalAlign: defaults.verticalAlign,
    horizontalAlign: defaults.horizontalAlign,
    textWidth: defaults.textWidth,
    backgroundDim,
    countdownLabel: currentQsPreset === 'countdown' ? countdownLabel : '',
    durationMinutes: currentQsPreset === 'countdown' ? countdownMin : 5,
    durationSeconds: currentQsPreset === 'countdown' ? countdownSec : 0,
    endTime,
    labelVerticalAlign: currentQsPreset === 'countdown' ? countdownLabelPos.vAlign : 'center',
    labelHorizontalAlign: currentQsPreset === 'countdown' ? countdownLabelPos.hAlign : 'center',
    labelTextWidth: currentQsPreset === 'countdown' ? countdownLabelPos.width : 'wide',
    labelOffsetX: currentQsPreset === 'countdown' ? countdownLabelPos.offsetX : 0,
    labelOffsetY: currentQsPreset === 'countdown' ? countdownLabelPos.offsetY : -20,
    timerVerticalAlign: currentQsPreset === 'countdown' ? countdownTimerPos.vAlign : 'center',
    timerHorizontalAlign: currentQsPreset === 'countdown' ? countdownTimerPos.hAlign : 'center',
    timerTextWidth: currentQsPreset === 'countdown' ? countdownTimerPos.width : 'wide',
    timerOffsetX: currentQsPreset === 'countdown' ? countdownTimerPos.offsetX : 0,
    timerOffsetY: currentQsPreset === 'countdown' ? countdownTimerPos.offsetY : 20
  });

  updatePreviewDisplay();
  updateGoLiveButton();
  updateQsStageButton();
}

function renderCustomElementsList() {
  const elementsList = document.getElementById('qsElementsList');
  const elementsHint = document.getElementById('qsElementsHint');
  const addTitleBtn = document.getElementById('qsAddTitleBtn');
  const addBodyBtn = document.getElementById('qsAddBodyBtn');
  const addCountdownBtn = document.getElementById('qsAddCountdownBtn');
  
  elementsList.innerHTML = '';
  
  const hasTitle = customSlideElements.some(el => el.type === 'title');
  const bodyCount = customSlideElements.filter(el => el.type === 'body').length;
  const hasCountdown = customSlideElements.some(el => el.type === 'countdown');
  addTitleBtn.disabled = hasTitle;
  addBodyBtn.disabled = bodyCount >= 4;
  addCountdownBtn.disabled = hasCountdown;
  elementsHint.style.display = customSlideElements.length === 0 ? '' : 'none';
  
  customSlideElements.forEach((el, index) => {
    const item = document.createElement('div');
    item.className = 'qs-element-item';
    
    const topRow = document.createElement('div');
    topRow.className = 'qs-element-top-row';
    
    const typeLabel = document.createElement('span');
    typeLabel.className = 'qs-element-type';
    typeLabel.textContent = el.type;
    
    let inputContainer;
    if (el.type === 'countdown') {
      inputContainer = document.createElement('div');
      inputContainer.className = 'qs-element-countdown-inputs';
      
      const minInput = document.createElement('input');
      minInput.type = 'number';
      minInput.className = 'qs-element-duration-input';
      minInput.min = 0;
      minInput.max = 120;
      minInput.value = el.durationMinutes || 0;
      minInput.addEventListener('input', () => {
        customSlideElements[index].durationMinutes = parseInt(minInput.value) || 0;
        updateQsPreview();
      });
      
      const minLabel = document.createElement('span');
      minLabel.className = 'qs-element-duration-label';
      minLabel.textContent = 'min';
      
      const secInput = document.createElement('input');
      secInput.type = 'number';
      secInput.className = 'qs-element-duration-input';
      secInput.min = 0;
      secInput.max = 59;
      secInput.value = el.durationSeconds || 0;
      secInput.addEventListener('input', () => {
        customSlideElements[index].durationSeconds = parseInt(secInput.value) || 0;
        updateQsPreview();
      });
      
      const secLabel = document.createElement('span');
      secLabel.className = 'qs-element-duration-label';
      secLabel.textContent = 'sec';
      
      inputContainer.appendChild(minInput);
      inputContainer.appendChild(minLabel);
      inputContainer.appendChild(secInput);
      inputContainer.appendChild(secLabel);
    } else if (el.type === 'body') {
      inputContainer = document.createElement('textarea');
      inputContainer.className = 'qs-element-text qs-element-textarea';
      inputContainer.placeholder = 'Enter body text...';
      inputContainer.rows = 3;
      inputContainer.value = el.text;
      inputContainer.addEventListener('input', () => {
        customSlideElements[index].text = inputContainer.value;
        updateQsPreview();
      });
    } else {
      inputContainer = document.createElement('input');
      inputContainer.type = 'text';
      inputContainer.className = 'qs-element-text';
      inputContainer.placeholder = 'Enter title...';
      inputContainer.value = el.text;
      inputContainer.addEventListener('input', () => {
        customSlideElements[index].text = inputContainer.value;
        updateQsPreview();
      });
    }
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'qs-element-remove';
    removeBtn.innerHTML = '×';
    removeBtn.addEventListener('click', () => {
      customSlideElements.splice(index, 1);
      renderCustomElementsList();
      updateQsPreview();
    });
    
    const moveUpBtn = document.createElement('button');
    moveUpBtn.className = 'qs-element-reorder';
    moveUpBtn.innerHTML = '↑';
    moveUpBtn.title = 'Move up';
    moveUpBtn.disabled = index === 0;
    moveUpBtn.addEventListener('click', () => {
      if (index > 0) {
        [customSlideElements[index - 1], customSlideElements[index]] = 
          [customSlideElements[index], customSlideElements[index - 1]];
        renderCustomElementsList();
        updateQsPreview();
      }
    });
    
    const moveDownBtn = document.createElement('button');
    moveDownBtn.className = 'qs-element-reorder';
    moveDownBtn.innerHTML = '↓';
    moveDownBtn.title = 'Move down';
    moveDownBtn.disabled = index === customSlideElements.length - 1;
    moveDownBtn.addEventListener('click', () => {
      if (index < customSlideElements.length - 1) {
        [customSlideElements[index], customSlideElements[index + 1]] = 
          [customSlideElements[index + 1], customSlideElements[index]];
        renderCustomElementsList();
        updateQsPreview();
      }
    });
    
    topRow.appendChild(typeLabel);
    topRow.appendChild(inputContainer);
    topRow.appendChild(moveUpBtn);
    topRow.appendChild(moveDownBtn);
    topRow.appendChild(removeBtn);
    
    const posRow = document.createElement('div');
    posRow.className = 'qs-element-pos-row';
    
    const vAlignSelect = createPositionSelect('V', ['top', 'center', 'bottom'], el.verticalAlign, (val) => {
      customSlideElements[index].verticalAlign = val;
      updateQsPreview();
    });
    
    const hAlignSelect = createPositionSelect('H', ['left', 'center', 'right'], el.horizontalAlign, (val) => {
      customSlideElements[index].horizontalAlign = val;
      updateQsPreview();
    });
    
    const widthSelect = createPositionSelect('W', ['wide', 'medium', 'narrow'], el.textWidth, (val) => {
      customSlideElements[index].textWidth = val;
      updateQsPreview();
    });
    
    const colorWrapper = document.createElement('div');
    colorWrapper.className = 'qs-element-pos-item';
    const colorLabel = document.createElement('span');
    colorLabel.className = 'qs-element-pos-label';
    colorLabel.textContent = 'C';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'qs-element-color';
    const slideFontColor = document.getElementById('qsFontColor').value;
    colorInput.value = el.fontColor || slideFontColor;
    colorInput.addEventListener('input', () => {
      customSlideElements[index].fontColor = colorInput.value;
      updateQsPreview();
    });
    colorWrapper.appendChild(colorLabel);
    colorWrapper.appendChild(colorInput);
    
    const fontWrapper = document.createElement('div');
    fontWrapper.className = 'qs-element-pos-item';
    const fontLabel = document.createElement('span');
    fontLabel.className = 'qs-element-pos-label';
    fontLabel.textContent = 'F';
    const fontSelect = document.createElement('select');
    fontSelect.className = 'qs-element-font';
    const slideFontFamily = document.getElementById('qsFontFamily').value;
    const fontOptions = ['', 'Georgia', 'Arial', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Palatino Linotype'];
    fontOptions.forEach(font => {
      const opt = document.createElement('option');
      opt.value = font;
      opt.textContent = font || '(Slide)';
      if ((el.fontFamily || '') === font) opt.selected = true;
      fontSelect.appendChild(opt);
    });
    fontSelect.addEventListener('change', () => {
      customSlideElements[index].fontFamily = fontSelect.value || null;
      updateQsPreview();
    });
    fontWrapper.appendChild(fontLabel);
    fontWrapper.appendChild(fontSelect);
    
    const sizeWrapper = document.createElement('div');
    sizeWrapper.className = 'qs-element-pos-item';
    const sizeLabel = document.createElement('span');
    sizeLabel.className = 'qs-element-pos-label';
    sizeLabel.textContent = 'S';
    const sizeSelect = document.createElement('select');
    sizeSelect.className = 'qs-element-font';
    const sizeOptions = ['', '36', '48', '60', '72', '84', '96', '108', '120'];
    sizeOptions.forEach(size => {
      const opt = document.createElement('option');
      opt.value = size;
      opt.textContent = size ? size + 'px' : '(Slide)';
      if ((el.fontSize ? String(el.fontSize) : '') === size) opt.selected = true;
      sizeSelect.appendChild(opt);
    });
    sizeSelect.addEventListener('change', () => {
      customSlideElements[index].fontSize = sizeSelect.value ? parseInt(sizeSelect.value) : null;
      updateQsPreview();
    });
    sizeWrapper.appendChild(sizeLabel);
    sizeWrapper.appendChild(sizeSelect);
    
    posRow.appendChild(vAlignSelect);
    posRow.appendChild(hAlignSelect);
    posRow.appendChild(widthSelect);
    posRow.appendChild(colorWrapper);
    posRow.appendChild(fontWrapper);
    posRow.appendChild(sizeWrapper);
    
    const nudgeRow = document.createElement('div');
    nudgeRow.className = 'qs-element-nudge-row';
    
    const nudgeLabel = document.createElement('span');
    nudgeLabel.className = 'qs-element-nudge-label';
    nudgeLabel.textContent = 'Nudge:';
    
    const createNudgeBtn = (symbol, axis, delta) => {
      const btn = document.createElement('button');
      btn.className = 'qs-nudge-btn';
      btn.textContent = symbol;
      btn.addEventListener('click', () => {
        const prop = axis === 'x' ? 'offsetX' : 'offsetY';
        const current = customSlideElements[index][prop] || 0;
        const newVal = Math.max(-50, Math.min(50, current + delta));
        customSlideElements[index][prop] = newVal;
        updateNudgeIndicator();
        updateQsPreview();
      });
      return btn;
    };
    
    const nudgeIndicator = document.createElement('span');
    nudgeIndicator.className = 'qs-nudge-indicator';
    const updateNudgeIndicator = () => {
      const ox = customSlideElements[index].offsetX || 0;
      const oy = customSlideElements[index].offsetY || 0;
      nudgeIndicator.textContent = (ox !== 0 || oy !== 0) ? `(${ox}, ${oy})` : '';
    };
    updateNudgeIndicator();
    
    const resetBtn = document.createElement('button');
    resetBtn.className = 'qs-nudge-btn qs-nudge-reset';
    resetBtn.textContent = '⟲';
    resetBtn.title = 'Reset offsets';
    resetBtn.addEventListener('click', () => {
      customSlideElements[index].offsetX = 0;
      customSlideElements[index].offsetY = 0;
      updateNudgeIndicator();
      updateQsPreview();
    });
    
    nudgeRow.appendChild(nudgeLabel);
    nudgeRow.appendChild(createNudgeBtn('←', 'x', -5));
    nudgeRow.appendChild(createNudgeBtn('→', 'x', 5));
    nudgeRow.appendChild(createNudgeBtn('↑', 'y', -5));
    nudgeRow.appendChild(createNudgeBtn('↓', 'y', 5));
    nudgeRow.appendChild(nudgeIndicator);
    nudgeRow.appendChild(resetBtn);
    
    item.appendChild(topRow);
    item.appendChild(posRow);
    item.appendChild(nudgeRow);
    elementsList.appendChild(item);
  });
}

function createPositionSelect(label, options, currentValue, onChange) {
  const wrapper = document.createElement('div');
  wrapper.className = 'qs-element-pos-item';
  
  const labelEl = document.createElement('span');
  labelEl.className = 'qs-element-pos-label';
  labelEl.textContent = label;
  
  const select = document.createElement('select');
  select.className = 'qs-element-pos-select';
  
  options.forEach(opt => {
    const option = document.createElement('option');
    option.value = opt;
    option.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
    if (opt === currentValue) option.selected = true;
    select.appendChild(option);
  });
  
  select.addEventListener('change', () => onChange(select.value));
  
  wrapper.appendChild(labelEl);
  wrapper.appendChild(select);
  return wrapper;
}

function clearQuickSlideForm() {
  document.getElementById('qsDisplayName').value = '';
  document.getElementById('qsTitle').value = '';
  document.getElementById('qsBody').value = '';
  document.getElementById('qsFontFamily').value = 'Georgia';
  document.getElementById('qsTitleFontSize').value = '60';
  document.getElementById('qsFontSize').value = '48';
  document.getElementById('qsFontColor').value = '#FFFFFF';
  document.getElementById('qsBgColor').value = '#000000';
  document.getElementById('qsBgImageSelect').value = '';
  document.getElementById('qsCustomBgLabel').textContent = '';
  editingQuickSlideId = null;
  currentQsPreset = 'announcement';
  currentQsBgType = 'color';
  customSlideElements = [];
  customQsBgImagePath = null;
  
  document.querySelectorAll('.qs-preset-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.preset === 'announcement');
  });
  document.querySelectorAll('.qs-bg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.bgType === 'color');
  });
  document.getElementById('qsTitleRow').classList.remove('hidden');
  document.getElementById('qsBodyRow').style.display = '';
  document.getElementById('qsElementsRow').style.display = 'none';
  document.getElementById('qsElementsList').innerHTML = '';
  document.getElementById('qsElementsHint').style.display = '';
  document.getElementById('qsAddTitleBtn').disabled = false;
  document.getElementById('qsAddBodyBtn').disabled = false;
  document.getElementById('qsBgColorGroup').style.display = '';
  document.getElementById('qsBgImageGroup').style.display = 'none';
  document.getElementById('qsCountdownLabelRow').style.display = 'none';
  document.getElementById('qsCountdownDurationRow').style.display = 'none';
  document.getElementById('qsCountdownLabel').value = '';
  document.getElementById('qsCountdownMin').value = '5';
  document.getElementById('qsCountdownSec').value = '0';
  
  const dimSlider = document.getElementById('qsBackgroundDim');
  dimSlider.value = 0;
  dimSlider.style.setProperty('--fill-percent', '0%');
  document.getElementById('qsDimValue').textContent = '0%';
  
  document.getElementById('qsSaveBtn').textContent = 'Save Slide';
  
  updateQsPreview();
}

function loadQuickSlideForEdit(slide) {
  editingQuickSlideId = slide.id;
  currentQsPreset = slide.preset;
  currentQsBgType = slide.backgroundImage ? 'image' : 'color';
  customSlideElements = slide.preset === 'custom' && slide.elements ? [...slide.elements] : [];
  
  const isPresetBg = slide.backgroundImage && defaultQuickSlideBackgrounds.some(bg => bg.path === slide.backgroundImage);
  if (slide.backgroundImage && !isPresetBg) {
    customQsBgImagePath = slide.backgroundImage;
  } else {
    customQsBgImagePath = null;
  }
  
  document.getElementById('qsDisplayName').value = slide.displayName || '';
  document.getElementById('qsTitle').value = slide.title || '';
  document.getElementById('qsBody').value = slide.body || '';
  document.getElementById('qsFontFamily').value = slide.fontFamily || 'Georgia';
  document.getElementById('qsTitleFontSize').value = slide.titleFontSize || 60;
  document.getElementById('qsFontSize').value = slide.fontSize || 48;
  document.getElementById('qsFontColor').value = slide.fontColor || '#FFFFFF';
  document.getElementById('qsBgColor').value = slide.background || '#000000';
  document.getElementById('qsBgImageSelect').value = isPresetBg ? slide.backgroundImage : '';
  document.getElementById('qsCustomBgLabel').textContent = customQsBgImagePath ? path.basename(customQsBgImagePath) : '';
  
  document.querySelectorAll('.qs-preset-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.preset === slide.preset);
  });
  document.querySelectorAll('.qs-bg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.bgType === currentQsBgType);
  });
  
  const isCustom = slide.preset === 'custom';
  const isCountdown = slide.preset === 'countdown';
  const showTitle = slide.preset === 'announcement' || slide.preset === 'prayer';
  document.getElementById('qsTitleRow').classList.toggle('hidden', isCustom || isCountdown || !showTitle);
  document.getElementById('qsBodyRow').style.display = (isCustom || isCountdown) ? 'none' : '';
  document.getElementById('qsElementsRow').style.display = isCustom ? '' : 'none';
  document.getElementById('qsCountdownLabelRow').style.display = isCountdown ? '' : 'none';
  document.getElementById('qsCountdownDurationRow').style.display = isCountdown ? '' : 'none';
  document.getElementById('qsBgColorGroup').style.display = currentQsBgType === 'color' ? '' : 'none';
  document.getElementById('qsBgImageGroup').style.display = currentQsBgType === 'image' ? '' : 'none';
  
  if (isCustom) {
    renderCustomElementsList();
  }
  
  if (isCountdown) {
    document.getElementById('qsCountdownLabel').value = slide.countdownLabel || '';
    document.getElementById('qsCountdownMin').value = slide.durationMinutes !== undefined ? slide.durationMinutes : 5;
    document.getElementById('qsCountdownSec').value = slide.durationSeconds !== undefined ? slide.durationSeconds : 0;
  }
  
  const dimSlider = document.getElementById('qsBackgroundDim');
  const dimVal = slide.backgroundDim !== undefined ? slide.backgroundDim : 0;
  dimSlider.value = dimVal;
  dimSlider.style.setProperty('--fill-percent', (dimVal / dimSlider.max) * 100 + '%');
  document.getElementById('qsDimValue').textContent = dimVal + '%';
  
  updateQsPreview();
  
  document.getElementById('qsSaveBtn').textContent = 'Update Slide';
}

async function navigateLiveVerse(direction) {
  if (!live || live.type !== 'scripture') return;
  
  const bibleId = live.bibleId;
  const bibleId2 = live.bibleId2;
  
  let targetBook = live.bookId;
  let targetChapter = live.chapter;
  let targetVerse = live.verse + direction;
  
  if (targetVerse < 1) {
    const prevChapterKey = getCacheKey(bibleId, targetBook, targetChapter - 1);
    const prevChapterCached = chapterCache.get(prevChapterKey);
    
    if (prevChapterCached && targetChapter > 1) {
      targetChapter = targetChapter - 1;
      targetVerse = prevChapterCached.verseCount || Object.keys(prevChapterCached.verses).length;
    } else {
      const info = await ipcRenderer.invoke(IPC.GET_CHAPTER_INFO, bibleId, targetBook, targetChapter);
      if (info.error) return;
      
      const bookOrder = info.bookOrder;
      const bookIndex = bookOrder.indexOf(targetBook);
      
      if (targetChapter > 1) {
        targetChapter = targetChapter - 1;
        const prevChapterInfo = await ipcRenderer.invoke(IPC.GET_CHAPTER_INFO, bibleId, targetBook, targetChapter);
        if (prevChapterInfo.error || !prevChapterInfo.lastVerse) return;
        targetVerse = prevChapterInfo.lastVerse;
      } else if (bookIndex > 0) {
        targetBook = bookOrder[bookIndex - 1];
        const prevBookInfo = await ipcRenderer.invoke(IPC.GET_CHAPTER_INFO, bibleId, targetBook, 1);
        if (prevBookInfo.error) return;
        targetChapter = prevBookInfo.chapterCount;
        const lastChapterInfo = await ipcRenderer.invoke(IPC.GET_CHAPTER_INFO, bibleId, targetBook, targetChapter);
        if (lastChapterInfo.error || !lastChapterInfo.lastVerse) return;
        targetVerse = lastChapterInfo.lastVerse;
      } else {
        return;
      }
    }
  }
  
  let result = await getVerseWithCache(bibleId, targetBook, targetChapter, targetVerse, bibleId2);
  
  if (!result) {
    await fetchAndCacheChapter(bibleId, targetBook, targetChapter);
    if (bibleId2) {
      await fetchAndCacheChapter(bibleId2, targetBook, targetChapter);
    }
    result = await getVerseWithCache(bibleId, targetBook, targetChapter, targetVerse, bibleId2);
  }
  
  if (!result && direction > 0) {
    const cacheKey = getCacheKey(bibleId, targetBook, targetChapter);
    const cachedChapter = chapterCache.get(cacheKey);
    if (cachedChapter) {
      const verseCount = cachedChapter.verseCount || Object.keys(cachedChapter.verses).length;
      if (targetVerse > verseCount) {
        result = { error: 'Verse not found' };
      }
    }
  }
  
  if (!result) {
    result = await ipcRenderer.invoke(IPC.FETCH_SCRIPTURE, { 
      reference: `${targetBook}.${targetChapter}.${targetVerse}`,
      bibleId, 
      bibleId2 
    });
  }
  
  if (result.error && result.error.includes('not found') && direction > 0) {
    const nextChapterKey = getCacheKey(bibleId, targetBook, targetChapter + 1);
    const nextChapterCached = chapterCache.get(nextChapterKey);
    
    if (nextChapterCached && nextChapterCached.verses[1]) {
      targetChapter = targetChapter + 1;
      targetVerse = 1;
      result = await getVerseWithCache(bibleId, targetBook, targetChapter, targetVerse, bibleId2);
    } else {
      const info = await ipcRenderer.invoke(IPC.GET_CHAPTER_INFO, bibleId, targetBook, targetChapter);
      if (!info.error) {
        const bookOrder = info.bookOrder;
        const bookIndex = bookOrder.indexOf(targetBook);
        
        if (targetChapter < info.chapterCount) {
          targetChapter = targetChapter + 1;
          targetVerse = 1;
        } else if (bookIndex < bookOrder.length - 1) {
          targetBook = bookOrder[bookIndex + 1];
          targetChapter = 1;
          targetVerse = 1;
        } else {
          return;
        }
        
        result = await getVerseWithCache(bibleId, targetBook, targetChapter, targetVerse, bibleId2);
        
        if (!result) {
          await fetchAndCacheChapter(bibleId, targetBook, targetChapter);
          if (bibleId2) {
            await fetchAndCacheChapter(bibleId2, targetBook, targetChapter);
          }
          result = await getVerseWithCache(bibleId, targetBook, targetChapter, targetVerse, bibleId2);
        }
        
        if (!result) {
          result = await ipcRenderer.invoke(IPC.FETCH_SCRIPTURE, { 
            reference: `${targetBook}.${targetChapter}.${targetVerse}`,
            bibleId, 
            bibleId2 
          });
        }
      }
    }
  }
  
  if (result.error) return;
  
  live = {
    ...createScripture(
      result.reference, result.text, result.version, result.bibleId,
      result.bookId, result.chapter, result.verse,
      result.compareText, result.compareVersion, result.bibleId2
    ),
    liveBackground: settings.scriptureBackground || '#000000',
    liveBackgroundImage: settings.scriptureBackgroundImage || null,
    liveFontFamily: settings.scriptureFontFamily || 'Georgia',
    liveFontSize: settings.scriptureFontSize || 48,
    liveFontColor: settings.scriptureFontColor || '#FFFFFF'
  };
  
  ipcRenderer.send(IPC.SHOW_SCRIPTURE, {
    reference: live.reference,
    text: live.text,
    version: live.version,
    compareText: live.compareText,
    compareVersion: live.compareVersion,
    background: settings.scriptureBackground || '#000000',
    backgroundImage: settings.scriptureBackgroundImage || null,
    fontFamily: settings.scriptureFontFamily || 'Georgia',
    fontSize: settings.scriptureFontSize || 48,
    fontColor: settings.scriptureFontColor || '#FFFFFF',
    direction: direction
  });
  
  if (isSynced && staged?.type === 'scripture') {
    staged = { ...live };
    updatePreviewDisplay();
  }
  
  prefetchNearbyChapter(bibleId, result.bookId, result.chapter, result.verse, bibleId2);
  
  updateLiveDisplay();
  updateGoLiveButton();
  updateTransportUI();
}

function setupModal() {
  const modal = document.getElementById('libraryModal');
  const closeBtn = document.getElementById('closeModalBtn');
  const cancelBtn = document.getElementById('cancelModalBtn');
  const confirmBtn = document.getElementById('confirmModalBtn');
  const goToLibraryLink = document.getElementById('goToLibraryLink');
  const selectAllBtn = document.getElementById('selectAllModalBtn');
  const deselectAllBtn = document.getElementById('deselectAllModalBtn');
  
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  
  selectAllBtn.addEventListener('click', () => {
    const mediaItems = mediaLibrary.filter(f => f.type === 'image' || f.type === 'video');
    const allItems = [...mediaItems, ...quickSlides];
    const alreadyInQueue = getAlreadyInQueuePaths();
    modalSelectedImages = allItems
      .filter(item => {
        const itemId = item.id || item.path;
        return !alreadyInQueue.includes(itemId);
      })
      .map(item => item.id || item.path);
    renderModalGrid();
    updateModalCount();
  });
  
  deselectAllBtn.addEventListener('click', () => {
    modalSelectedImages = [];
    renderModalGrid();
    updateModalCount();
  });
  
  confirmBtn.addEventListener('click', () => {
    modalSelectedImages.forEach(itemId => {
      let newItem = null;
      
      const libItem = mediaLibrary.find(f => (f.id === itemId) || (f.path === itemId));
      const qsItem = quickSlides.find(s => s.id === itemId);
      
      if (libItem) {
        newItem = {
          id: libItem.id,
          path: getEffectivePath(libItem),
          originalPath: libItem.originalPath || libItem.path,
          displayName: libItem.displayName || libItem.name,
          type: libItem.type
        };
      } else if (qsItem) {
        newItem = { ...qsItem };
      }
      
      if (!newItem) return;
      
      const itemKey = newItem.type === 'quick-slide' ? newItem.id : newItem.path;
      
      if (live?.type === 'slideshow') {
        if (staged?.type === 'slideshow') {
          const inQueue = staged.queue.some(q => (q.type === 'quick-slide' ? q.id : q.path) === itemKey);
          const inPending = staged.pendingAdds.some(q => (q.type === 'quick-slide' ? q.id : q.path) === itemKey);
          if (!inQueue && !inPending) {
            staged.pendingAdds.push(newItem);
          }
        }
      } else {
        if (staged?.type === 'slideshow') {
          const inQueue = staged.queue.some(q => (q.type === 'quick-slide' ? q.id : q.path) === itemKey);
          if (!inQueue) {
            staged.queue.push(newItem);
          }
        } else {
          const queue = getStagedSlideshowQueue();
          const inQueue = queue.some(q => (q.type === 'quick-slide' ? q.id : q.path) === itemKey);
          if (!inQueue) {
            queue.push(newItem);
          }
          staged = createSlideshow(
            currentPreset?.id || null,
            queue,
            0,
            queuedSettings.interval,
            queuedSettings.loop,
            queuedSettings.transition
          );
        }
      }
    });
    
    closeModal();
    renderSlideshowQueue();
    updateQueueButton();
    updateGoLiveButton();
    updateTransportUI();
    updatePreviewDisplay();
  });
  
  goToLibraryLink.addEventListener('click', (e) => {
    e.preventDefault();
    closeModal();
    switchMode('images');
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
}

function getAlreadyInQueuePaths() {
  const ids = [];
  const queue = getStagedSlideshowQueue();
  queue.forEach(q => ids.push(q.type === 'quick-slide' ? q.id : q.path));
  if (staged?.type === 'slideshow') {
    staged.pendingAdds.forEach(q => ids.push(q.type === 'quick-slide' ? q.id : q.path));
  }
  return ids;
}

function openModal() {
  modalSelectedImages = [];
  renderModalGrid();
  updateModalCount();
  document.getElementById('libraryModal').classList.add('active');
}

function closeModal() {
  document.getElementById('libraryModal').classList.remove('active');
  modalSelectedImages = [];
}

function renderModalGrid() {
  const grid = document.getElementById('modalImageGrid');
  const hint = document.getElementById('modalEmptyHint');
  const mediaItems = mediaLibrary.filter(f => f.type === 'image' || f.type === 'video');
  const allItems = [...mediaItems, ...quickSlides];
  grid.innerHTML = '';
  
  if (allItems.length === 0) {
    grid.innerHTML = '<p style="color:#666;text-align:center;grid-column:1/-1;">No media in library yet.</p>';
    hint.style.display = 'block';
    return;
  }
  
  hint.style.display = 'block';
  
  const alreadyInQueue = getAlreadyInQueuePaths();
  
  allItems.forEach(file => {
    const isQuickSlide = file.type === 'quick-slide';
    const itemId = file.id || file.path;
    
    const thumb = document.createElement('div');
    thumb.className = 'modal-thumb';
    thumb.dataset.path = itemId;
    thumb.dataset.type = file.type;
    
    const inQueue = alreadyInQueue.includes(itemId);
    const isSelected = modalSelectedImages.includes(itemId);
    
    if (inQueue) {
      thumb.classList.add('in-queue');
      thumb.title = 'Already in slideshow';
    }
    
    if (isSelected) {
      thumb.classList.add('selected');
    }
    
    if (isQuickSlide) {
      thumb.style.position = 'relative';
      const preview = document.createElement('div');
      preview.className = 'quick-slide-thumbnail';
      if (file.backgroundImage) {
        preview.style.backgroundImage = `url('file:///${file.backgroundImage.replace(/\\/g, '/')}')`;
        preview.style.backgroundSize = 'cover';
      } else {
        preview.style.backgroundColor = file.background || '#000';
      }
      const bodyEl = document.createElement('div');
      bodyEl.className = 'qs-thumb-body';
      bodyEl.style.color = file.fontColor || '#fff';
      bodyEl.textContent = file.body?.substring(0, 30) || '';
      preview.appendChild(bodyEl);
      thumb.appendChild(preview);
      
      const badge = document.createElement('div');
      badge.className = 'quick-slide-badge';
      badge.textContent = file.preset.charAt(0).toUpperCase();
      badge.style.cssText = 'position:absolute;top:4px;right:4px;width:18px;height:18px;background:rgba(0,0,0,0.6);color:#fff;border-radius:50%;font-size:10px;font-weight:bold;display:flex;align-items:center;justify-content:center;';
      thumb.appendChild(badge);
    } else {
      const img = document.createElement('img');
      const effectivePath = getEffectivePath(file);
      if (file.type === 'video') {
        const mediaId = getMediaThumbnailId(file);
        ipcRenderer.invoke(IPC.GET_THUMBNAIL, mediaId).then(thumbnailPath => {
          if (thumbnailPath) {
            img.src = 'file://' + thumbnailPath;
          } else {
            img.style.background = '#333';
          }
        });
        const videoBadge = document.createElement('div');
        videoBadge.className = 'video-badge';
        videoBadge.innerHTML = '▶';
        videoBadge.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:24px;height:24px;background:rgba(0,0,0,0.7);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;';
        thumb.style.position = 'relative';
        thumb.appendChild(videoBadge);
      } else {
        img.src = 'file://' + effectivePath;
      }
      thumb.appendChild(img);
    }
    
    const check = document.createElement('span');
    check.className = 'check-badge';
    check.innerHTML = '✓';
    thumb.appendChild(check);
    
    thumb.addEventListener('click', () => {
      if (inQueue) return;
      
      const idx = modalSelectedImages.indexOf(itemId);
      if (idx >= 0) {
        modalSelectedImages.splice(idx, 1);
        thumb.classList.remove('selected');
      } else {
        modalSelectedImages.push(itemId);
        thumb.classList.add('selected');
      }
      updateModalCount();
    });
    
    grid.appendChild(thumb);
  });
}

function updateModalCount() {
  document.getElementById('modalSelectionCount').textContent = `${modalSelectedImages.length} selected`;
}

ipcRenderer.on(IPC.SETTINGS_UPDATED, (event, newSettings) => {
  settings = newSettings;
  updateSettingsUI();
});

ipcRenderer.on(IPC.DISPLAY_RESOLUTION_CHANGED, (event, resolution) => {
  displayResolution = resolution;
  setPreviewAspectRatio();
  updatePreviewScale();
  updateFormPreviewScale();
  renderImageGrid();
  updatePreviewDisplay();
  updateLiveDisplay();
  updateQsPreview();
});

ipcRenderer.on(IPC.PRESENTATION_VISIBILITY, (event, visible) => {
  presentationVisible = visible;
  updateBlackoutOverlay();
});

ipcRenderer.on(IPC.UPDATE_AVAILABLE, (event, info) => {
  const banner = document.getElementById('updateBanner');
  const message = document.getElementById('updateMessage');
  const updateBtn = document.getElementById('updateBtn');
  const restartBtn = document.getElementById('restartBtn');
  const progress = document.getElementById('updateProgress');
  
  message.textContent = `Version ${info.version} is available!`;
  updateBtn.style.display = '';
  updateBtn.disabled = false;
  restartBtn.style.display = 'none';
  progress.classList.remove('visible');
  banner.classList.add('visible');
  banner.dataset.downloadUrl = info.downloadUrl || '';
});

ipcRenderer.on(IPC.UPDATE_PROGRESS, (event, percent) => {
  const progress = document.getElementById('updateProgress');
  const progressBar = document.getElementById('updateProgressBar');
  const message = document.getElementById('updateMessage');
  
  progress.classList.add('visible');
  progressBar.style.width = percent + '%';
  message.textContent = `Downloading update... ${percent}%`;
});

ipcRenderer.on(IPC.UPDATE_DOWNLOADED, () => {
  const message = document.getElementById('updateMessage');
  const updateBtn = document.getElementById('updateBtn');
  const restartBtn = document.getElementById('restartBtn');
  const progress = document.getElementById('updateProgress');
  
  message.textContent = 'Update ready! Restart to apply.';
  updateBtn.style.display = 'none';
  restartBtn.style.display = '';
  progress.classList.remove('visible');
});

let downloadedUpdatePath = null;

function setupUpdateBanner() {
  const banner = document.getElementById('updateBanner');
  const updateBtn = document.getElementById('updateBtn');
  const restartBtn = document.getElementById('restartBtn');
  const dismiss = document.getElementById('updateDismiss');
  
  updateBtn.addEventListener('click', async () => {
    updateBtn.disabled = true;
    updateBtn.textContent = 'Downloading...';
    const result = await ipcRenderer.invoke(IPC.DOWNLOAD_UPDATE);
    if (result.success) {
      downloadedUpdatePath = result.path;
    } else {
      document.getElementById('updateMessage').textContent = 'Download failed. Try again.';
      updateBtn.disabled = false;
      updateBtn.textContent = 'Update Now';
    }
  });
  
  restartBtn.addEventListener('click', () => {
    if (downloadedUpdatePath) {
      ipcRenderer.send(IPC.INSTALL_UPDATE, downloadedUpdatePath);
    }
  });
  
  dismiss.addEventListener('click', () => {
    banner.classList.remove('visible');
  });
}

function setupBlackoutMode() {
  const livePaneLabel = document.getElementById('livePaneLabel');
  const blackoutOverlay = document.getElementById('blackoutOverlay');
  const restoreBtn = document.getElementById('blackoutRestoreBtn');
  
  livePaneLabel.addEventListener('dblclick', () => {
    if (presentationVisible) {
      ipcRenderer.send(IPC.HIDE_PRESENTATION);
    } else {
      ipcRenderer.send(IPC.SHOW_PRESENTATION);
    }
  });
  
  restoreBtn.addEventListener('click', () => {
    ipcRenderer.send(IPC.SHOW_PRESENTATION);
  });
}

function updateBlackoutOverlay() {
  const blackoutOverlay = document.getElementById('blackoutOverlay');
  blackoutOverlay.classList.toggle('active', !presentationVisible);
}

function setupContextMenu() {
  const menu = document.getElementById('brokenItemMenu');
  const relocateBtn = document.getElementById('relocateItem');
  const removeBtn = document.getElementById('removeItem');
  
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target)) {
      hideContextMenu();
    }
  });
  
  relocateBtn.addEventListener('click', async () => {
    if (!contextMenuTarget) return;
    
    const filters = contextMenuTarget.type === 'video' 
      ? [{ name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv'] }]
      : [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }];
    
    const files = await ipcRenderer.invoke(IPC.PICK_FILE, filters);
    if (files && files.length > 0) {
      const result = await ipcRenderer.invoke(IPC.RELOCATE_LIBRARY_ITEM, contextMenuTarget.path, files[0]);
      if (result.success) {
        brokenPaths.delete(contextMenuTarget.path);
        mediaLibrary = result.mediaLibrary;
        renderImageGrid();
        slideshowPresets = await ipcRenderer.invoke(IPC.GET_SLIDESHOW_PRESETS);
        renderSlideshowQueue();
        updatePresetDropdown();
      }
    }
    hideContextMenu();
  });
  
  removeBtn.addEventListener('click', async () => {
    if (!contextMenuTarget) return;
    
    mediaLibrary = await ipcRenderer.invoke(IPC.REMOVE_FROM_LIBRARY, contextMenuTarget.path);
    brokenPaths.delete(contextMenuTarget.path);
    
    if (selectedImage === contextMenuTarget.path) {
      selectedImage = null;
      staged = null;
      updatePreviewDisplay();
    }
    
    renderImageGrid();
    hideContextMenu();
  });
}

function showBrokenContextMenu(e, file) {
  e.preventDefault();
  e.stopPropagation();
  
  contextMenuTarget = file;
  const menu = document.getElementById('brokenItemMenu');
  
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  menu.classList.add('visible');
}

function hideContextMenu() {
  const menu = document.getElementById('brokenItemMenu');
  menu.classList.remove('visible');
  contextMenuTarget = null;
}

document.addEventListener('DOMContentLoaded', init);
