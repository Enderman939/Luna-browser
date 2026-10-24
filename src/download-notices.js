const { BrowserWindow, screen } = require('electron');
const path = require('node:path');
const { scopedIPC } = require('./scoped-ipc');

class DownloadNotices {
  constructor(parent, { changed, blocked, dark, action, appearance = () => ({}) }) {
    Object.assign(this, { parent, changed, blocked, dark, action, appearance });
    this.items = []; this.count = 0; this.attention = false; this.window = null; this.ready = false;
    const ipc = scopedIPC(parent, event => this.window && !this.window.isDestroyed() && event.sender === this.window.webContents && event.senderFrame === event.sender.mainFrame);
    ipc.handle('download-notice:ready', () => { this.ready = true; this.refresh(); });
    ipc.handle('download-notice:action', async (_, value) => {
      if (!value || !['dismiss', 'pause', 'resume', 'open', 'reveal', 'downloads'].includes(value.action)) throw new Error('无效的下载提醒操作');
      if (value.action === 'dismiss') { this.dismiss(); return; }
      if (value.action === 'pause') { clearTimeout(this.timer); return; }
      if (value.action === 'resume') { this.expire(); return; }
      const entry = this.items.find(item => item.id === value.id);
      if (!entry || this.blocked()) return;
      try { await this.action(value.action, entry); }
      catch (error) { this.error = error.message; this.refresh(); throw error; }
      if (value.action === 'downloads') this.clear(); else this.dismiss();
    });
    parent.on('move', () => this.position()); parent.on('resize', () => this.position());
    parent.on('focus', () => this.refresh()); parent.on('restore', () => this.refresh());
    parent.on('minimize', () => this.hide());
    parent.on('blur', () => {
      clearTimeout(this.blurTimer);
      this.blurTimer = setTimeout(() => { if (!this.foreground()) this.hide(); }, 60);
    });
    parent.once('closed', () => this.dispose());
  }
  foreground() {
    if (this.parent.isDestroyed() || this.parent.isMinimized()) return false;
    const focused = BrowserWindow.getFocusedWindow();
    return focused === this.parent || this.parent.getChildWindows().includes(focused);
  }
  snapshot() {
    const entry = this.items.at(-1);
    return { id: entry?.id, name: entry?.name, count: this.count, dark: this.dark(), appearance: this.appearance(), owner: this.parent.id, error: this.error || '' };
  }
  add(entry) {
    this.items = this.items.filter(item => item.id !== entry.id);
    this.items.push({ id: entry.id, name: String(entry.name).slice(0, 300), file: entry.file, url: entry.url, managed: entry.managed });
    this.items = this.items.slice(-5); this.count = Math.min(99, this.count + 1); this.attention = true; this.error = '';
    this.refresh(); if (this.window?.isVisible()) this.expire(); this.changed();
  }
  create() {
    const popup = new BrowserWindow({ width: 414, height: 206, parent: this.parent, title: 'luna · 下载完成', frame: false, transparent: true,
      backgroundColor: '#00000000', show: false, resizable: false, movable: false, maximizable: false, minimizable: false, skipTaskbar: true, hasShadow: false,
      webPreferences: { preload: path.join(__dirname, 'download-notice-preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    this.window = popup; this.ready = false;
    popup.webContents.on('will-navigate', event => event.preventDefault()); popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    popup.on('closed', () => { if (this.window === popup) { this.window = null; this.ready = false; } });
    popup.on('blur', () => { setTimeout(() => { if (!this.foreground()) this.hide(); }, 60); });
    popup.loadFile(path.join(__dirname, 'ui/download-notice.html')).catch(() => this.dismiss());
  }
  refresh() {
    if (!this.attention || !this.items.length || this.parent.isDestroyed()) return;
    if (this.blocked() || !this.foreground()) { this.hide(); return; }
    if (!this.window) this.create();
    this.position();
    if (!this.ready || !this.window || this.window.isDestroyed()) return;
    this.window.webContents.send('download-notice:state', this.snapshot());
    if (!this.window.isVisible()) { this.window.showInactive(); this.expire(); }
  }
  position() {
    if (!this.window || this.window.isDestroyed() || this.parent.isDestroyed()) return;
    const bounds = this.parent.getContentBounds(), area = screen.getDisplayMatching(this.parent.getBounds()).workArea;
    const width = Math.min(414, bounds.width), height = Math.min(206, bounds.height);
    this.window.setBounds({ width, height, x: Math.round(Math.max(area.x, Math.min(area.x + area.width - width, bounds.x + bounds.width - width - 12))),
      y: Math.round(Math.max(area.y, Math.min(area.y + area.height - height, bounds.y + 98))) });
  }
  expire() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.dismiss(), 12000); this.timer.unref();
  }
  hide() { clearTimeout(this.timer); if (this.window && !this.window.isDestroyed()) this.window.hide(); }
  dismiss() { this.attention = false; this.hide(); }
  clear() { this.dismiss(); this.items = []; this.count = 0; this.changed(); }
  dispose() { clearTimeout(this.timer); clearTimeout(this.blurTimer); this.attention = false; if (this.window && !this.window.isDestroyed()) this.window.destroy(); this.window = null; }
}
module.exports = { DownloadNotices };
