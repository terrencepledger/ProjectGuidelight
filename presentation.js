const { ipcRenderer } = require('electron');

ipcRenderer.on('fromControl', (_event, data) => {
  console.log('Presentation received:', data);
  ipcRenderer.send('toControl', `Ack: ${data}`);
});
