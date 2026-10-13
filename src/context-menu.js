const { BrowserWindow, screen } = require('electron');
const { scopedIPC } = require('./scoped-ipc');
const path = require('node:path');

class ContextMenus {
  constructor(parent, theme, notice, appearance = () => ({})) {
    Object.assign(this, { parent, theme, notice, appearance });
    this.current = null;
    const trusted = event => this.current && event.sender === this.current.window.webContents && event.senderFrame === event.sender.mainFrame;
    const ipcMain = scopedIPC(parent, trusted);
    ipcMain.handle('context-menu:data', event => {
      if (!trusted(event)) throw new Error('Untrusted sender');
      return { items: this.current.items, dark: this.theme(), appearance: this.appearance(), side: this.current.side, maxHeight: this.current.maxHeight };
    });
    ipcMain.handle('context-menu:fit', (event, size) => { if (trusted(event)) this.fit(size); });
    ipcMain.handle('context-menu:close', event => { if (trusted(event)) this.close(); });
    ipcMain.handle('context-menu:action', async (event, id) => {
      if (!trusted(event)) throw new Error('Untrusted sender');
      const current = this.current, callback = current.actions.get(id);
      if (!callback) return;
      this.close(true);
      if (current.web.isDestroyed() || current.web.getURL() !== current.url) return;
      this.parent.focus(); current.web.focus();
      try { await callback(); } catch (error) { this.notice('无法执行此操作：' + error.message); }
    });
    parent.on('move', () => this.close(true)); parent.on('resize', () => this.close(true));
    parent.on('minimize', () => this.close(true)); parent.on('closed', () => this.close(true));
  }
  serialize(items, actions, invoke, prefix = '') {
    return items.filter(item => item.visible !== false).map((item, index) => {
      const id = prefix + index;
      const children = Array.isArray(item.submenu) ? item.submenu : item.submenu?.items;
      const result = { id, label: item.label, type: item.type, shortcut: item.shortcut, enabled: item.enabled !== false, checked: !!item.checked, symbol: item.symbol };
      if (item.icon && !item.icon.isEmpty()) result.icon = item.icon.toDataURL();
      if (children?.length) result.submenu = this.serialize(children, actions, invoke, id + '/');
      else if (item.type !== 'separator' && result.enabled) actions.set(id, item.click ? () => item.click(item, this.parent, { triggeredByAccelerator: false }) : () => invoke(item.id));
      return result;
    });
  }
  async open(web, params, items, invoke, viewport) {
    this.close(true);
    const parent = this.parent.getContentBounds(), area = screen.getDisplayMatching(this.parent.getBounds()).workArea;
    const width = Math.min(384, area.width), maxHeight = Math.min(760, area.height - 16);
    const rootX = Math.max(area.x, Math.min(area.x + area.width - width, parent.x + viewport.x + params.x - 8));
    const rootY = Math.max(area.y, Math.min(area.y + area.height - 100, parent.y + viewport.y + params.y - 8));
    const side = rootX + width * 2 > area.x + area.width ? 'left' : 'right';
    const popup = new BrowserWindow({ width, height: 100, x: Math.round(rootX), y: Math.round(rootY), parent: this.parent, title: 'luna · 右键菜单',
      frame: false, transparent: true, backgroundColor: '#00000000', show: false, resizable: false, movable: false,
      maximizable: false, minimizable: false, skipTaskbar: true, hasShadow: false,
      webPreferences: { preload: path.join(__dirname, 'context-menu-preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const actions = new Map();
    const current = { window: popup, web, url: web.getURL(), items: this.serialize(items, actions, invoke), actions, rootX, rootY, width, area, side, maxHeight, closing: false };
    this.current = current;
    const navigation = (_, url, inPage, mainFrame) => { if (mainFrame) this.close(true); };
    const destroyed = () => { if (this.current === current) this.close(true); };
    web.on('did-start-navigation', navigation); web.once('destroyed', destroyed);
    popup.webContents.on('will-navigate', event => event.preventDefault()); popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    popup.on('blur', () => { if (this.current === current) this.close(); });
    popup.on('closed', () => { web.removeListener('did-start-navigation', navigation); web.removeListener('destroyed', destroyed); if (this.current === current) this.current = null; });
    await popup.loadFile(path.join(__dirname, 'ui', 'context-menu.html'));
    if (popup.isDestroyed() || this.current !== current) return;
    popup.show();
  }
  fit(size) {
    const current = this.current;
    if (!current || current.closing || !Number.isFinite(size?.height) || !Number.isFinite(size?.columns)) return;
    const { area } = current;
    const width = Math.min(area.width, current.width * Math.min(2, Math.max(1, Math.round(size.columns))));
    const height = Math.min(current.maxHeight, Math.max(80, Math.ceil(size.height)));
    const x = current.side === 'left' ? current.rootX + current.width - width : current.rootX;
    const y = Math.min(current.rootY, area.y + area.height - height);
    current.window.setBounds({ x: Math.round(Math.max(area.x, Math.min(area.x + area.width - width, x))), y: Math.round(Math.max(area.y, y)), width: Math.round(width), height: Math.round(height) });
  }
  close(immediate = false) {
    const current = this.current; if (!current || current.window.isDestroyed()) return;
    if (immediate) { this.current = null; current.window.destroy(); return; }
    if (current.closing) return;
    current.closing = true; current.window.webContents.send('context-menu:closing');
    setTimeout(() => { if (!current.window.isDestroyed()) current.window.destroy(); }, 120);
  }
  updateAppearance() {
    if (this.current && !this.current.window.isDestroyed()) this.current.window.webContents.send('context-menu:appearance', { appearance: this.appearance(), dark: this.theme() });
  }
}
module.exports = { ContextMenus };
