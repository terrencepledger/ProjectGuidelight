const { ipcRenderer } = require('electron');

document.getElementById('send').addEventListener('click', () => {
  ipcRenderer.send('toPresentation', 'Hello from control');
});

ipcRenderer.on('fromPresentation', (_event, data) => {
  console.log('Received:', data);
});
