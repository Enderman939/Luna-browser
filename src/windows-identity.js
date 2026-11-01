const path = require('node:path');
const fs = require('node:fs');
const APP_ID = 'luna.browser';
function applyWindowIdentity(window, { app, shell, icon }) {
  if (process.platform !== 'win32') return;
  const command = '"' + process.execPath + '"' + (app.isPackaged ? '' : ' "' + app.getAppPath() + '"');
  window.setAppDetails({ appId: APP_ID, appIconPath: icon, appIconIndex: 0, relaunchCommand: command, relaunchDisplayName: 'Luna Browser' });
  if (!app.isPackaged) return;
  // Repair only Luna shortcuts that already launch this exact installation.
  for (const file of [path.join(app.getPath('desktop'), 'Luna Browser.lnk'), path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Luna Browser', 'Luna Browser.lnk')]) {
    if (!fs.existsSync(file)) continue;
    try {
      const link = shell.readShortcutLink(file);
      if (path.resolve(link.target).toLowerCase() === path.resolve(process.execPath).toLowerCase()) shell.writeShortcutLink(file, 'update', { appUserModelId: APP_ID, icon, iconIndex: 0 });
    } catch {}
  }
}
module.exports = { APP_ID, applyWindowIdentity };
