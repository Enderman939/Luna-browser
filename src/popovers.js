const { BrowserWindow, screen } = require('electron');
const path = require('node:path');
const { fieldPlacement } = require('./password-popup-layout');

class Popovers {
  constructor(parent, preload, getState, changed) {
    Object.assign(this, { parent, preload, getState, changed });
    this.window = null; this.kind = null; this.anchor = null; this.closing = false;
    parent.on('move', () => this.position()); parent.on('resize', () => this.close(true));
    parent.on('minimize', () => this.close(true)); parent.on('closed', () => this.close(true));
    parent.on('blur', () => {
      const popup = this.window;
      if ((this.kind !== 'passwords' || !this.anchor?.field) && this.kind !== 'address' || !popup) return;
      // Clicking a suggestion may focus its window. Switching applications should
      // dismiss it, while a click inside the card must finish its fill action.
      setTimeout(() => {
        if (this.window !== popup || popup.isDestroyed()) return;
        const focused = BrowserWindow.getFocusedWindow();
        if (focused !== popup && focused !== this.parent) this.close(true);
      }, 50);
    });
  }
  owns(sender) { return !!this.window && !this.window.isDestroyed() && this.window.webContents === sender; }
  dimensions(kind) {
    const field = kind === 'passwords' && this.anchor?.field;
    const width = kind === 'address' ? Math.max(300, this.anchor?.width || 600) : field ? 336 : kind === 'downloads' ? 594 : kind === 'browser' ? 636 : kind === 'extensions' || kind === 'passwords' ? 384 : 414;
    const space = field ? Math.max(this.anchor.viewport.y + this.anchor.viewport.height - this.anchor.y - this.anchor.height + 4, this.anchor.y - this.anchor.viewport.y + 4) : Infinity;
    return { width: Math.min(width, this.parent.getContentBounds().width - 24), height: Math.max(100, Math.min(field ? 400 : kind === 'browser' ? 800 : 700, this.parent.getContentBounds().height - 110, space)) };
  }
  async open(kind, anchor) {
    if (!['extensions', 'browser', 'downloads', 'history', 'bookmarks', 'passwords', 'address'].includes(kind)) throw new Error('Invalid popover');
    if (kind === 'downloads') this.onDownloadsOpen?.();
    if (kind === 'address' && this.kind === kind && this.window && !this.closing) { this.anchor = anchor; this.position(); this.state(this.getState()); return; }
    if (this.kind === kind && this.window && !this.closing && kind === 'passwords' && anchor?.field && this.anchor?.field) {
      this.anchor = anchor; this.position(); this.state(this.getState()); this.changed(); return;
    }
    if (this.kind === kind && this.window && !anchor?.field && !this.anchor?.field) { this.close(); return; }
    this.close(true); this.kind = kind; this.anchor = anchor; this.closing = false;
    const popup = new BrowserWindow({ ...this.dimensions(kind), parent: this.parent, title: 'luna · ' + kind,
      frame: false, transparent: true, backgroundColor: '#00000000', show: false,
      resizable: false, movable: false, maximizable: false, minimizable: false, skipTaskbar: true, hasShadow: false,
      webPreferences: { preload: this.preload, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    this.window = popup;
    popup.webContents.on('before-input-event', (event, input) => this.handleShortcut?.(event, input));
    popup.webContents.on('will-navigate', event => event.preventDefault()); popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    popup.on('blur', () => this.close());
    popup.on('closed', () => { if (this.window === popup) { this.window = null; this.kind = null; this.closing = false; this.changed(); } });
    await popup.loadFile(path.join(__dirname, 'ui', 'index.html'), { query: { popover: kind } });
    if (popup.isDestroyed() || this.window !== popup) return;
    this.position(); popup.webContents.send('browser:state', this.getState());
    if (anchor?.field || kind === 'address') popup.showInactive(); else popup.show(); this.changed();
  }
  position() {
    if (!this.window || this.window.isDestroyed() || this.parent.isDestroyed()) return;
    const parent = this.parent.getContentBounds(), popup = this.window.getBounds(), area = screen.getDisplayMatching(this.parent.getBounds()).workArea;
    const anchor = this.anchor || { x: parent.width - 20, y: 60, width: 0, height: 30 };
    if (this.kind === 'passwords' && anchor.field) {
      const placement = fieldPlacement(anchor, parent, popup, area);
      this.window.setPosition(placement.x, placement.y);
      this.window.webContents.send('browser:password-placement', { edge: placement.edge, pointer: placement.pointer }); return;
    }
    const x = parent.x + anchor.x + anchor.width - popup.width + 12, y = parent.y + anchor.y + anchor.height - 4;
    const nextX = Math.round(Math.max(area.x, Math.min(area.x + area.width - popup.width, x))), nextY = Math.round(Math.max(area.y, Math.min(area.y + area.height - popup.height, y)));
    if (popup.x !== nextX || popup.y !== nextY) this.window.setPosition(nextX, nextY);
  }
  resize(value) {
    const height = typeof value === 'object' ? value?.height : value;
    if (!this.window || this.window.isDestroyed() || this.closing || !Number.isFinite(height)) return;
    const [width, previousHeight] = this.window.getContentSize();
    const nextHeight = Math.round(Math.min(this.dimensions(this.kind).height, Math.max(100, height)));
    if (previousHeight !== nextHeight) this.window.setContentSize(width, nextHeight);
    this.position();
  }
  state(state) { if (this.window && !this.window.isDestroyed()) this.window.webContents.send('browser:state', state); }
  close(immediate = false) {
    const popup = this.window; if (!popup || popup.isDestroyed()) return;
    if (!this.closing && this.kind === 'passwords' && this.anchor?.field) this.onFieldClose?.();
    if (immediate) { this.window = null; this.kind = null; this.closing = false; popup.destroy(); this.changed(); return; }
    if (this.closing) return; this.closing = true; popup.webContents.send('browser:popover-close');
    setTimeout(() => { if (!popup.isDestroyed()) popup.destroy(); }, 150);
  }
  toParentRect(rect) {
    if (!this.window || this.window.isDestroyed() || !rect) return rect;
    const parent = this.parent.getContentBounds(), popup = this.window.getContentBounds();
    return { ...rect, x: rect.x + popup.x - parent.x, y: rect.y + popup.y - parent.y };
  }
}
module.exports = { Popovers };
