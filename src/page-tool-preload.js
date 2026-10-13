const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pageTool', {
  data: () => ipcRenderer.invoke('page-tool:data'),
  action: (action, value) => ipcRenderer.invoke('page-tool:action', action, value),
  onAppearance: callback => ipcRenderer.on('page-tool:appearance', (_, value) => callback(value)),
});
