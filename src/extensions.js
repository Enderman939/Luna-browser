const { app, BrowserWindow, dialog, nativeImage, screen, ipcMain } = require('electron');
const { ElectronChromeExtensions } = require('electron-chrome-extensions');
const { installChromeWebStore } = require('electron-chrome-web-store');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { extractExtension, readManifest } = require('./extension-package');
const { parseStoreRequest, extensionIdFromKey, edgeCrxURL, fetchCrx, downloadStoreCrx, friendlyError } = require('./webstore-download');
const { browserFetch } = require('./webstore-transport');
const { ExtensionSecurity, extensionResource } = require('./extension-security');

class ExtensionManager extends EventEmitter {
  constructor({ directory, session, window, createTab, selectTab, removeTab, getTabDetails, prompt, trustedRenderer, createWindow, removeWindow, privateMode = false, partition = 'persist:luma-web' }) {
    super();
    this.directory = directory; this.session = session; this.window = window;
    this.privateMode = privateMode; this.partition = partition;
    session.setUserAgent(session.getUserAgent().replace(/\s(?:Electron|luna(?:-browser)?|Luma)\/[\d.]+/gi, ''));
    this.file = path.join(directory, 'extensions-data.json');
    this.webStorePath = path.join(directory, 'webstore-extensions');
    this.records = new Map(); this.installing = false;
    this.contextWorkers = new Map();
    this.globalEnabled = true;
    try { this.globalEnabled = JSON.parse(fs.readFileSync(path.join(directory, 'extension-preferences.json'), 'utf8')).enabled !== false; } catch { /* default enabled */ }
    this.installState = null;
    this.prompt = prompt;
    const appListeners = app.listeners('web-contents-created');
    this.bridge = new ElectronChromeExtensions({
      license: 'GPL-3.0', session,
      createTab: async details => createTab(details), selectTab, removeTab,
      createWindow: createWindow || (async details => { await createTab({ url: Array.isArray(details.url) ? details.url[0] : details.url, active: true }); window.show(); return window; }),
      removeWindow: removeWindow || (() => window.close()),
      assignTabDetails: (details, web) => Object.assign(details, getTabDetails(web)),
      requestPermissions: (extension, permissions) => this.confirm(extension.name, permissions),
    });
    this.appListeners = app.listeners('web-contents-created').filter(listener => !appListeners.includes(listener));
    this.security = new ExtensionSecurity({ bridge: this.bridge, session, trustedRenderer });
    if (privateMode) {
      const details = this.bridge.api.windows.getWindowDetails.bind(this.bridge.api.windows);
      this.bridge.api.windows.getWindowDetails = target => { const result = details(target); return result ? { ...result, incognito: true } : result; };
      session.registerPreloadScript({ id: 'luna-private-extension-context-frame', type: 'frame', filePath: path.join(__dirname, 'private-extension-preload.js') });
      session.registerPreloadScript({ id: 'luna-private-extension-context-worker', type: 'service-worker', filePath: path.join(__dirname, 'private-extension-preload.js') });
    }
    session.registerPreloadScript({ id: 'luna-extension-browser-alias-frame', type: 'frame', filePath: path.join(__dirname, 'extension-compat-preload.js') });
    session.registerPreloadScript({ id: 'luna-extension-browser-alias-worker', type: 'service-worker', filePath: path.join(__dirname, 'extension-compat-preload.js') });
    this.bridge.on('browser-action-popup-created', popup => this.sizePopup(popup).catch(() => {}));
    session.extensions.on('extension-loaded', (_, extension) => this.remember(extension));
    session.extensions.on('extension-unloaded', (_, extension) => {
      this.contextWorkers.delete(extension.id);
      this.emit('unloaded', extension.id); this.emit('change');
    });
  }
  async sizePopup(popup) {
    const requestedAnchor = this.actionAnchor?.id === popup.extensionId ? this.actionAnchor.rect : null;
    this.actionAnchor = null;
    await popup.whenReady();
    if (popup.isDestroyed() || !popup.browserWindow || this.window.isDestroyed()) return;
    const popupWindow = popup.browserWindow;
    const ownerWindow = popupWindow.getParentWindow() || this.window;
    const [width, height] = popupWindow.getContentSize();
    // The bridge resets the window to its 25 px minimum after load. Chromium's
    // preferred-size event can arrive before that reset and never repeat it.
    // Give responsive popups an initial viewport, then measure the actual body.
    if (width < 80 || height < 60) popup.setSize({ width: 360, height: 250 });
    await new Promise(resolve => setTimeout(resolve, 100));
    if (popup.isDestroyed()) return;
    const content = await popupWindow.webContents.executeJavaScript(`(() => {
      const body = document.body; if (!body) return {width:360,height:250};
      const rect = body.getBoundingClientRect(), style = getComputedStyle(body);
      return { width: Math.max(rect.width, body.scrollWidth) + (parseFloat(style.marginLeft)||0) + (parseFloat(style.marginRight)||0),
        height: Math.max(rect.height, body.scrollHeight) + (parseFloat(style.marginTop)||0) + (parseFloat(style.marginBottom)||0) };
    })()`);
    if (popup.isDestroyed()) return;
    const dimensions = { width: Math.min(800, Math.max(80, Math.ceil(content.width))), height: Math.min(600, Math.max(60, Math.ceil(content.height))) };
    popup.setSize(dimensions);
    const anchor = requestedAnchor || await ownerWindow.webContents.executeJavaScript(`(() => {
      const list = document.getElementById('extension-actions');
      const button = list?.shadowRoot?.getElementById(${JSON.stringify(popup.extensionId)});
      const rect = (button || list)?.getBoundingClientRect();
      return rect ? {x:rect.x,y:rect.y,width:rect.width,height:rect.height} : {x:innerWidth-200,y:50,width:30,height:30};
    })()`);
    if (popup.isDestroyed()) return;
    if (ownerWindow.isDestroyed()) return;
    const parent = ownerWindow.getContentBounds(), area = screen.getDisplayMatching(ownerWindow.getBounds()).workArea;
    const x = Math.max(area.x, Math.min(area.x + area.width - dimensions.width, parent.x + anchor.x + anchor.width - dimensions.width));
    const y = Math.max(area.y, Math.min(area.y + area.height - dimensions.height, parent.y + anchor.y + anchor.height + 5));
    popupWindow.setBounds({ x: Math.round(x), y: Math.round(y), ...dimensions });
    if (!popupWindow.isVisible()) popupWindow.show();
  }
  async init() {
    let records = [];
    try { records = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* first run */ }
    if (Array.isArray(records)) for (const record of records.slice(0, 100)) {
      if (/^[a-p]{32}$/.test(record.id) && typeof record.path === 'string' && path.isAbsolute(record.path)) this.records.set(record.id, record);
    }
    await installChromeWebStore({ session: this.session, extensionsPath: this.webStorePath, loadExtensions: false, autoUpdate: false, minimumManifestVersion: 2,
      beforeInstall: async details => ({ action: await this.confirm(details.localizedName, details.manifest) ? 'allow' : 'deny' }),
    });
    this.session.unregisterPreloadScript('electron-chrome-web-store');
    this.session.registerPreloadScript({ id: 'luna-webstore', type: 'frame', filePath: path.join(__dirname, 'webstore-preload.js') });
    this.registerStoreHandlers();
    for (const record of [...this.records.values()]) {
      if (!record.enabled || !this.globalEnabled) continue;
      try { await this.session.extensions.loadExtension(record.path, { allowFileAccess: false }); }
      catch (error) { record.error = error.message; }
    }
    this.save();
  }
  registerStoreHandlers() {
    const handle = (channel, callback) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (event, ...args) => {
        const frame = event.senderFrame;
        let origin;
        try { origin = new URL(frame?.url || '').origin; } catch { /* untrusted frame */ }
        if (event.sender.session !== this.session || origin !== 'https://chromewebstore.google.com' || frame.parent) throw new Error('仅允许 Chrome 网上应用店调用安装接口');
        return callback(event, ...args);
      });
    };
    handle('chromeWebstore.beginInstall', async (event, details) => {
      try {
        const extension = await this.installFromStore({ input: details?.id, market: 'chrome' });
        if (!extension) return { result: 'user_cancelled', message: '已取消安装' };
        if (!event.senderFrame.isDestroyed()) event.senderFrame.send('chrome.management.onInstalled', { id: extension.id, name: extension.name, version: extension.version, enabled: true, type: 'extension', installType: 'normal', permissions: extension.manifest.permissions || [], hostPermissions: extension.manifest.host_permissions || [] });
        return { result: 'success' };
      } catch (error) { return { result: 'install_error', message: friendlyError(error) }; }
    });
    handle('chromeWebstore.completeInstall', (_, id) => this.session.extensions.getExtension(id) ? 'success' : 'install_error');
    handle('chromeWebstore.getExtensionStatus', (_, id) => this.session.extensions.getExtension(id) ? 'enabled' : this.records.has(id) ? 'disabled' : 'installable');
    handle('chrome.management.setEnabled', (_, id, enabled) => this.enable(id, enabled === true));
    handle('chrome.management.uninstall', (_, id) => this.remove(id));
    for (const [channel, callback] of [
      ['lunaEdgeStore.install', id => this.installFromStore({ input: id, market: 'edge' })],
      ['lunaEdgeStore.status', id => !!this.session.extensions.getExtension(id)],
    ]) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (event, id) => {
        if (event.sender.session !== this.session || event.senderFrame?.parent || new URL(event.senderFrame?.url || '').origin !== 'https://microsoftedge.microsoft.com' || !/^[a-p]{32}$/.test(id)) throw new Error('仅允许 Edge 扩展商店调用安装接口');
        const result = await callback(id);
        return channel.endsWith('install') ? { success: !!result } : result;
      });
    }
  }
  progress(update) { this.installState = { ...this.installState, ...update }; this.emit('change'); }
  async confirm(name, manifest = {}) {
    const permissions = [...(manifest.permissions || []), ...(manifest.host_permissions || []), ...(manifest.origins || [])].filter(item => typeof item === 'string');
    const result = await this.prompt({
      kind: 'permissions', title: '安装扩展程序', message: '允许「' + name + '」访问以下权限？',
      detail: permissions.length ? permissions.join('\n') : '此扩展未声明额外权限。',
      confirmLabel: '允许',
    });
    return result.accepted;
  }
  icon(extension) {
    const manifest = extension.manifest;
    const icons = manifest.action?.default_icon || manifest.browser_action?.default_icon || manifest.icons;
    const relative = typeof icons === 'string' ? icons : icons && (icons['48'] || icons['32'] || icons['128'] || Object.values(icons)[0]);
    if (!relative || typeof relative !== 'string') return '';
    try { const image = nativeImage.createFromPath(extensionResource(extension.path, relative)); return image.isEmpty() ? '' : image.resize({ width: 48, height: 48 }).toDataURL(); } catch { return ''; }
  }
  remember(extension) {
    const old = this.records.get(extension.id) || {};
    const record = {
      ...old, id: extension.id, name: extension.name, version: extension.version,
      description: String(extension.manifest.description || '').slice(0, 500),
      manifestVersion: extension.manifest.manifest_version,
      path: extension.path, enabled: true, error: '', icon: this.icon(extension),
      options: extension.manifest.options_page || extension.manifest.options_ui?.page || '',
      allowIncognito: old.allowIncognito === true,
      incognitoSupported: extension.manifest.incognito !== 'not_allowed',
      source: old.source || (extension.path.startsWith(this.webStorePath) ? 'webstore' : 'unpacked'),
      pinned: old.pinned === true,
      hasAction: !!(extension.manifest.action || extension.manifest.browser_action || extension.manifest.page_action),
      popup: extension.manifest.action?.default_popup || extension.manifest.browser_action?.default_popup || extension.manifest.page_action?.default_popup || '',
      hosts: [...(extension.manifest.host_permissions || []), ...(extension.manifest.permissions || []).filter(value => typeof value === 'string' && (value.includes('://') || value === '<all_urls>')), ...(extension.manifest.content_scripts || []).flatMap(script => script.matches || [])].filter(value => typeof value === 'string'),
    };
    this.records.set(record.id, record); this.save(); this.emit('change');
    this.wakeContextWorker(extension);
  }
  wakeContextWorker(extension) {
    if (!extension.manifest.background?.service_worker || !extension.manifest.permissions?.includes('contextMenus')) return Promise.resolve();
    if (!this.contextWorkers.has(extension.id)) this.contextWorkers.set(extension.id, this.session.serviceWorkers.startWorkerForScope('chrome-extension://' + extension.id + '/').then(async worker => {
      const task = worker.startTask();
      try { await new Promise(resolve => setTimeout(resolve, 50)); }
      finally { task.end(); }
    }).catch(() => { this.contextWorkers.delete(extension.id); }));
    return this.contextWorkers.get(extension.id);
  }
  async contextMenuItems(web, params) {
    await Promise.all(this.session.extensions.getAllExtensions().map(extension => this.wakeContextWorker(extension)));
    if (web.isDestroyed()) return [];
    return this.bridge.getContextMenuItems(web, params);
  }
  snapshot() {
    return [...this.records.values()].map(({ path: directory, ...record }) => ({ ...record, configuredEnabled: record.enabled !== false, enabled: !!this.session.extensions.getExtension(record.id) }));
  }
  save() {
    if (this.privateMode) return;
    fs.mkdirSync(this.directory, { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify([...this.records.values()], null, 2));
    fs.renameSync(this.file + '.tmp', this.file);
  }
  async setIncognito(id, allowed) {
    const record = this.records.get(id); if (!record) throw new Error('扩展不存在');
    record.incognitoSupported = readManifest(record.path).incognito !== 'not_allowed';
    if (allowed && record.incognitoSupported === false) throw new Error('此扩展声明不支持无痕浏览');
    if (allowed && !record.allowIncognito) {
      const result = await this.prompt({ kind: 'incognito-extension', title: '允许扩展在无痕中运行',
        message: '允许「' + record.name + '」访问无痕网页？',
        detail: '扩展可能读取或向网络发送无痕网页内容。允许后，下一次无痕会话使用独立临时存储，关闭后清理；不会共享普通窗口的 Cookie 或扩展存储。请只允许信任的扩展。', confirmLabel: '允许' });
      if (!result.accepted) return false;
    }
    record.allowIncognito = allowed === true; this.save(); this.emit('change'); return true;
  }
  async syncPrivate(source) {
    if (!this.privateMode) throw new Error('Only private managers may mirror authorization');
    this.globalEnabled = source.globalEnabled;
    const desired = new Map([...source.records].filter(([, record]) => source.globalEnabled && record.enabled && record.allowIncognito === true && record.incognitoSupported !== false));
    for (const [id, record] of this.records) {
      if (!desired.has(id) || desired.get(id).path !== record.path) {
        this.session.extensions.removeExtension(id); this.records.delete(id);
        if (this.popupWindow && !this.popupWindow.isDestroyed()) this.popupWindow.destroy();
      }
    }
    for (const [id, record] of desired) {
      this.records.set(id, { ...record });
      if (!this.session.extensions.getExtension(id)) {
        try { await this.session.extensions.loadExtension(record.path, { allowFileAccess: false }); }
        catch (error) { this.records.get(id).error = error.message; }
      }
    }
    this.emit('change');
  }
  dispose() {
    if (this.popupWindow && !this.popupWindow.isDestroyed()) this.popupWindow.destroy();
    for (const extension of this.session.extensions.getAllExtensions()) this.session.extensions.removeExtension(extension.id);
    this.security.dispose();
    this.bridge.ctx.router.delegate.sessionMap.delete(this.session);
    this.bridge.ctx.router.listeners.clear();
    for (const listener of this.appListeners) app.removeListener('web-contents-created', listener);
    this.removeAllListeners();
  }
  async importDirectory() {
    const result = await dialog.showOpenDialog(this.window, { title: '选择包含 manifest.json 的扩展目录', properties: ['openDirectory'] });
    if (result.canceled) return;
    const directory = result.filePaths[0], manifest = readManifest(directory);
    if (!await this.confirm(manifest.name, manifest)) return;
    const extension = await this.session.extensions.loadExtension(directory, { allowFileAccess: false });
    const record = this.records.get(extension.id); record.source = 'unpacked'; this.save(); this.emit('change');
    if (!this.globalEnabled) this.session.extensions.removeExtension(extension.id);
  }
  async importPackage() {
    const result = await dialog.showOpenDialog(this.window, { title: '安装扩展程序', properties: ['openFile'], filters: [{ name: 'Chrome 扩展安装包', extensions: ['crx', 'zip'] }] });
    if (result.canceled) return;
    const file = result.filePaths[0];
    if (fs.statSync(file).size > 64 * 1024 * 1024) throw new Error('扩展安装包超过 64 MB');
    const buffer = fs.readFileSync(file), name = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 24);
    const directory = path.join(this.directory, 'local-extensions', name);
    // Always extract to a new directory so existing files or symlinks cannot
    // affect archive resolution. Keep an already installed copy unchanged.
    if (fs.existsSync(directory)) { const record = [...this.records.values()].find(item => item.path === directory); if (record) { await this.enable(record.id, true); return; } fs.rmSync(directory, { recursive: true, force: true }); }
    try {
      const manifest = extractExtension(buffer, directory);
      if (!await this.confirm(manifest.name, manifest)) { fs.rmSync(directory, { recursive: true, force: true }); return; }
      const extension = await this.session.extensions.loadExtension(directory, { allowFileAccess: false });
      const record = this.records.get(extension.id); record.source = 'package'; this.save(); this.emit('change');
      if (!this.globalEnabled) this.session.extensions.removeExtension(extension.id);
    } catch (error) { fs.rmSync(directory, { recursive: true, force: true }); throw error; }
  }
  async installFromStore(input, update = false) {
    const request = parseStoreRequest(typeof input === 'object' ? input.input : input, typeof input === 'object' ? input.market : 'edge');
    const { id, market } = request;
    if (this.installing) throw new Error('已有扩展正在安装');
    const existing = this.session.extensions.getExtension(id);
    if (existing && !update) return existing;
    this.installing = true; this.emit('change');
    this.progress({ id, market, phase: 'downloading', received: 0, total: 0, error: '' });
    let directory;
    try {
      const fetch = (url, options) => browserFetch(this.session, url, options);
      const buffer = market === 'edge'
        ? await fetchCrx(fetch, edgeCrxURL(id, process.versions.chrome), progress => this.progress(progress))
        : await downloadStoreCrx(fetch, id, process.versions.chrome, progress => this.progress(progress));
      this.progress({ phase: 'verifying' });
      directory = path.join(this.webStorePath, id, crypto.randomUUID());
      const manifest = extractExtension(buffer, directory);
      if (!manifest.key || extensionIdFromKey(manifest.key) !== id) throw new Error('安装包的扩展 ID 与商店不一致，已停止安装。');
      if (existing && existing.version === manifest.version) { fs.rmSync(directory, { recursive: true, force: true }); directory = null; this.progress({ phase: 'completed', name: existing.name }); return existing; }
      let name = manifest.name;
      const messageKey = /^__MSG_(.+)__$/.exec(name)?.[1];
      if (messageKey) for (const locale of [app.getLocale().replace('-', '_'), manifest.default_locale, 'en'].filter(value => /^[a-zA-Z_]+$/.test(value || ''))) {
        try { const messages = JSON.parse(fs.readFileSync(path.join(directory, '_locales', locale, 'messages.json'), 'utf8')); const key = Object.keys(messages).find(key => key.toLowerCase() === messageKey.toLowerCase()); if (messages[key]?.message) { name = messages[key].message; break; } } catch { /* try next locale */ }
      }
      this.progress({ phase: 'permission', name });
      if (!await this.confirm(name, manifest)) { this.progress({ phase: 'cancelled' }); return; }
      this.progress({ phase: 'loading' });
      if (existing) this.session.extensions.removeExtension(existing.id);
      const extension = await this.session.extensions.loadExtension(directory, { allowFileAccess: false });
      this.remember(extension); Object.assign(this.records.get(extension.id), { source: 'webstore', market }); this.save();
      if (!this.globalEnabled) this.session.extensions.removeExtension(extension.id);
      directory = null; this.progress({ phase: 'completed', name: extension.name }); this.emit('installed', extension.name);
      return extension;
    } catch (error) {
      const message = friendlyError(error);
      this.progress({ phase: 'error', error: message });
      if (existing && !this.session.extensions.getExtension(existing.id)) await this.session.extensions.loadExtension(existing.path, { allowFileAccess: false }).catch(() => {});
      throw new Error(message, { cause: error });
    } finally {
      if (directory) fs.rmSync(directory, { recursive: true, force: true });
      this.installing = false; this.emit('change');
    }
  }
  async enable(id, enabled) {
    const record = this.records.get(id); if (!record) return;
    record.error = '';
    if (enabled && this.globalEnabled) {
      try { await this.session.extensions.loadExtension(record.path, { allowFileAccess: false }); record.enabled = true; }
      catch (error) { record.error = error.message; record.enabled = false; this.save(); throw error; }
    } else { record.enabled = enabled; if (!enabled) this.session.extensions.removeExtension(id); }
    this.save(); this.emit('change');
  }
  setPinned(id, pinned) {
    const record = this.records.get(id); if (!record) return;
    record.pinned = pinned === true; this.save(); this.emit('change');
  }
  async setGlobalEnabled(enabled) {
    this.globalEnabled = enabled === true;
    fs.writeFileSync(path.join(this.directory, 'extension-preferences.json'), JSON.stringify({ enabled: this.globalEnabled }));
    if (!this.globalEnabled) {
      for (const extension of this.session.extensions.getAllExtensions()) this.session.extensions.removeExtension(extension.id);
    } else {
      for (const record of [...this.records.values()]) if (record.enabled && !this.session.extensions.getExtension(record.id)) {
        try { await this.session.extensions.loadExtension(record.path, { allowFileAccess: false }); }
        catch (error) { record.error = error.message; }
      }
    }
    this.save(); this.emit('change');
  }
  setActionAnchor(id, rect) {
    if (!this.records.has(id) || !rect || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key]))) return;
    this.actionAnchor = { id, rect: { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: Math.max(1, Math.min(500, rect.width)), height: Math.max(1, Math.min(100, rect.height)) } };
  }
  async launch(id, tabId, anchor) {
    const extension = this.session.extensions.getExtension(id);
    if (!extension) throw new Error('此扩展未启用');
    this.security.grantActiveTab(id, tabId);
    let popupPath = extension.manifest.action?.default_popup || extension.manifest.browser_action?.default_popup || extension.manifest.page_action?.default_popup || '';
    try {
      const state = await this.window.webContents.executeJavaScript('window.browserAction.getState(' + JSON.stringify(this.partition) + ')');
      const action = state.actions.find(action => action.id === id);
      if (action) popupPath = action.tabs?.[tabId]?.popup ?? action.popup ?? popupPath;
    } catch { /* use the validated manifest's popup */ }
    if (!popupPath) {
      const details = { eventType: 'click', extensionId: id, tabId, alignment: 'bottom left', anchorRect: anchor };
      await this.window.webContents.executeJavaScript('window.browserAction.activate(' + JSON.stringify(this.partition) + ',' + JSON.stringify(details) + ')');
      return;
    }
    let workerTask;
    if (extension.manifest.background?.service_worker) {
      try { const worker = await this.session.serviceWorkers.startWorkerForScope('chrome-extension://' + id + '/'); workerTask = worker.startTask(); } catch { /* popup can still provide an error/settings UI */ }
    }
    const url = new URL(popupPath, 'chrome-extension://' + id + '/');
    if (url.protocol !== 'chrome-extension:' || url.hostname !== id) throw new Error('扩展弹窗地址无效');
    if (this.popupWindow && !this.popupWindow.isDestroyed()) this.popupWindow.destroy();
    const popup = new BrowserWindow({ width: 380, height: 450, parent: this.window, show: false, frame: false, resizable: false, minimizable: false, maximizable: false, skipTaskbar: true, title: extension.name,
      webPreferences: { session: this.session, sandbox: true, contextIsolation: true, nodeIntegration: false, enablePreferredSizeMode: true } });
    this.popupWindow = popup;
    popup.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) this.bridge.emit('open-external-tab', url); return { action: 'deny' }; });
    popup.on('blur', () => { if (!popup.isDestroyed()) popup.destroy(); });
    popup.on('closed', () => { workerTask?.end(); if (this.popupWindow === popup) this.popupWindow = null; });
    const ready = popup.loadURL(url.href);
    this.setActionAnchor(id, anchor);
    await this.sizePopup({ extensionId: id, browserWindow: popup, whenReady: () => ready, isDestroyed: () => popup.isDestroyed(), setSize: size => { if (!popup.isDestroyed()) popup.setContentSize(size.width, size.height); } });
    if (!popup.isDestroyed()) popup.show();
  }
  async remove(id) {
    const record = this.records.get(id); if (!record) return;
    const result = await this.prompt({ kind: 'remove-extension', title: '移除扩展', message: '移除「' + record.name + '」？', confirmLabel: '移除' });
    if (!result.accepted) return;
    this.session.extensions.removeExtension(id); this.records.delete(id); this.save(); this.emit('change');
    // Developer directories belong to the user; only remove owned packages.
    if (record.source !== 'unpacked' && (record.path.startsWith(path.join(this.directory, 'local-extensions') + path.sep) || record.path.startsWith(this.webStorePath + path.sep))) fs.rmSync(record.path, { recursive: true, force: true });
  }
  async update() {
    for (const record of [...this.records.values()].filter(record => record.source === 'webstore' && record.enabled)) await this.installFromStore({ input: record.id, market: record.market || 'chrome' }, true);
    this.emit('change');
  }
  refreshTab(web) { if (!web.isDestroyed()) this.bridge.api.tabs.createTabDetails(web); }
  moveTab(web, window) {
    const store = this.bridge.ctx.store, old = store.tabToWindow.get(web), oldIndex = store.tabDetailsCache.get(web.id)?.index;
    store.addWindow(window); store.tabToWindow.set(web, window);
    if (store.windowToActiveTab.get(old) === web) store.windowToActiveTab.delete(old);
    this.refreshTab(web);
    this.bridge.ctx.router.broadcastEvent('tabs.onDetached', web.id, { oldWindowId: old?.id, oldPosition: oldIndex });
    this.bridge.ctx.router.broadcastEvent('tabs.onAttached', web.id, { newWindowId: window.id, newPosition: store.tabDetailsCache.get(web.id)?.index });
  }
  allowedURL(url) {
    try { const parsed = new URL(url); return parsed.protocol === 'chrome-extension:' && !!this.session.extensions.getExtension(parsed.hostname); } catch { return false; }
  }
}
module.exports = { ExtensionManager };
