const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('modalLayer', {
  ready: () => ipcRenderer.invoke('modal-layer:ready'),
  event: value => ipcRenderer.invoke('modal-layer:event', value),
  onSnapshot: callback => ipcRenderer.on('modal-layer:snapshot', (_, value) => callback(value)),
  onCancel: callback => ipcRenderer.on('modal-layer:cancel', callback),
});
