const { ipcRenderer } = require('electron');
const img = document.getElementById('display');

ipcRenderer.on('manual-image-display', (_event, imagePath) => {
  img.src = imagePath;
});
