const { ipcRenderer } = require('electron');
const IPC = require('../shared/ipc-channels');

let currentState = 'standby';
let scalingMode = 'fit';
let transitionMode = 'fade';
let activeSlideLayer = 0;
let videoUpdateInterval = null;

function getObjectFit(mode) {
  switch (mode) {
    case 'fill': return 'cover';
    case 'stretch': return 'fill';
    default: return 'contain';
  }
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

function showView(viewName) {
  const views = document.querySelectorAll('.standby-view, .image-view, .video-view');
  views.forEach(view => {
    view.classList.remove('active');
  });
  
  if (currentState === 'video' && viewName !== 'video') {
    stopVideo();
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
  scalingMode = settings.scalingMode || 'fit';
  applyScalingMode();
  if (settings.standbyImage) {
    document.getElementById('standbyImage').src = 'file://' + settings.standbyImage;
  }
}

document.addEventListener('DOMContentLoaded', init);
