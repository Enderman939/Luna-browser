const { contextBridge, ipcRenderer } = require('electron');
const { injectBrowserAction } = require('electron-chrome-extensions/browser-action');

injectBrowserAction();

contextBridge.exposeInMainWorld('browser', {
  command: (action, payload) => ipcRenderer.invoke('browser:command', action, payload),
  onState: callback => ipcRenderer.on('browser:state', (_, state) => callback(state)),
  onNotice: callback => ipcRenderer.on('browser:notice', (_, message) => callback(message)),
  onShortcut: callback => ipcRenderer.on('browser:shortcut', (_, action) => callback(action)),
  onFindResult: callback => ipcRenderer.on('browser:find-result', (_, result) => callback(result)),
  onPrompt: callback => ipcRenderer.on('browser:prompt', (_, prompt) => callback(prompt)),
  onPromptClose: callback => ipcRenderer.on('browser:prompt-close', (_, prompt) => callback(prompt)),
  respondPrompt: (id, response) => ipcRenderer.invoke('browser:prompt-response', id, response),
  onClearData: callback => ipcRenderer.on('browser:clear-data', (_, options) => callback(options)),
  onPopoverClose: callback => ipcRenderer.on('browser:popover-close', () => callback()),
  onPasswordKey: callback => ipcRenderer.on('browser:password-key', (_, key) => callback(key)),
  onPasswordPlacement: callback => ipcRenderer.on('browser:password-placement', (_, placement) => callback(placement)),
  onSettingsSection: callback => ipcRenderer.on('browser:settings-section', (_, section) => callback(section)),
  onDialogEvent: callback => ipcRenderer.on('browser:dialog-event', (_, value) => callback(value)),
});
