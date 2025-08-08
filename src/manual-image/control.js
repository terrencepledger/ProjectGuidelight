const { ipcRenderer } = require('electron');
const { pathToFileURL } = require('url');

const selectBtn = document.getElementById('select-folder');
const thumbnails = document.getElementById('thumbnails');
const showBtn = document.getElementById('show');
let selectedImage = null;

selectBtn.addEventListener('click', async () => {
  thumbnails.innerHTML = '';
  const files = await ipcRenderer.invoke('pick-folder');
  files.forEach(file => {
    const img = document.createElement('img');
    img.src = pathToFileURL(file).href;
    img.dataset.filePath = file;
    img.addEventListener('click', () => {
      document.querySelectorAll('#thumbnails img').forEach(el => el.classList.remove('selected'));
      img.classList.add('selected');
      selectedImage = img.dataset.filePath;
    });
    thumbnails.appendChild(img);
  });
});

showBtn.addEventListener('click', () => {
  if (selectedImage) {
    ipcRenderer.send('manual-image-show', selectedImage);
  }
});
