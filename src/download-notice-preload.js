const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('downloadNotice', {
  ready: () => ipcRenderer.invoke('download-notice:ready'),
  action: (action, id) => ipcRenderer.invoke('download-notice:action', { action, id }),
  onState: callback => ipcRenderer.on('download-notice:state', (_, value) => callback(value)),
});
