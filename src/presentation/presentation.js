const { ipcRenderer } = require('electron');
const IPC = require('../shared/ipc-channels');

let currentState = 'standby';
let scalingMode = 'fit';
let transitionMode = 'fade';
let activeSlideLayer = 0;
let activeScriptureLayer = 0;
let activeQuickSlideLayer = 0;
let videoUpdateInterval = null;
let audioUpdateInterval = null;
let countdownInterval = null;
let defaultStandbyPath = null;

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

function getObjectFit(mode) {
  switch (mode) {
    case 'fill': return 'cover';
    case 'stretch': return 'fill';
    default: return 'contain';
  }
}

function getLuminance(hexColor) {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16) / 255;
  const g = parseInt(hex.substr(2, 2), 16) / 255;
  const b = parseInt(hex.substr(4, 2), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function applyScalingMode() {
  const objectFit = getObjectFit(scalingMode);
  document.querySelectorAll('.standby-view img, .image-view img, .video-view video').forEach(el => {
    el.style.objectFit = objectFit;
  });
}

function resetSlideLayers() {
  const layers = [
    document.getElementById('displayImage'),
    document.getElementById('displayImageAlt')
  ];
  layers.forEach(layer => {
    layer.classList.remove('visible', 'transition-fade', 'transition-slide', 'exiting');
    layer.src = '';
  });
  activeSlideLayer = 0;
}

function stopVideo() {
  const video = document.getElementById('displayVideo');
  video.pause();
  video.src = '';
  if (videoUpdateInterval) {
    clearInterval(videoUpdateInterval);
    videoUpdateInterval = null;
  }
}

function stopAudio() {
  const audio = document.getElementById('displayAudio');
  audio.pause();
  audio.src = '';
  if (audioUpdateInterval) {
    clearInterval(audioUpdateInterval);
    audioUpdateInterval = null;
  }
}

function showView(viewName) {
  const views = document.querySelectorAll('.standby-view, .image-view, .video-view, .audio-view, .scripture-view, .quick-slide-view');
  views.forEach(view => {
    view.classList.remove('active');
  });
  
  if (currentState === 'video' && viewName !== 'video') {
    stopVideo();
  }
  
  if (currentState === 'audio' && viewName !== 'audio') {
    stopAudio();
  }
  
  if (currentState === 'quickSlide' && viewName !== 'quickSlide') {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }
  
  const view = document.getElementById(viewName + 'View');
  if (view) {
    view.classList.add('active');
  }
  currentState = viewName;
}

function sendVideoState() {
  const video = document.getElementById('displayVideo');
  ipcRenderer.send(IPC.VIDEO_STATE, {
    playing: !video.paused && !video.ended,
    paused: video.paused,
    ended: video.ended,
    currentTime: video.currentTime,
    duration: video.duration || 0
  });
}

function sendAudioState() {
  const audio = document.getElementById('displayAudio');
  ipcRenderer.send(IPC.AUDIO_STATE, {
    playing: !audio.paused && !audio.ended,
    paused: audio.paused,
    ended: audio.ended,
    currentTime: audio.currentTime,
    duration: audio.duration || 0
  });
}

ipcRenderer.on(IPC.SHOW_STANDBY, (event, imagePath) => {
  const standbyImage = document.getElementById('standbyImage');
  if (imagePath) {
    standbyImage.src = 'file://' + imagePath;
  } else {
    standbyImage.src = '';
  }
  resetSlideLayers();
  showView('standby');
});

ipcRenderer.on(IPC.SHOW_IMAGE, (event, imagePath) => {
  const layers = [
    document.getElementById('displayImage'),
    document.getElementById('displayImageAlt')
  ];
  
  const currentLayer = layers[activeSlideLayer];
  const nextLayer = layers[1 - activeSlideLayer];
  
  const doTransition = () => {
    layers.forEach(layer => {
      layer.classList.remove('transition-fade', 'transition-slide', 'exiting');
    });
    
    if (transitionMode !== 'none') {
      currentLayer.classList.add(`transition-${transitionMode}`);
      nextLayer.classList.add(`transition-${transitionMode}`);
      
      if (transitionMode === 'slide') {
        currentLayer.classList.add('exiting');
      }
    }
    
    currentLayer.classList.remove('visible');
    nextLayer.classList.add('visible');
    
    activeSlideLayer = 1 - activeSlideLayer;
  };
  
  nextLayer.onload = doTransition;
  nextLayer.src = 'file://' + imagePath;
  
  showView('image');
});

ipcRenderer.on(IPC.SHOW_VIDEO, (event, videoPath, startTime) => {
  const video = document.getElementById('displayVideo');
  
  video.src = 'file://' + videoPath;
  video.currentTime = startTime || 0;
  
  video.onloadedmetadata = () => {
    if (startTime) {
      video.currentTime = startTime;
    }
    video.play();
    sendVideoState();
  };
  
  video.onplay = sendVideoState;
  video.onpause = sendVideoState;
  video.onended = () => {
    sendVideoState();
  };
  video.ontimeupdate = () => {
    if (!videoUpdateInterval) {
      videoUpdateInterval = setInterval(sendVideoState, 250);
    }
  };
  
  showView('video');
});

ipcRenderer.on(IPC.CONTROL_VIDEO, (event, command, value) => {
  const video = document.getElementById('displayVideo');
  
  switch (command) {
    case 'play':
      video.play();
      break;
    case 'pause':
      video.pause();
      break;
    case 'stop':
      const stoppedPath = video.src.replace('file://', '');
      video.pause();
      video.currentTime = 0;
      ipcRenderer.send(IPC.VIDEO_STATE, { stopped: true, path: stoppedPath });
      break;
    case 'restart':
      video.currentTime = 0;
      video.play();
      break;
    case 'seek':
      video.currentTime = value;
      sendVideoState();
      break;
  }
});

ipcRenderer.on(IPC.PLAY_AUDIO, (event, audioPath, startTime) => {
  const audio = document.getElementById('displayAudio');
  const trackName = document.getElementById('audioTrackName');
  
  const fileName = audioPath.split(/[\\/]/).pop().replace(/\.[^/.]+$/, '');
  trackName.textContent = fileName;
  
  audio.src = 'file://' + audioPath;
  audio.currentTime = startTime || 0;
  
  audio.onloadedmetadata = () => {
    if (startTime) {
      audio.currentTime = startTime;
    }
    audio.play();
    sendAudioState();
  };
  
  audio.onplay = sendAudioState;
  audio.onpause = sendAudioState;
  audio.onended = sendAudioState;
  audio.ontimeupdate = () => {
    if (!audioUpdateInterval) {
      audioUpdateInterval = setInterval(sendAudioState, 250);
    }
  };
  
  showView('audio');
});

ipcRenderer.on(IPC.CONTROL_AUDIO, (event, command, value) => {
  const audio = document.getElementById('displayAudio');
  
  switch (command) {
    case 'play':
      audio.play();
      break;
    case 'pause':
      audio.pause();
      break;
    case 'stop':
      const stoppedPath = audio.src.replace('file://', '');
      audio.pause();
      audio.currentTime = 0;
      ipcRenderer.send(IPC.AUDIO_STATE, { stopped: true, path: stoppedPath });
      break;
    case 'restart':
      audio.currentTime = 0;
      audio.play();
      break;
    case 'seek':
      audio.currentTime = value;
      sendAudioState();
      break;
  }
});

ipcRenderer.on(IPC.SHOW_SCRIPTURE, (event, scripture) => {
  const scriptureView = document.getElementById('scriptureView');
  const layers = [
    document.getElementById('scriptureLayer0'),
    document.getElementById('scriptureLayer1')
  ];
  
  const currentLayer = layers[activeScriptureLayer];
  const nextLayer = layers[1 - activeScriptureLayer];
  
  const nextText = nextLayer.querySelector('.scripture-content .scripture-text');
  const nextRef = nextLayer.querySelector('.scripture-content .scripture-reference');
  const nextCompare = nextLayer.querySelector('.scripture-compare');
  const nextText2 = nextLayer.querySelector('.scripture-compare .scripture-text');
  const nextRef2 = nextLayer.querySelector('.scripture-compare .scripture-reference');
  
  nextText.textContent = scripture.text;
  nextRef.textContent = `${scripture.reference} (${scripture.version})`;
  
  if (scripture.compareText) {
    nextText2.textContent = scripture.compareText;
    nextRef2.textContent = `${scripture.reference} (${scripture.compareVersion})`;
    nextCompare.classList.add('visible');
  } else {
    nextText2.textContent = '';
    nextRef2.textContent = '';
    nextCompare.classList.remove('visible');
  }
  
  const bg = scripture.background || '#000000';
  const bgImage = scripture.backgroundImage ? scripture.backgroundImage.replace(/\\/g, '/') : null;
  const fontFamily = scripture.fontFamily || 'Georgia';
  const fontSize = scripture.fontSize || 48;
  const fontColor = scripture.fontColor || '#FFFFFF';
  
  if (bgImage) {
    scriptureView.style.backgroundImage = `url('file:///${bgImage}')`;
    scriptureView.style.backgroundSize = 'cover';
    scriptureView.style.backgroundPosition = 'center';
    scriptureView.style.backgroundColor = 'transparent';
  } else {
    scriptureView.style.backgroundImage = 'none';
    scriptureView.style.backgroundColor = bg;
  }
  
  const wrappers = nextLayer.querySelectorAll('.scripture-text-wrapper');
  
  if (bgImage) {
    const luminance = getLuminance(fontColor);
    const isLightBackdrop = luminance <= 0.5;
    
    wrappers.forEach(wrapper => {
      wrapper.classList.add('scripture-backdrop');
      if (isLightBackdrop) {
        wrapper.classList.add('light');
      } else {
        wrapper.classList.remove('light');
      }
    });
  } else {
    wrappers.forEach(wrapper => {
      wrapper.classList.remove('scripture-backdrop', 'light');
    });
  }
  
  const nextTexts = nextLayer.querySelectorAll('.scripture-text');
  const nextRefs = nextLayer.querySelectorAll('.scripture-reference');
  
  nextTexts.forEach(el => {
    el.style.fontFamily = fontFamily + ', serif';
    el.style.fontSize = fontSize + 'px';
    el.style.color = fontColor;
  });
  
  nextRefs.forEach(el => {
    el.style.fontFamily = fontFamily + ', serif';
    el.style.fontSize = Math.round(fontSize * 0.5) + 'px';
    el.style.color = fontColor;
    el.style.opacity = '0.7';
  });
  
  const direction = scripture.direction || 0;
  
  if (currentState === 'scripture') {
    nextLayer.style.transition = 'none';
    nextLayer.classList.remove('visible', 'offscreen-left', 'offscreen-right');
    nextLayer.classList.add(direction < 0 ? 'offscreen-left' : 'offscreen-right');
    
    void nextLayer.offsetHeight;
    
    nextLayer.style.transition = '';
    
    currentLayer.classList.remove('visible');
    currentLayer.classList.add(direction < 0 ? 'offscreen-right' : 'offscreen-left');
    
    nextLayer.classList.remove('offscreen-left', 'offscreen-right');
    nextLayer.classList.add('visible');
    activeScriptureLayer = 1 - activeScriptureLayer;
  } else {
    layers.forEach(l => {
      l.style.transition = 'none';
      l.classList.remove('visible', 'offscreen-left', 'offscreen-right');
    });
    nextLayer.classList.add('offscreen-right');
    void nextLayer.offsetHeight;
    nextLayer.style.transition = '';
    nextLayer.classList.remove('offscreen-right');
    nextLayer.classList.add('visible');
    activeScriptureLayer = 1 - activeScriptureLayer;
  }
  
  showView('scripture');
});

ipcRenderer.on(IPC.SHOW_QUICK_SLIDE, (event, slide) => {
  const quickSlideView = document.getElementById('quickSlideView');
  const layers = [
    document.getElementById('quickSlideLayer0'),
    document.getElementById('quickSlideLayer1')
  ];

  const currentLayer = layers[activeQuickSlideLayer];
  const nextLayer = layers[1 - activeQuickSlideLayer];

  const nextTitle = nextLayer.querySelector('.quick-slide-title');
  const nextBody = nextLayer.querySelector('.quick-slide-body');
  const nextCustom = nextLayer.querySelector('.quick-slide-custom');

  const bg = slide.background || '#000000';
  const bgImage = slide.backgroundImage ? slide.backgroundImage.replace(/\\/g, '/') : null;
  const fontFamily = slide.fontFamily || 'Georgia';
  const titleFontSize = slide.titleFontSize || 60;
  const fontSize = slide.fontSize || 48;
  const fontColor = slide.fontColor || '#FFFFFF';
  const backgroundDim = slide.backgroundDim !== undefined ? slide.backgroundDim : 0;

  if (bgImage) {
    quickSlideView.style.backgroundImage = `url('file:///${bgImage}')`;
    quickSlideView.style.backgroundSize = 'cover';
    quickSlideView.style.backgroundPosition = 'center';
    quickSlideView.style.backgroundColor = 'transparent';
  } else {
    quickSlideView.style.backgroundImage = 'none';
    quickSlideView.style.backgroundColor = bg;
  }

  quickSlideView.style.setProperty('--dim-opacity', backgroundDim / 100);

  if (slide.preset === 'custom' && slide.elements) {
    nextTitle.style.display = 'none';
    nextBody.style.display = 'none';
    nextCustom.classList.add('active');
    nextLayer.style.justifyContent = '';
    nextLayer.style.alignItems = '';
    nextLayer.style.textAlign = '';
    
    nextCustom.innerHTML = '';
    
    slide.elements.forEach(el => {
      const div = document.createElement('div');
      div.className = `quick-slide-custom-el v-${el.verticalAlign} h-${el.horizontalAlign} w-${el.textWidth}`;
      if (el.type === 'title') div.classList.add('el-title');
      div.style.fontFamily = fontFamily + ', serif';
      div.style.fontSize = (el.type === 'title' ? titleFontSize : fontSize) + 'px';
      div.style.color = el.fontColor || fontColor;
      const ox = el.offsetX || 0;
      const oy = el.offsetY || 0;
      const baseX = el.horizontalAlign === 'center' ? -50 : 0;
      const baseY = el.verticalAlign === 'center' ? -50 : 0;
      div.style.transform = `translate(calc(${baseX}% + ${ox}%), calc(${baseY}% + ${oy}%))`;
      div.innerHTML = el.type === 'title' ? escapeHtml(el.text) : parseBodyForLists(el.text);
      nextCustom.appendChild(div);
    });
  } else if (slide.preset === 'countdown') {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    
    nextTitle.style.display = 'none';
    nextBody.style.display = 'none';
    nextCustom.classList.add('active');
    nextCustom.innerHTML = '';
    
    nextLayer.style.justifyContent = 'center';
    nextLayer.style.alignItems = 'center';
    nextLayer.style.textAlign = 'center';
    
    if (slide.countdownLabel) {
      const labelDiv = document.createElement('div');
      labelDiv.className = 'countdown-label';
      labelDiv.style.fontFamily = fontFamily + ', serif';
      labelDiv.style.fontSize = fontSize + 'px';
      labelDiv.style.color = fontColor;
      labelDiv.textContent = slide.countdownLabel;
      nextCustom.appendChild(labelDiv);
    }
    
    const timerDiv = document.createElement('div');
    timerDiv.className = 'countdown-timer';
    timerDiv.style.fontFamily = fontFamily + ', serif';
    timerDiv.style.fontSize = (titleFontSize * 1.5) + 'px';
    timerDiv.style.color = fontColor;
    nextCustom.appendChild(timerDiv);
    
    const updateCountdown = () => {
      const now = Date.now();
      const remaining = Math.max(0, (slide.endTime || now) - now);
      const totalSec = Math.floor(remaining / 1000);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      timerDiv.textContent = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
      
      if (remaining <= 0 && countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
    };
    
    updateCountdown();
    countdownInterval = setInterval(updateCountdown, 1000);
  } else {
    nextTitle.style.display = '';
    nextBody.style.display = '';
    nextCustom.classList.remove('active');
    nextCustom.innerHTML = '';
    
    const showTitle = slide.preset === 'announcement' || slide.preset === 'prayer';
    nextTitle.textContent = showTitle ? (slide.title || '') : '';
    nextTitle.style.display = showTitle && slide.title ? '' : 'none';
    nextBody.innerHTML = parseBodyForLists(slide.body || '');

    const verticalAlign = slide.verticalAlign || 'center';
    const horizontalAlign = slide.horizontalAlign || 'center';
    const textWidth = slide.textWidth || 'wide';

    const vAlignMap = { top: 'flex-start', center: 'center', bottom: 'flex-end' };
    const hAlignMap = { left: 'flex-start', center: 'center', right: 'flex-end' };
    const textAlignMap = { left: 'left', center: 'center', right: 'right' };
    const widthMap = { wide: '90%', medium: '70%', narrow: '50%' };

    nextLayer.style.justifyContent = vAlignMap[verticalAlign] || 'center';
    nextLayer.style.alignItems = hAlignMap[horizontalAlign] || 'center';
    nextLayer.style.textAlign = textAlignMap[horizontalAlign] || 'center';

    const maxWidth = widthMap[textWidth] || '90%';
    nextTitle.style.maxWidth = maxWidth;
    nextBody.style.maxWidth = maxWidth;

    nextTitle.style.fontFamily = fontFamily + ', serif';
    nextTitle.style.fontSize = titleFontSize + 'px';
    nextTitle.style.color = fontColor;

    nextBody.style.fontFamily = fontFamily + ', serif';
    nextBody.style.fontSize = fontSize + 'px';
    nextBody.style.color = fontColor;
  }

  if (currentState === 'quickSlide') {
    currentLayer.classList.remove('visible');
    nextLayer.classList.add('visible');
    activeQuickSlideLayer = 1 - activeQuickSlideLayer;
  } else {
    layers.forEach(l => l.classList.remove('visible'));
    nextLayer.classList.add('visible');
    activeQuickSlideLayer = 1 - activeQuickSlideLayer;
  }

  showView('quickSlide');
});

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

ipcRenderer.on(IPC.SETTINGS_UPDATED, (event, settings) => {
  if (settings.scalingMode && settings.scalingMode !== scalingMode) {
    scalingMode = settings.scalingMode;
    applyScalingMode();
  }
  
  if (currentState === 'standby') {
    const standbyImage = document.getElementById('standbyImage');
    if (settings.standbyImage) {
      standbyImage.src = 'file://' + settings.standbyImage;
    } else {
      standbyImage.src = '';
    }
  }
});

ipcRenderer.on(IPC.SET_TRANSITION, (event, transition) => {
  transitionMode = transition;
});

async function init() {
  const settings = await ipcRenderer.invoke(IPC.GET_SETTINGS);
  defaultStandbyPath = await ipcRenderer.invoke(IPC.GET_DEFAULT_STANDBY);
  scalingMode = settings.scalingMode || 'fit';
  applyScalingMode();
  
  const standbyImage = document.getElementById('standbyImage');
  standbyImage.onerror = () => {
    if (defaultStandbyPath) {
      standbyImage.src = 'file://' + defaultStandbyPath;
    }
  };
  
  if (settings.standbyImage) {
    standbyImage.src = 'file://' + settings.standbyImage;
  } else if (defaultStandbyPath) {
    standbyImage.src = 'file://' + defaultStandbyPath;
  }
}

document.addEventListener('DOMContentLoaded', init);
