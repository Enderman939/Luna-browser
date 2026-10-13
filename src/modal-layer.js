const { BrowserWindow } = require('electron');
const path = require('node:path');
const { scopedIPC } = require('./scoped-ipc');

// Dialogs remain owned by the trusted chrome renderer. This transparent owned
// window displays their DOM and forwards only UI events to that same renderer.
// It never receives the browser command bridge or website/session privileges.
class ModalLayer {
  constructor(parent, changed) {
    this.parent = parent; this.changed = changed; this.window = null; this.snapshot = null; this.ready = false; this.session = null;
    const ipc = scopedIPC(parent, event => this.window && !this.window.isDestroyed() && event.sender === this.window.webContents && event.senderFrame === event.sender.mainFrame);
    ipc.handle('modal-layer:ready', () => { this.ready = true; this.publish(); return true; });
    ipc.handle('modal-layer:event', (_, value) => {
      if (!this.snapshot || value?.session !== this.session || !Number.isSafeInteger(value.seq) || value.seq < 1 || !['click', 'input', 'change', 'submit', 'cancel', 'toggle', 'drag', 'scroll'].includes(value.type)) throw new Error('Invalid dialog event');
      if (JSON.stringify(value).length > 256 * 1024) throw new Error('Dialog event too large');
      this.parent.webContents.send('browser:dialog-event', value); return true;
    });
    parent.on('move', () => this.position()); parent.on('resize', () => this.position());
    parent.on('focus', () => { if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.window.focus(); });
    parent.on('minimize', () => this.window?.hide()); parent.on('restore', () => { if (this.window && this.snapshot) { this.position(); this.window.show(); } });
    parent.on('closed', () => this.close(false));
  }
  update(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.dialogs) || !snapshot.dialogs.length) { this.close(); return; }
    if (typeof snapshot.session !== 'string' || !/^[\da-f-]{36}$/.test(snapshot.session) || snapshot.dialogs.length > 12 || JSON.stringify(snapshot).length > 4 * 1024 * 1024) throw new Error('Invalid dialog snapshot');
    this.snapshot = snapshot; this.session = snapshot.session;
    if (!this.window) {
      // Ownership, a full input-catching backdrop and the browser's shortcut
      // gate lock interactions while preserving normal owned-window lifecycle.
      const popup = new BrowserWindow({ ...this.parent.getContentBounds(), parent: this.parent, frame: false, transparent: true,
        backgroundColor: '#00000000', show: false, resizable: false, movable: false, minimizable: false, maximizable: false, skipTaskbar: true, hasShadow: false,
        webPreferences: { preload: path.join(__dirname, 'modal-preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
      this.window = popup; this.ready = false;
      popup.webContents.on('will-navigate', event => event.preventDefault()); popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      popup.on('close', event => { if (this.window === popup && this.snapshot) { event.preventDefault(); popup.webContents.send('modal-layer:cancel'); } });
      popup.on('closed', () => { if (this.window === popup) { this.window = null; this.ready = false; this.changed(); } });
      popup.loadFile(path.join(__dirname, 'ui', 'modal-layer.html')).catch(() => {});
    }
    this.position(); this.publish(); this.changed();
  }
  position() {
    if (this.window && !this.window.isDestroyed() && !this.parent.isDestroyed()) this.window.setBounds(this.parent.getContentBounds());
  }
  publish() {
    if (!this.ready || !this.snapshot || !this.window || this.window.isDestroyed()) return;
    this.window.webContents.send('modal-layer:snapshot', { ...this.snapshot, windowId: this.parent.id });
    if (!this.parent.isMinimized() && !this.window.isVisible()) this.window.show();
  }
  close(focus = true) {
    const popup = this.window; this.window = null; this.snapshot = null; this.session = null; this.ready = false;
    if (popup && !popup.isDestroyed()) popup.close();
    if (popup && focus && !this.parent.isDestroyed() && !this.parent.isMinimized()) this.parent.webContents.focus();
    if (popup) this.changed();
  }
}
module.exports = { ModalLayer };
