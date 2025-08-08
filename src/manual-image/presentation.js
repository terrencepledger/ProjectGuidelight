const { ipcRenderer } = require('electron');
const { pathToFileURL } = require('url');
const img = document.getElementById('display');

ipcRenderer.on('manual-image-display', (_event, imagePath) => {
  img.src = pathToFileURL(imagePath).href;
});
