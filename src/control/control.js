const { ipcRenderer } = require('electron');
const path = require('path');
const IPC = require('../shared/ipc-channels');

let settings = {};
let currentMode = 'images';
let currentFilter = 'all';
let displays = [];
let mediaLibrary = [];
let selectedImage = null;
let displayResolution = { width: 1920, height: 1080 };

let slideshowPresets = [];
let currentPreset = null;
let modalSelectedImages = [];

let staged = null;
let live = null;
let isSynced = false;

let previewVideo = null;
let liveVideoState = null;

let queuedSettings = {
  interval: 7000,
  loop: true,
  transition: 'fade'
};

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

async function init() {
  settings = await ipcRenderer.invoke(IPC.GET_SETTINGS);
  displays = await ipcRenderer.invoke(IPC.GET_DISPLAYS);
  mediaLibrary = await ipcRenderer.invoke(IPC.GET_MEDIA_LIBRARY);
  displayResolution = await ipcRenderer.invoke(IPC.GET_DISPLAY_RESOLUTION);
  slideshowPresets = await ipcRenderer.invoke(IPC.GET_SLIDESHOW_PRESETS);
  
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
  setupModal();
  renderImageGrid();
  updateLiveDisplay();
  loadActivePreset();
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
    ipcRenderer.send(IPC.SHOW_STANDBY);
    live = createStandby();
    staged = null;
    isSynced = false;
    updatePreviewDisplay();
    updateLiveDisplay();
    updateGoLiveButton();
    updateVideoTransportUI();
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
}

