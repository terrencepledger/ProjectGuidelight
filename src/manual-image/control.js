const { ipcRenderer } = require('electron');

const selectBtn = document.getElementById('select-folder');
const thumbnails = document.getElementById('thumbnails');
const showBtn = document.getElementById('show');
let selectedImage = null;

selectBtn.addEventListener('click', async () => {
  thumbnails.innerHTML = '';
  const files = await ipcRenderer.invoke('pick-folder');
  files.forEach(file => {
    const img = document.createElement('img');
    img.src = file;
    img.addEventListener('click', () => {
      document.querySelectorAll('#thumbnails img').forEach(el => el.classList.remove('selected'));
      img.classList.add('selected');
      selectedImage = file;
    });
    thumbnails.appendChild(img);
  });
});

showBtn.addEventListener('click', () => {
  if (selectedImage) {
    ipcRenderer.send('manual-image-show', selectedImage);
  }
});
