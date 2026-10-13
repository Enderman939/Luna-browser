const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const iconAssets = path.join(__dirname, '..', 'src', 'ui', 'assets');
if (['app.png', 'app.ico'].every(name => fs.existsSync(path.join(iconAssets, name)) && fs.statSync(path.join(iconAssets, name)).mtimeMs >= fs.statSync(path.join(iconAssets, 'mark.svg')).mtimeMs)) {
  console.log('Using current luna PNG / ICO');
  app.exit(0);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-icon-'));
app.setPath('userData', temporary);
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const assets = path.join(__dirname, '..', 'src', 'ui', 'assets');
  const svg = fs.readFileSync(path.join(assets, 'mark.svg'), 'utf8').replace('<svg ', '<svg width="256" height="256" ');
  const window = new BrowserWindow({ width: 256, height: 256, frame: false, show: true, transparent: true, webPreferences: { sandbox: true, contextIsolation: true } });
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<html><body style="margin:0;overflow:hidden;background:transparent">' + svg + '</body></html>'));
  await new Promise(resolve => setTimeout(resolve, 300));
  const image = await window.webContents.capturePage();
  const png = image.resize({ width: 256, height: 256 }).toPNG();
  fs.writeFileSync(path.join(assets, 'app.png'), png);
  // ICO files can contain a PNG image; 0 in the dimensions means 256 px.
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
  fs.writeFileSync(path.join(assets, 'app.ico'), Buffer.concat([header, png]));
  console.log('Generated luna PNG / ICO from mark.svg');
  window.destroy();
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
app.on('will-quit', () => { try { fs.rmSync(temporary, { recursive: true, force: true }); } catch { /* Windows may still hold a cache file */ } });