function updateSettingsUI() {
  const standbyInput = document.getElementById('standbyImagePath');
  if (settings.standbyImage) {
    standbyInput.value = path.basename(settings.standbyImage);
  } else {
    standbyInput.value = '';
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

function getLiveImagePath() {
  if (!live || live.type === 'standby') return null;
  if (live.type === 'single-image') return live.path;
  if (live.type === 'single-video') return null;
  if (live.type === 'slideshow' && live.queue.length > 0) {
    const item = live.queue[live.index];
    if (item?.type === 'video') return null;
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

function getMediaName(content) {
  if (!content) return '';
  
  if (content.type === 'standby') return '';
  
  if (content.type === 'single-image' || content.type === 'single-video') {
    const libItem = mediaLibrary.find(f => f.path === content.path);
    if (libItem) {
      return libItem.displayName || libItem.name.replace(/\.[^/.]+$/, '');
    }
    return content.displayName || path.basename(content.path).replace(/\.[^/.]+$/, '');
  }
  
  if (content.type === 'slideshow') {
    const preset = slideshowPresets.find(p => p.id === content.id);
    return preset?.name || 'Slideshow';
  }
  
  return '';
}

function updatePreviewDisplay() {
  const previewEl = document.getElementById('previewContent');
  const clearBtn = document.getElementById('clearPreviewBtn');
  const mediaNameEl = document.getElementById('previewMediaName');
  
  const imagePath = getStagedImagePath();
  const videoPath = getStagedVideoPath();
  
  if (!staged || staged.type === 'standby') {
    previewEl.innerHTML = '<span class="display-placeholder">Select content to preview</span>';
    clearBtn.classList.remove('visible');
    mediaNameEl.textContent = '';
    cleanupPreviewVideo();
    updateVideoTransportUI();
    return;
  }
  
  if (videoPath) {
    previewEl.innerHTML = `<video id="previewVideoEl" src="file://${videoPath}" muted></video><span class="muted-indicator" title="Preview is muted">🔇</span>`;
    previewVideo = document.getElementById('previewVideoEl');
    previewVideo.currentTime = staged.currentTime || 0;
    setupPreviewVideoEvents();
  } else if (imagePath) {
    previewEl.innerHTML = `<img src="file://${imagePath}" alt="Preview">`;
    cleanupPreviewVideo();
  }
  
  mediaNameEl.textContent = getMediaName(staged);
  clearBtn.classList.add('visible');
  updateVideoTransportUI();
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
  
  if (staged.type === 'slideshow') {
    if (isSynced) return false;
    return true;
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
    return;
  }
  
  const imagePath = getLiveImagePath();
  const videoPath = getLiveVideoPath();
  
  if (videoPath) {
    liveEl.innerHTML = `<img src="" alt="Live Video" style="display:none"><span class="display-placeholder">▶ Video Playing</span>`;
  } else if (imagePath) {
    liveEl.innerHTML = `<img src="file://${imagePath}" alt="Live">`;
  }
  
  mediaNameEl.textContent = getMediaName(live);
  updateVideoTransportUI();
}

function setupDisplayControls() {
  const goLiveBtn = document.getElementById('goLiveBtn');
  const clearBtn = document.getElementById('clearPreviewBtn');
  
  goLiveBtn.addEventListener('click', () => {
    if (!staged) {
      stopLiveSlideshowTimer();
      stopLiveVideo();
      ipcRenderer.send(IPC.SHOW_STANDBY);
      live = createStandby();
      updateLiveDisplay();
      updateGoLiveButton();
      return;
    }
    
    if (staged.type === 'single-image') {
      stopLiveSlideshowTimer();
      stopLiveVideo();
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
      const startTime = staged.currentTime || 0;
      ipcRenderer.send(IPC.SHOW_VIDEO, staged.path, startTime);
      live = { ...staged };
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
        mediaLibrary = await ipcRenderer.invoke(IPC.ADD_TO_LIBRARY, mediaFiles);
        await generateMissingThumbnails(mediaFiles.filter(f => f.type === 'video'));
        renderImageGrid();
      }
    }
  });

  addFilesBtn.addEventListener('click', async () => {
    const filePaths = await ipcRenderer.invoke(IPC.PICK_FILE, [
      { name: 'Media', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'webm', 'mov', 'avi', 'mkv'] }
    ]);
    if (filePaths.length > 0) {
      const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
      const files = filePaths.map(p => ({
        path: p,
        name: path.basename(p),
        type: imageExts.includes(path.extname(p).toLowerCase()) ? 'image' : 'video'
      }));
      mediaLibrary = await ipcRenderer.invoke(IPC.ADD_TO_LIBRARY, files);
      await generateMissingThumbnails(files.filter(f => f.type === 'video'));
      renderImageGrid();
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
    const existing = await ipcRenderer.invoke(IPC.GET_THUMBNAIL, file.path);
    if (!existing) {
      await generateVideoThumbnail(file.path);
    }
  }
}

function generateVideoThumbnail(videoPath) {
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
      await ipcRenderer.invoke(IPC.SAVE_THUMBNAIL, videoPath, dataUrl);
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
  let items = mediaLibrary;
  
  if (currentFilter === 'image') {
    items = mediaLibrary.filter(f => f.type === 'image');
  } else if (currentFilter === 'video') {
    items = mediaLibrary.filter(f => f.type === 'video');
  }

  grid.innerHTML = '';

  if (items.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'empty-library';
    const filterText = currentFilter === 'all' ? 'media' : currentFilter + 's';
    emptyDiv.innerHTML = `<p>No ${filterText} in library</p><p class="hint">Add a folder or individual files to get started</p>`;
    grid.appendChild(emptyDiv);
    return;
  }

  items.forEach(file => {
    const item = document.createElement('div');
    item.className = 'thumbnail-item';
    item.dataset.path = file.path;
    item.dataset.type = file.type;

    const imgContainer = document.createElement('div');
    imgContainer.className = 'thumbnail-image';

    if (file.type === 'video') {
      renderVideoThumbnail(file, imgContainer);
    } else {
      const img = document.createElement('img');
      img.src = 'file://' + file.path;
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

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.innerHTML = '×';
    removeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      mediaLibrary = await ipcRenderer.invoke(IPC.REMOVE_FROM_LIBRARY, file.path);
      if (selectedImage === file.path) {
        selectedImage = null;
        staged = null;
        updatePreviewDisplay();
      }
      renderImageGrid();
    });

    imgContainer.appendChild(removeBtn);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'thumbnail-name';
    nameInput.value = file.displayName || file.name.replace(/\.[^/.]+$/, '');
    nameInput.addEventListener('click', (e) => e.stopPropagation());
    nameInput.addEventListener('change', async (e) => {
      const newName = e.target.value.trim();
      if (newName) {
        await ipcRenderer.invoke(IPC.UPDATE_LIBRARY_ITEM, file.path, { displayName: newName });
        file.displayName = newName;
      }
    });

    item.appendChild(imgContainer);
    item.appendChild(nameInput);
    imgContainer.addEventListener('click', () => selectMedia(file));
    grid.appendChild(item);
  });
}

async function renderVideoThumbnail(file, container) {
  const thumbnailPath = await ipcRenderer.invoke(IPC.GET_THUMBNAIL, file.path);
  const img = document.createElement('img');
  if (thumbnailPath) {
    img.src = 'file://' + thumbnailPath;
  } else {
    img.src = '';
    img.style.background = '#333';
  }
  img.alt = file.displayName || file.name;
  container.appendChild(img);
  
  const videoBadge = document.createElement('div');
  videoBadge.className = 'video-badge';
  videoBadge.innerHTML = '▶';
  container.appendChild(videoBadge);
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
  selectedImage = file.path;
  document.querySelectorAll('.thumbnail-item').forEach(item => {
    item.classList.toggle('selected', item.dataset.path === file.path);
  });
  
  const displayName = file.displayName || path.basename(file.path).replace(/\.[^/.]+$/, '');
  
  if (file.type === 'video') {
    staged = createSingleVideo(file.path, displayName);
  } else {
    staged = createSingleImage(file.path, displayName);
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

  presetSelect.addEventListener('change', () => {
    const presetId = presetSelect.value;
    if (presetId) {
      currentPreset = slideshowPresets.find(p => p.id === presetId);
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
  const nextBtn = document.getElementById('stagedNextBtn');
  
  prevBtn.addEventListener('click', () => {
    if (staged?.type !== 'slideshow') return;
    staged.index--;
    if (staged.index < 0) {
      staged.index = staged.queue.length - 1;
    }
    isSynced = false;
    updatePreviewDisplay();
    renderSlideshowQueue();
    updateTransportUI();
    updateGoLiveButton();
  });
  
  nextBtn.addEventListener('click', () => {
    if (staged?.type !== 'slideshow') return;
    staged.index++;
    if (staged.index >= staged.queue.length) {
      staged.index = 0;
    }
    isSynced = false;
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
  });
  
  livePlayBtn.addEventListener('click', () => {
    if (live?.type !== 'single-video') return;
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
    if (live?.type !== 'single-video') return;
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
    if (live?.type !== 'single-video' || !liveVideoState?.duration) return;
    const time = (liveSlider.value / 100) * liveVideoState.duration;
    ipcRenderer.send(IPC.CONTROL_VIDEO, 'seek', time);
    liveSlider.style.setProperty('--progress', liveSlider.value + '%');
    if (isSynced && staged?.type === 'single-video' && previewVideo) {
      previewVideo.currentTime = time;
      staged.currentTime = time;
    }
  });
  
  ipcRenderer.on(IPC.VIDEO_STATE, (event, state) => {
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
    
    if (state.ended && live?.type === 'slideshow' && live.waitingForVideo) {
      live.waitingForVideo = false;
      advanceLiveSlide();
      return;
    }
    
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

function cleanupPreviewVideo() {
  if (previewVideo) {
    previewVideo.pause();
    previewVideo.src = '';
    previewVideo = null;
  }
}

function stopLiveVideo() {
  if (live?.type === 'single-video') {
    ipcRenderer.send(IPC.CONTROL_VIDEO, 'stop');
  }
  liveVideoState = null;
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

function updateVideoTransportUI() {
  const previewTransport = document.getElementById('previewVideoTransport');
  const liveTransport = document.getElementById('liveVideoTransport');
  
  const showPreviewVideo = staged?.type === 'single-video';
  const showLiveVideo = live?.type === 'single-video';
  
  previewTransport.classList.toggle('visible', showPreviewVideo);
  liveTransport.classList.toggle('visible', showLiveVideo);
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
    if (!staged.queue.some(q => q.path === img.path)) {
      staged.queue.push(img);
    }
  });
  
  staged.pendingRemoves.forEach(imgPath => {
    const idx = staged.queue.findIndex(q => q.path === imgPath);
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

function showCurrentLiveSlide() {
  if (live?.type !== 'slideshow' || live.queue.length === 0) return;
  
  const currentItem = live.queue[live.index];
  
  if (currentItem.type === 'video') {
    if (live.timer) {
      clearInterval(live.timer);
      live.timer = null;
    }
    ipcRenderer.send(IPC.SHOW_VIDEO, currentItem.path, 0);
    live.waitingForVideo = true;
  } else {
    ipcRenderer.send(IPC.SHOW_IMAGE, currentItem.path);
    live.waitingForVideo = false;
    if (!live.paused && !live.timer) {
      startLiveTimer();
    }
  }
  
  if (isSynced && staged?.type === 'slideshow') {
    updatePreviewDisplay();
  }
  
  updateLiveDisplay();
  updateTransportUI();
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

function advanceLiveSlide() {
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
  
  showCurrentLiveSlide();
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
  updateTransportUI();
}

function resumeLiveSlideshow() {
  if (live?.type !== 'slideshow') return;
  live.paused = false;
  startLiveTimer();
  updateTransportUI();
}

function stopLiveSlideshow() {
  stopLiveSlideshowTimer();
  
  ipcRenderer.send(IPC.SHOW_STANDBY);
  live = createStandby();
  
  if (isSynced) {
    staged = null;
  }
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

function updatePresetDropdown() {
  const select = document.getElementById('presetSelect');
  select.innerHTML = '<option value="">-- New Slideshow --</option>';
  slideshowPresets.forEach(preset => {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.name;
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
  
  const stagedIndex = staged?.type === 'slideshow' ? staged.index : -1;
  const liveIndex = live?.type === 'slideshow' ? live.index : -1;
  
  const isStagedIndex = isStagedSlideshow && index === stagedIndex;
  const isLiveIndex = isLiveSlideshow && live.queue[liveIndex]?.path === img.path;
  
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
  
  item.draggable = !isLiveSlideshow && !isPendingAdd && !isPendingRemove;
  item.dataset.index = index;
  item.dataset.path = img.path;
  
  const thumb = document.createElement('img');
  thumb.className = 'queue-thumb';
  
  if (img.type === 'video') {
    ipcRenderer.invoke(IPC.GET_THUMBNAIL, img.path).then(thumbnailPath => {
      if (thumbnailPath) {
        thumb.src = 'file://' + thumbnailPath;
      } else {
        thumb.style.background = '#333';
      }
    });
    const videoBadge = document.createElement('div');
    videoBadge.className = 'video-badge';
    videoBadge.innerHTML = '▶';
    item.appendChild(videoBadge);
  } else {
    thumb.src = 'file://' + img.path;
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
    handleQueueItemRemove(img.path, isPendingAdd);
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

function handleQueueItemRemove(imgPath, isPendingAdd) {
  if (isPendingAdd) {
    if (staged?.type === 'slideshow') {
      const idx = staged.pendingAdds.findIndex(img => img.path === imgPath);
      if (idx >= 0) {
        staged.pendingAdds.splice(idx, 1);
        updateQueueButton();
      }
    }
  } else if (live?.type === 'slideshow') {
    if (staged?.type === 'slideshow' && !staged.pendingRemoves.includes(imgPath)) {
      staged.pendingRemoves.push(imgPath);
      updateQueueButton();
    }
  } else {
    if (staged?.type === 'slideshow') {
      const idx = staged.queue.findIndex(q => q.path === imgPath);
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
    livePauseBtn.textContent = live.paused ? '▶️' : '⏸️';
    livePauseBtn.title = live.paused ? 'Resume' : 'Pause';
  } else {
    liveTransport.classList.remove('visible');
    liveBanner.classList.remove('visible');
    liveControls.classList.remove('visible');
  }
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
    const alreadyInQueue = getAlreadyInQueuePaths();
    modalSelectedImages = mediaItems
      .filter(item => !alreadyInQueue.includes(item.path))
      .map(item => item.path);
    renderModalGrid();
    updateModalCount();
  });
  
  deselectAllBtn.addEventListener('click', () => {
    modalSelectedImages = [];
    renderModalGrid();
    updateModalCount();
  });
  
  confirmBtn.addEventListener('click', () => {
    modalSelectedImages.forEach(imgPath => {
      const libItem = mediaLibrary.find(f => f.path === imgPath);
      if (libItem) {
        const newItem = {
          path: libItem.path,
          displayName: libItem.displayName || libItem.name,
          type: libItem.type
        };
        
        if (live?.type === 'slideshow') {
          if (staged?.type === 'slideshow') {
            if (!staged.queue.some(q => q.path === imgPath) &&
                !staged.pendingAdds.some(q => q.path === imgPath)) {
              staged.pendingAdds.push(newItem);
            }
          }
        } else {
          if (staged?.type === 'slideshow') {
            if (!staged.queue.some(q => q.path === imgPath)) {
              staged.queue.push(newItem);
            }
          } else {
            const queue = getStagedSlideshowQueue();
            if (!queue.some(q => q.path === imgPath)) {
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
  const paths = [];
  const queue = getStagedSlideshowQueue();
  queue.forEach(q => paths.push(q.path));
  if (staged?.type === 'slideshow') {
    staged.pendingAdds.forEach(q => paths.push(q.path));
  }
  return paths;
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
  grid.innerHTML = '';
  
  if (mediaItems.length === 0) {
    grid.innerHTML = '<p style="color:#666;text-align:center;grid-column:1/-1;">No media in library yet.</p>';
    hint.style.display = 'block';
    return;
  }
  
  hint.style.display = 'block';
  
  const alreadyInQueue = getAlreadyInQueuePaths();
  
  mediaItems.forEach(file => {
    const thumb = document.createElement('div');
    thumb.className = 'modal-thumb';
    thumb.dataset.path = file.path;
    
    const inQueue = alreadyInQueue.includes(file.path);
    const isSelected = modalSelectedImages.includes(file.path);
    
    if (inQueue) {
      thumb.classList.add('in-queue');
      thumb.title = 'Already in slideshow';
    }
    
    if (isSelected) {
      thumb.classList.add('selected');
    }
    
    const img = document.createElement('img');
    if (file.type === 'video') {
      ipcRenderer.invoke(IPC.GET_THUMBNAIL, file.path).then(thumbnailPath => {
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
      img.src = 'file://' + file.path;
    }
    
    const check = document.createElement('span');
    check.className = 'check-badge';
    check.innerHTML = '✓';
    
    thumb.appendChild(img);
    thumb.appendChild(check);
    
    thumb.addEventListener('click', () => {
      if (inQueue) return;
      
      const idx = modalSelectedImages.indexOf(file.path);
      if (idx >= 0) {
        modalSelectedImages.splice(idx, 1);
        thumb.classList.remove('selected');
      } else {
        modalSelectedImages.push(file.path);
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
  renderImageGrid();
});

document.addEventListener('DOMContentLoaded', init);
