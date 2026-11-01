const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('installer', {
  version: ipcRenderer.sendSync('installer:version'),
  defaultInstallPath: ipcRenderer.sendSync('installer:default-path'),
  ready: () => ipcRenderer.send('installer:ui-ready'),
  chooseFolder: value => ipcRenderer.invoke('installer:choose-folder', value),
  install: value => ipcRenderer.invoke('installer:install', value),
  onProgress: callback => ipcRenderer.on('installer:progress', (_, value) => callback(value)),
  close: () => ipcRenderer.invoke('installer:close'),
  launch: () => ipcRenderer.invoke('installer:launch'),
});
