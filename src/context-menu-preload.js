const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('contextMenu', {
  data: () => ipcRenderer.invoke('context-menu:data'),
  fit: size => ipcRenderer.invoke('context-menu:fit', size),
  action: id => ipcRenderer.invoke('context-menu:action', id),
  close: () => ipcRenderer.invoke('context-menu:close'),
  onClosing: callback => ipcRenderer.on('context-menu:closing', callback),
  onAppearance: callback => ipcRenderer.on('context-menu:appearance', (_, value) => callback(value)),
});
