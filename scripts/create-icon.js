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
  const pngs = [16, 24, 32, 48, 64, 128, 256].map(size => image.resize({ width: size, height: size }).toPNG());
  const png = pngs.at(-1);
  fs.writeFileSync(path.join(assets, 'app.png'), png);
  // Windows chooses the closest image layer for the taskbar, title bar and
  // shortcuts. Keep standard PNG-backed layers instead of scaling one 256px
  // image down for every surface.
  const directory = Buffer.alloc(6); directory.writeUInt16LE(0, 0); directory.writeUInt16LE(1, 2); directory.writeUInt16LE(pngs.length, 4);
  const entries = [], data = []; let offset = 6 + pngs.length * 16;
  for (const [index, size] of [16, 24, 32, 48, 64, 128, 256].entries()) {
    const value = pngs[index], entry = Buffer.alloc(16);
    entry[0] = size === 256 ? 0 : size; entry[1] = size === 256 ? 0 : size; entry[2] = 0; entry[3] = 0;
    entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6); entry.writeUInt32LE(value.length, 8); entry.writeUInt32LE(offset, 12);
    entries.push(entry); data.push(value); offset += value.length;
  }
  fs.writeFileSync(path.join(assets, 'app.ico'), Buffer.concat([directory, ...entries, ...data]));
  console.log('Generated luna PNG / ICO from mark.svg');
  window.destroy();
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
app.on('will-quit', () => { try { fs.rmSync(temporary, { recursive: true, force: true }); } catch { /* Windows may still hold a cache file */ } });
