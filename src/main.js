const { app, BrowserWindow, WebContentsView, ipcMain, Menu, dialog, shell, session, nativeTheme, protocol } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { scopedIPC } = require('./scoped-ipc');
const { GROUP_COLORS, splitBounds } = require('./workspace-model');
const { HOME, SETTINGS, EXTENSIONS, DEFAULT_SETTINGS, resolveAddress, resolveWebsite, isWebUrl, isViewSourceUrl, isInternalUrl, sanitizeSettings, recentSites } = require('./core');
const { Store } = require('./store');
const { DownloadManager } = require('./downloads');
const { ExtensionManager } = require('./extensions');
const { setSessionPartitionResolver } = require('electron-chrome-extensions');
const { PrivateProtection } = require('./private-protection');
const { SitePermissions, secureOrigin } = require('./site-permissions');
const { addressCandidates } = require('./address-candidates');
const { SearchSuggestions, searchCandidates } = require('./search-suggestions');
const { BrowserImporter, TYPES: IMPORT_TYPES } = require('./browser-import');
const { DownloadHistory, fileIdentity } = require('./download-history');
const { parseBookmarkHTML, exportBookmarkHTML } = require('./bookmarks');
const { externalURLs, registerBrowser, defaultStatus } = require('./default-browser');
const { cleanupPrivateDirectories, createPrivateDirectory, removePrivateDirectory, watchPrivateCleanup } = require('./private-sessions');
const { websiteIcon, fileIcon } = require('./images');
const { observeRequests } = require('./network-metadata');
const { Prompts } = require('./prompts');
const { BrowsingData } = require('./browsing-data');
const { Popovers } = require('./popovers');
const { ModalLayer } = require('./modal-layer');
const { ContextMenus } = require('./context-menu');
const { contextMenuItems } = require('./context-menu-model');
const { PageTools } = require('./page-tools');
const { markDownloadedFile } = require('./download-origin');
const { AppearanceAssets } = require('./appearance-assets');
const { PasswordManager } = require('./password-manager');
const { Compatibility } = require('./compatibility');
const { originOf, storageScript } = require('./compatibility-model');
const { REGIONS, ICONS, DEFAULT_APPEARANCE, patchAppearance, sanitizeAppearance } = require('./ui/appearance-model');

protocol.registerSchemesAsPrivileged([{ scheme: 'luna-asset', privileges: { standard: true, secure: true } }]);

const customProfile = process.env.LUNA_USER_DATA || process.env.LUMA_USER_DATA;
const profile = customProfile ? path.resolve(customProfile) : path.join(app.getPath('appData'), 'luna');
if (!customProfile && !fs.existsSync(profile)) {
  const previous = path.join(app.getPath('appData'), 'Luma');
  if (fs.existsSync(previous)) {
    try { fs.cpSync(previous, profile, { recursive: true }); }
    catch { /* use existing partial copy; old profile is left intact */ }
  }
}
app.setPath('userData', profile);
app.setName('luna');
if (process.platform === 'win32') app.setAppUserModelId('luna.browser');
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
const launchURLs = externalURLs(process.argv);
const browsers = new Set(), services = new Map(), closedSessions = [];
let quitRequest = null, quitting = false;
let sharedStore, sharedAssets, sharedExtensions, sharedVault, sharedImporter, privateContext, extensionsReady, tabSequence = 0;
const privateSessionsRoot = path.join(profile, 'private-sessions');
const extensionPartitions = new Map();
setSessionPartitionResolver(partition => {
  if (partition.startsWith('luna-private-')) return extensionPartitions.get(partition);
  return session.fromPartition(partition);
});
function privateBrowser(context) {
  const focused = BrowserWindow.getFocusedWindow();
  return [...browsers].find(browser => browser.isPrivate && browser.webSession === context.session && !browser.window.isDestroyed() && (browser.window === focused || browser.window.getChildWindows().includes(focused)))
    || [...browsers].find(browser => browser.isPrivate && browser.webSession === context.session && !browser.window.isDestroyed());
}
function emptyExtensions() { return { records: new Map(), snapshot: () => [], globalEnabled: false, allowedURL: () => false, contextMenuItems: async () => [], bridge: { selectTab() {}, addTab() {}, removeTab() {}, getURLOverrides: () => ({}) } }; }
function ownerOf(web) { return [...browsers].find(browser => [...browser.tabs.values()].some(tab => tab.view.webContents === web)); }
function focusedBrowser() { const focused = BrowserWindow.getFocusedWindow(); return [...browsers].find(browser => !browser.isPrivate && !browser.window.isDestroyed() && (browser.window === focused || browser.window.getChildWindows().includes(focused))) || [...browsers].find(browser => !browser.isPrivate && !browser.window.isDestroyed()); }
function broadcast() { for (const browser of browsers) { browser.updateAppearance(); browser.sendState(); } }
app.on('second-instance', (_, argv) => {
  const urls = externalURLs(argv), browser = focusedBrowser();
  if (!browser) { launchURLs.push(...urls); if (app.isReady()) createBrowser({ urls: launchURLs.splice(0, 20) }).catch(console.error); return; }
  browser.window.show(); if (browser.window.isMinimized()) browser.window.restore(); browser.window.focus();
  for (const url of urls) browser.createTab(url);
});
app.on('open-url', (event, value) => {
  event.preventDefault(); const urls = externalURLs([value]); if (!urls.length) return;
  if (!app.isReady()) { launchURLs.push(...urls); return; }
  const browser = focusedBrowser();
  if (browser) { browser.window.show(); browser.window.focus(); for (const url of urls) browser.createTab(url); }
  else { launchURLs.push(...urls); if (app.isReady()) createBrowser({ urls: launchURLs.splice(0, 20) }).catch(console.error); }
});
async function createBrowser(options = {}) {
if (browsers.size >= 12) throw new Error('最多打开 12 个浏览器窗口');
const isPrivate = options.private === true;
if (isPrivate && !privateContext) {
  await extensionsReady;
  // Re-check after awaiting restoration: another window can have initialized it.
  if (!privateContext) {
  const extensionStorage = !!sharedExtensions?.globalEnabled && [...(sharedExtensions?.records.values() || [])].some(record => record.enabled && record.allowIncognito === true && record.incognitoSupported !== false);
  const directory = createPrivateDirectory(privateSessionsRoot);
  if (extensionStorage) watchPrivateCleanup(privateSessionsRoot, app.isPackaged ? path.join(process.resourcesPath, 'luna-private-cleanup.exe') : path.join(__dirname, 'native', 'luna-private-cleanup.exe'));
  const transient = new Store(directory);
  transient.data = { ...structuredClone(sharedStore.data), history: [], session: [], sessionWindows: [], siteActivity: {}, siteSettings: {}, cookieTimes: {}, icons: {} };
  transient.data.settings.savePasswords = false; transient.data.settings.autofillPasswords = false;
  transient.save = () => {};
  transient.toggleBookmark = (...args) => { sharedStore.toggleBookmark(...args); transient.data.bookmarks = sharedStore.data.bookmarks; broadcast(); };
  const partition = 'luna-private-' + randomUUID();
  privateContext = { session: extensionStorage ? session.fromPath(path.join(directory, 'session'), { cache: false }) : session.fromPartition(partition, { cache: false }), store: transient, directory, partition, extensionStorage, protection: new PrivateProtection() };
  extensionPartitions.set(partition, privateContext.session);
  }
}
const context = isPrivate ? privateContext : null;
const webSession = isPrivate ? privateContext.session : session.fromPartition('persist:luma-web');
const directory = isPrivate ? privateContext.directory : app.getPath('userData');
let window, store = isPrivate ? privateContext.store : sharedStore, activeId, overlay = false, updateTimer;
let downloadManager, extensionManager, nativeTimer, closing = false;
let registeringTab = false;
let prompts, browsingData, closePending = false, clearingPromise = null, importingPromise = null, modalOpen = false;
let popovers;
let modalLayer;
let contextMenus, pageTools;
let appearanceAssets = sharedAssets;
let passwordManager;
let compatibility;
let sitePermissions;
let lastWindowIcon = null;
let bounds = { x: 0, y: 144, width: 1200, height: 600 };
const tabs = new Map();
let downloads = new Map();
let downloadHistory;
const suggestionService = new SearchSuggestions((url, options) => session.fromPartition('luna-search-suggestions', { cache: false }).fetch(url, options));
let suggestionRequest = 0;
const closedTabs = [];
let controller, split = null;
let suggestions = { query: '', items: [], selected: -1, filter: 'all', phrases: [] };
const groups = new Map();
const MENU_ACTIONS = new Set(['ie-mode','new-tab','new-window','private-window','groups','split','bookmarks','history','downloads','extensions','passwords','clear-data','print','translate-page','screenshot','find','save-page','reading-page','qr','screenshot-full','source','devtools','settings','shortcuts','about','close','edge-store','chrome-store','zoom-out','zoom-in','zoom-reset','fullscreen']);

function snapshot() {
  if (isPrivate) { store.data.bookmarks = sharedStore.data.bookmarks; store.data.bookmarkFolders = sharedStore.data.bookmarkFolders; }
  return {
    tabs: [...tabs.values()].filter(tab => tab.view.webContents && !tab.view.webContents.isDestroyed()).map(tab => ({
      id: tab.id, title: tab.title, url: tab.url, loading: tab.loading, pinned: tab.pinned === true, muted: tab.view.webContents.isAudioMuted(), audible: tab.view.webContents.isCurrentlyAudible(), dragKey: tab.dragKey,
      favicon: tab.favicon, webContentsId: tab.view.webContents.id,
      error: tab.error, canBack: tab.ie ? tab.ie.canBack === true : tab.view.webContents.navigationHistory.canGoBack(),
      canForward: tab.ie ? tab.ie.canForward === true : tab.view.webContents.navigationHistory.canGoForward(),
      zoom: tab.ie ? tab.ie.zoom || 100 : Math.round(tab.view.webContents.getZoomFactor() * 100), groupId: tab.groupId || null,
      compatibility: compatibility?.status(tab),
    })),
    activeId, bookmarks: store.data.bookmarks, bookmarkFolders: store.data.bookmarkFolders, history: store.data.history,
    shortcuts: store.data.shortcuts, recentSites: recentSites(isPrivate ? [] : store.data.history, store.data.shortcuts),
    private: isPrivate, platform: process.platform, windowId: window.id, groups: [...groups.values()], split,
    importWelcomeSeen: store.data.importWelcomeSeen,
    siteInfo: sitePermissions && isWebUrl(tabs.get(activeId)?.url) ? { tabId: activeId, origin: new URL(tabs.get(activeId).url).origin,
      secure: tabs.get(activeId).url.startsWith('https:') && !tabs.get(activeId).error, legacy: !!tabs.get(activeId).ie,
      security: tabs.get(activeId).security || null, permissions: sitePermissions.snapshot(new URL(tabs.get(activeId).url).origin) } : null,
    privateProtection: isPrivate ? { ...context.protection.snapshot(tabs.get(activeId)?.view.webContents), extensionStorage: context.extensionStorage } : null,
    settings: store.data.settings, dark: nativeTheme.shouldUseDarkColors,
    downloadPath: store.data.settings.downloadPath || app.getPath('downloads'),
    version: app.getVersion(), chromium: process.versions.chrome,
    icons: store.data.icons,
    extensions: extensionManager?.snapshot() || [], extensionInstalling: extensionManager?.installing || false,
    extensionsEnabled: extensionManager?.globalEnabled !== false,
    extensionInstallState: extensionManager?.installState || null,
    downloads: [...(downloadManager?.snapshot() || []), ...[...downloads.values()].map(({ item, file, lastReceived, lastTime, ...entry }) => entry),
      ...[...(downloadHistory?.records.values() || [])].filter(entry => !downloads.has(entry.id)).map(({ file, fingerprint, ...entry }) => entry)].sort((a, b) => a.createdAt - b.createdAt),
    maximized: window.isMaximized(),
    fullscreen: window.isFullScreen(), windowWidth: window.getContentSize()[0],
    prompt: prompts?.active?.view || null,
    popover: popovers?.kind || null,
    addressSuggestions: suggestions,
    windowTargets: [...browsers].filter(browser => browser !== controller && browser.webSession === webSession && !browser.window.isDestroyed()).map(browser => ({ id: browser.window.id, title: browser.tabs.get(browser.activeId)?.title || 'luna', count: browser.tabs.size })),
    passwords: passwordManager && !tabs.get(activeId)?.ie ? { ...passwordManager.summary(tabs.get(activeId)?.view.webContents && !tabs.get(activeId).view.webContents.isDestroyed() ? tabs.get(activeId) : undefined), fieldPopup: popovers?.kind === 'passwords' && popovers.anchor?.field === true } : null,
  };
}
function sendState() {
  if (controller) { for (const browser of browsers) browser.queueState(); }
  else queueState();
}
function queueState() {
  if (closing || !window || window.isDestroyed()) return;
  if (updateTimer) return;
  updateTimer = setTimeout(() => {
    updateTimer = null;
    if (!closing && window && !window.isDestroyed()) { const state = snapshot(); window.webContents.send('browser:state', state); popovers?.state(state); }
  }, 25);
}
function toast(message) {
  if (window && !window.isDestroyed()) window.webContents.send('browser:notice', message);
  else [...browsers].find(browser => browser.webSession === webSession)?.notice(message);
}
function layout() {
  if (closing || !window || window.isDestroyed()) return;
  const [width, height] = window.getContentSize();
  const safe = { x: 0, y: Math.min(bounds.y, height), width, height: Math.max(0, Math.min(bounds.height, height - bounds.y)) };
  const panes = split ? splitBounds(safe, split.ratio) : null;
  for (const tab of tabs.values()) {
    if (!tab.view.webContents || tab.view.webContents.isDestroyed()) continue;
    const side = split?.leftId === tab.id ? 0 : split?.rightId === tab.id ? 1 : -1;
    const rectangle = panes && side >= 0 ? panes[side] : safe;
    const visible = (split ? side >= 0 : tab.id === activeId) && !isInternalUrl(tab.url) && !tab.error;
    tab.view.setBounds(rectangle);
    tab.view.setVisible(visible && !tab.ie);
    tab.ie?.layout(rectangle,visible);
  }
}
function activateTab(id) {
  if (!tabs.has(id)) return;
  contextMenus?.close(true);
  popovers?.close(true);
  suggestionService.cancel(); suggestionRequest++;
  activeId = id;
  if (split && ![split.leftId, split.rightId].includes(id)) split = null;
  extensionManager?.bridge.selectTab(tabs.get(id).view.webContents);
  layout();
  const tab = tabs.get(id);
  if (tab.ie) tab.ie.request('focus').catch(()=>{});
  else if (!isInternalUrl(tab.url) && !tab.error && !overlay) tab.view.webContents.focus();
  else window.webContents.focus();
  sendState();
}
function reloadTab(tab) {
  if (!tab || isInternalUrl(tab.url)) return;
  if (isPrivate) context.protection.reset(tab.view.webContents);
  if (tab.ie) { (tab.error?compatibility.navigateTab(tab,tab.url):tab.ie.request('reload')).catch(error=>toast(error.message)); return; }
  if (tab.error) navigate(tab, tab.url);
  else { tab.view.webContents.reload(); sendState(); }
}
function navigate(tab, input) {
  if (!tab) return;
  if (isPrivate && input === EXTENSIONS) { toast('请在普通窗口中管理扩展程序'); input = HOME; }
  contextMenus?.close(true);
  popovers?.close(true);
  suggestionService.cancel(); suggestionRequest++;
  const extensionOverride = input === HOME && !isPrivate ? extensionManager?.bridge.getURLOverrides().newtab : null;
  const url = extensionManager?.allowedURL(extensionOverride || input) ? extensionOverride || input : resolveAddress(input, store.data.settings.searchEngine);
  if (tab.ie) { compatibility.navigateTab(tab,url).catch(error=>toast(error.message)); return; }
  tab.error = null;
  tab.sourceMode = isViewSourceUrl(url);
  tab.url = url;
  if (split && [split.leftId, split.rightId].includes(tab.id) && !isWebUrl(url)) split = null;
  tab.iconRequest = (tab.iconRequest || 0) + 1;
  tab.favicon = isWebUrl(url) ? store.data.icons[new URL(url).origin] || '' : '';
  if (isInternalUrl(url)) {
    tab.view.webContents.stop();
    tab.title = url === SETTINGS ? '设置' : url === EXTENSIONS ? '扩展程序' : '新标签页';
    tab.loading = false;
    window.webContents.focus();
  } else {
    tab.loading = true;
    if (isPrivate) {
      context.protection.reset(tab.view.webContents);
      Promise.all([tab.protectionReady, context.extensionsReady]).then(() => {
        if (!closing && tabs.get(tab.id) === tab && tab.url === url && !tab.view.webContents.isDestroyed()) return tab.view.webContents.loadURL(url);
      }).catch(error => { if (!closing && tabs.get(tab.id) === tab) { tab.loading = false; tab.error = { code: 'PRIVATE_PROTECTION', description: '无痕保护未能启动：' + error.message }; sendState(); } });
    } else tab.view.webContents.loadURL(url).catch(() => {});
  }
  layout();
  sendState();
}
function createTab(input = HOME, active = true) {
  if (tabs.size >= 30) { toast('最多打开 30 个标签页，请先关闭部分标签。'); return; }
  const previousActive = activeId;
  const view = new WebContentsView({ webPreferences: {
    session: webSession, nodeIntegration: false, contextIsolation: true,
    // Permit sandboxed preloads to receive IPC in subframes; page worlds still
    // have no Node integration, and the password handler checks every ancestor.
    nodeIntegrationInSubFrames: true,
    sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
  } });
  const id = ++tabSequence;
  const tab = { id, view, title: '新标签页', url: HOME, loading: false, error: null, favicon: '', iconRequest: 0, pendingSaveAs: new Map(), dragKey: randomUUID() };
  tabs.set(id, tab);
  if (active || !previousActive) activeId = id;
  if (active && split) split = null;
  window.contentView.addChildView(view);
  const web = view.webContents;
  web.setUserAgent(web.session.getUserAgent().replace(/\s(?:Electron|luna|Luma)\/[\d.]+/gi, ''));
  tab.requests = observeRequests(web);
  if (isPrivate) {
    tab.initializingProtection = true;
    tab.protectionReady = web.loadURL('about:blank').then(() => context.protection.attach(web)).finally(() => { tab.initializingProtection = false; });
    tab.protectionReady.catch(() => {});
  }
  registeringTab = true;
  try { extensionManager?.bridge.addTab(web, window); } finally { registeringTab = false; }
  const allowedURL = url => ownerOf(web)?.allowedURL(url);
  web.setWindowOpenHandler(({ url }) => {
    const owner = ownerOf(web);
    if (allowedURL(url)) owner.createTab(url);
    else owner?.notice('此链接使用了暂不支持的协议。');
    return { action: 'deny' };
  });
  web.on('will-navigate', (event, url) => { if (!allowedURL(url)) event.preventDefault(); });
  web.on('will-redirect', (event, url) => { if (!allowedURL(url)) event.preventDefault(); });
  for (const type of ['focus', 'devtools-closed', 'did-start-navigation', 'did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated', 'page-favicon-updated', 'did-finish-load', 'did-fail-load', 'render-process-gone', 'found-in-page', 'context-menu', 'media-started-playing', 'media-paused']) {
    web.on(type, (...args) => { ownerOf(web)?.tabEvent(tab, type, args).catch(error => ownerOf(web)?.notice(error.message)); });
  }
  web.on('before-input-event', (...args) => ownerOf(web)?.handleShortcut(...args));
  web.debugger.on('message', (_, method, params) => {
    if (method === 'Network.responseReceived' && params.type === 'Document') {
      const response = params.response; tab.securityCandidates ||= new Map();
      tab.securityCandidates.set(response.url, { url: response.url, protocol: response.securityDetails?.protocol || response.protocol, ...response.securityDetails });
      if (tab.securityCandidates.size > 10) tab.securityCandidates.delete(tab.securityCandidates.keys().next().value);
      if (response.url === web.getURL()) { tab.security = tab.securityCandidates.get(response.url); ownerOf(web)?.sendState(); }
    }
  });
  if (active) activeId = id;
  if (active) extensionManager?.bridge.selectTab(web);
  else if (previousActive && tabs.has(previousActive)) { activeId = previousActive; extensionManager?.bridge.selectTab(tabs.get(previousActive).view.webContents); }
  navigate(tab, input);
  return id;
}
async function tabEvent(tab, type, args) {
  const web = tab.view.webContents;
  if (closing || !web || web.isDestroyed() || tabs.get(tab.id) !== tab) return;
  if (type === 'focus') { if (split && [split.leftId, split.rightId].includes(tab.id) && activeId !== tab.id) { activeId = tab.id; passwordManager?.popupClosed(); extensionManager?.bridge.selectTab(web); sendState(); } return; }
  if (type === 'devtools-closed' && isPrivate) {
    // The native DevTools frontend is still being destroyed inside this event.
    // Reattaching CDP from that stack can abort Electron on Windows.
    await new Promise(resolve => setImmediate(resolve));
    if (closing || web.isDestroyed() || tabs.get(tab.id) !== tab || web.isDevToolsOpened()) return;
    if (!web.debugger.isAttached()) web.debugger.attach('1.3');
    tab.protectionReady = context.protection.attach(web); await tab.protectionReady; reloadTab(tab); sendState(); return;
  }
  if (tab.ie || tab.initializingProtection) return;
  if (type === 'did-start-navigation') {
    const [, url, inPage, main] = args;
    if (main && !inPage) prompts?.cancelWhere(prompt => prompt.kind === 'site-permission' && prompt.permissionTarget === web.id);
    if (tab.id === activeId && popovers?.kind === 'passwords' && popovers.anchor?.field) popovers.close(true);
    if (main && controller.allowedURL(url) && isInternalUrl(tab.url)) { tab.url = url; tab.error = null; layout(); sendState(); }
  } else if (type === 'did-start-loading') { if (!isInternalUrl(tab.url)) tab.loading = true; sendState(); }
  else if (type === 'did-stop-loading') { tab.loading = false; sendState(); }
  else if (type === 'did-navigate' || type === 'did-navigate-in-page') {
    if (type === 'did-navigate-in-page' && !args[2]) return;
    let url = args[1]; if (!controller.allowedURL(url) || isInternalUrl(tab.url)) return;
    if (isViewSourceUrl(web.getURL())) url = web.getURL(); else if (tab.sourceMode && isWebUrl(url)) url = 'view-source:' + url;
    if (hostOrigin(tab.url) !== hostOrigin(url)) { tab.favicon = isWebUrl(url) ? store.data.icons[hostOrigin(url)] || '' : ''; tab.iconRequest++; }
    tab.url = url; tab.security = tab.securityCandidates?.get(url) || null; tab.error = null;
    if (isWebUrl(url)) web.setZoomFactor(store.data.siteSettings[new URL(url).origin]?.zoomFactor || 1);
    if (type === 'did-navigate-in-page') recordVisit(tab); layout(); sendState();
  } else if (type === 'page-title-updated') { if (!isInternalUrl(tab.url)) tab.title = args[1] || tab.url; sendState(); }
  else if (type === 'page-favicon-updated') { const url = args[1].find(url => /^https?:\/\//i.test(url) || /^data:image\//i.test(url)); if (url) refreshFavicon(tab, url); }
  else if (type === 'did-finish-load') {
    if (isInternalUrl(tab.url) || tab.error) return;
    if (tab.pendingIEStorage) {
      const storage = tab.pendingIEStorage; delete tab.pendingIEStorage;
      if (originOf(web.getURL()) === storage.origin) { try { if (await web.executeJavaScript(storageScript(storage))) { web.reload(); return; } } catch { toast('网站存储同步未完成，请重新登录此网站。'); } }
    }
    tab.title = web.getTitle() || tab.url; recordVisit(tab); if (!tab.favicon && isWebUrl(tab.url)) refreshFavicon(tab, new URL('/favicon.ico', tab.url).href); sendState();
  } else if (type === 'did-fail-load') {
    const [, code, description, url, main] = args; if (!main || code === -3 || isInternalUrl(tab.url)) return;
    tab.loading = false; tab.error = { code, description, url }; tab.title = '页面未能打开'; layout(); sendState();
  } else if (type === 'render-process-gone') { tab.error = { description: '页面进程已退出，请重新加载。', code: 'CRASH' }; tab.loading = false; layout(); sendState(); }
  else if (type === 'found-in-page') { const result = args[1]; if (tab.id === activeId) window.webContents.send('browser:find-result', { matches: result.matches, active: result.activeMatchOrdinal }); }
  else if (type === 'context-menu') {
    if (prompts?.active || modalOpen) return;
    const params = args[1], pageURL = tab.url; popovers.close(true);
    const extensions = await extensionManager.contextMenuItems(web, params);
    if (web.isDestroyed() || ownerOf(web) !== controller || tab.id !== activeId || pageURL !== tab.url || prompts?.active || modalOpen) return;
    const items = contextMenuItems(params, { canBack: web.navigationHistory.canGoBack(), canForward: web.navigationHistory.canGoForward(), pageURL: tab.url, engine: store.data.settings.searchEngine, extensions });
    await contextMenus.open(web, params, items, action => pageTools.run(tab, action, params), tab.view.getBounds());
  } else sendState();
}
function hostOrigin(url) { try { return new URL(url).origin; } catch { return ''; } }
function orderTabs(id, beforeId) {
  const moving = tabs.get(id); if (!moving) return;
  const previous = [...tabs.values()], list = previous.filter(tab => tab !== moving), before = id === beforeId ? previous.indexOf(moving) : list.findIndex(tab => tab.id === beforeId);
  list.splice(before < 0 ? list.length : before, 0, moving); list.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  tabs.clear(); for (const tab of list) tabs.set(tab.id, tab);
  for (const tab of list) extensionManager?.refreshTab?.(tab.view.webContents); sendState();
}
function detachTab(tab) {
  popovers.close(true); contextMenus.close(true); passwordManager?.forget(tab.id);
  if (split && [split.leftId, split.rightId].includes(tab.id)) split = null;
  window.contentView.removeChildView(tab.view); tabs.delete(tab.id); delete tab.groupId;
  for (const [id] of groups) if (![...tabs.values()].some(member => member.groupId === id)) groups.delete(id);
  if (activeId === tab.id) activeId = [...tabs.keys()].at(-1);
  if (!tabs.size) createTab(); else activateTab(activeId);
}
function receiveTab(tab, beforeId) {
  tabs.set(tab.id, tab); window.contentView.addChildView(tab.view);
  extensionManager?.moveTab?.(tab.view.webContents, window); orderTabs(tab.id, beforeId); activateTab(tab.id); window.show(); window.focus();
}
async function moveTab(tab, targetId, beforeId) {
  if (!tab || modalOpen || prompts?.active) throw new Error('请先关闭当前弹窗');
  if (tab.loading || tab.initializingProtection) throw new Error('请等网页加载完成后移动标签');
  let target = targetId ? [...browsers].find(browser => browser.window.id === targetId) : null;
  if (targetId && (!target || target.webSession !== webSession)) throw new Error('标签只能移动到同一浏览会话的窗口');
  if (target?.window.isDestroyed() || target?.tabs.size >= 30 || target?.prompts.active) throw new Error('目标窗口暂不能接收标签');
  if (target === controller) { orderTabs(tab.id, beforeId); return; }
  const legacy = !!tab.ie; if (legacy) await compatibility.closeTab(tab);
  const fresh = !target; if (fresh) target = await createBrowser({ private: isPrivate });
  if (closing || tabs.get(tab.id) !== tab || !target.canReceiveTab()) throw new Error('窗口状态已变化，标签未移动');
  const blank = fresh ? [...target.tabs.values()][0] : null;
  detachTab(tab); target.receiveTab(tab, beforeId); if (blank && target.tabs.size > 1) target.closeTab(blank.id);
  if (legacy) await target.compatibility.enter(tab, tab.url); sendState();
}
async function tabAction(value) {
  const tab = tabs.get(Number(value?.id)); if (!tab) throw new Error('标签页已关闭');
  switch (value.action) {
    case 'pin': tab.pinned = !tab.pinned; if (tab.pinned) delete tab.groupId; for (const [id] of groups) if (![...tabs.values()].some(tab => tab.groupId === id)) groups.delete(id); orderTabs(tab.id, [...tabs.keys()][0]); break;
    case 'mute': if (tab.ie) throw new Error('IE 模式由 Windows 控制声音'); tab.view.webContents.setAudioMuted(!tab.view.webContents.isAudioMuted()); break;
    case 'duplicate': createTab(tab.url); break;
    case 'close-others': case 'close-right': {
      const list = [...tabs.values()], index = list.indexOf(tab);
      for (const other of list) if (other !== tab && !other.pinned && (value.action === 'close-others' || list.indexOf(other) > index)) closeTab(other.id); break;
    }
    case 'move': await moveTab(tab, Number(value.windowId) || null); break;
    case 'reorder': orderTabs(tab.id, Number(value.beforeId)); break;
    default: throw new Error('无效的标签操作');
  }
  sendState();
}
async function refreshFavicon(tab, url) {
  const version = ++tab.iconRequest, pageURL = tab.url;
  try {
    const image = await websiteIcon(tab.view.webContents.session, url);
    if (!image || version !== tab.iconRequest || tab.url !== pageURL || !tabs.has(tab.id)) return;
    tab.favicon = image;
    if (isWebUrl(pageURL)) {
      store.data.icons[new URL(pageURL).origin] = image;
      const keys = Object.keys(store.data.icons); if (keys.length > 100) delete store.data.icons[keys[0]];
      store.save();
    }
    sendState();
  } catch { /* an unavailable favicon falls back to the globe */ }
}
function recordVisit(tab) {
  if (!closing && tabs.has(tab.id) && !isPrivate && isWebUrl(tab.url) && !tab.error) {
    try { store.data.siteActivity[new URL(tab.url).origin] = Date.now(); store.visit(tab.url, tab.title); } catch { toast('无法保存浏览数据，请检查磁盘空间。'); }
  }
}
function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  prompts?.cancelWhere(prompt => prompt.kind === 'site-permission' && prompt.permissionTarget === tab.view.webContents.id);
  contextMenus?.close(true);
  compatibility?.closeTab(tab).catch(error=>toast(error.message));
  if (split && [split.leftId, split.rightId].includes(id)) {
    const other = split.leftId === id ? split.rightId : split.leftId;
    split = null; if (activeId === id) activeId = other;
  }
  if (isWebUrl(tab.url)) { closedTabs.push(tab.url); if (closedTabs.length > 20) closedTabs.shift(); }
  const ids = [...tabs.keys()];
  const index = ids.indexOf(id);
  window.contentView.removeChildView(tab.view);
  tabs.delete(id);
  if (tab.groupId && ![...tabs.values()].some(other => other.groupId === tab.groupId)) groups.delete(tab.groupId);
  passwordManager?.forget(id);
  extensionManager?.bridge.removeTab(tab.view.webContents);
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  if (closing) return;
  if (!tabs.size) createTab();
  else if (activeId === id) activateTab(ids[index + 1] || ids[index - 1]);
  layout();
  sendState();
}
function endSplit() { split = null; layout(); const tab = tabs.get(activeId); if(tab?.ie)tab.ie.request('focus').catch(()=>{});else tab?.view.webContents.focus(); sendState(); }
function startSplit(value) {
  if (!value || typeof value !== 'object') throw new Error('请选择两个网页');
  function choice(id, url) {
    const tab = tabs.get(Number(id));
    if (tab && isWebUrl(tab.url)) return tab.id;
    const resolved = typeof url === 'string' && url.length <= 8192 ? resolveWebsite(url) : null;
    if (!resolved) throw new Error('请输入有效的网页地址');
    return resolved;
  }
  const leftChoice = choice(value.leftId, value.leftURL), rightChoice = choice(value.rightId, value.rightURL);
  if (leftChoice === rightChoice && typeof leftChoice === 'number') throw new Error('请选择不同的标签页');
  const required = Number(typeof leftChoice === 'string') + Number(typeof rightChoice === 'string');
  if (tabs.size + required > 30) throw new Error('标签页数量已达上限');
  const leftId = typeof leftChoice === 'number' ? leftChoice : createTab(leftChoice, false);
  const rightId = typeof rightChoice === 'number' ? rightChoice : createTab(rightChoice, false);
  split = { leftId, rightId, ratio: 0.5 }; activateTab(leftId);
}
async function groupAction(value) {
  if (!value || typeof value !== 'object') throw new Error('无效的分组操作');
  const group = groups.get(value.id);
  const members = group ? [...tabs.values()].filter(tab => tab.groupId === group.id) : [];
  switch (value.action) {
    case 'create': {
      const ids = Array.isArray(value.tabIds) ? value.tabIds.map(Number).filter(id => tabs.has(id) && !tabs.get(id).pinned) : [activeId].filter(id => !tabs.get(id)?.pinned);
      if (!ids.length) throw new Error('请选择要分组的标签页');
      const id = randomUUID(); groups.set(id, { id, name: String(value.name || '标签页组').trim().slice(0, 60) || '标签页组', color: GROUP_COLORS.includes(value.color) ? value.color : 'gray', collapsed: false });
      for (const tabId of ids) tabs.get(tabId).groupId = id;
      break;
    }
    case 'update': if (group) { if (typeof value.name === 'string') group.name = value.name.trim().slice(0, 60) || '标签页组'; if (GROUP_COLORS.includes(value.color)) group.color = value.color; } break;
    case 'collapse': if (group) group.collapsed = !group.collapsed; break;
    case 'add': if (group) { const tab = tabs.get(Number(value.tabId)); if (tab && !tab.pinned) tab.groupId = group.id; group.collapsed = false; } break;
    case 'remove': { const tab = tabs.get(Number(value.tabId)); if (tab) delete tab.groupId; break; }
    case 'ungroup': for (const tab of members) delete tab.groupId; groups.delete(value.id); break;
    case 'close': {
      if (!members.length) return;
      const result = await prompts.ask({ kind: 'close-group', title: '关闭标签页组', message: '关闭「' + group.name + '」的 ' + members.length + ' 个标签页？', confirmLabel: '关闭标签页组' });
      if (result.accepted) for (const tab of members) closeTab(tab.id);
      break;
    }
    default: throw new Error('无效的分组操作');
  }
  for (const [id] of groups) if (![...tabs.values()].some(tab => tab.groupId === id)) groups.delete(id);
  layout(); sendState();
}
function sessionLayout() {
  const list = [...tabs.values()], index = id => list.findIndex(tab => tab.id === id);
  return { urls: list.map(tab => tab.url), activeIndex: Math.max(0, index(activeId)),
    pinned: list.flatMap((tab, i) => tab.pinned ? [i] : []), muted: list.flatMap((tab, i) => tab.view.webContents.isAudioMuted() ? [i] : []),
    groups: [...groups.values()].map(group => ({ name: group.name, color: group.color, collapsed: group.collapsed, indices: list.flatMap((tab, i) => tab.groupId === group.id ? [i] : []) })),
    split: split ? { left: index(split.leftId), right: index(split.rightId), ratio: split.ratio } : null,
    ...(list.some(tab=>tab.ie) ? { ie: list.flatMap((tab,i)=>tab.ie?[i]:[]) } : {}) };
}
function restoreLayout(value, ids) {
  for (const index of value?.pinned || []) if (tabs.has(ids[index])) tabs.get(ids[index]).pinned = true;
  for (const index of value?.muted || []) tabs.get(ids[index])?.view.webContents.setAudioMuted(true);
  for (const group of value?.groups || []) {
    const id = randomUUID(); groups.set(id, { id, name: group.name, color: group.color, collapsed: group.collapsed });
    for (const index of group.indices) if (tabs.has(ids[index])) tabs.get(ids[index]).groupId = id;
  }
  if (value?.split && ids[value.split.left] && ids[value.split.right]) split = { leftId: ids[value.split.left], rightId: ids[value.split.right], ratio: value.split.ratio };
  for (const index of value?.ie || []) if(tabs.has(ids[index]))compatibility.enter(tabs.get(ids[index])).catch(error=>toast(error.message));
}
function handleShortcut(event, input) {
  if (modalLayer?.window && !modalLayer.window.isDestroyed() && modalLayer.window.isVisible() && (modalOpen || prompts?.active)) { event.preventDefault(); modalLayer.window.focus(); return; }
  if (closing) { event.preventDefault(); return; }
  if (input.type !== 'keyDown') return;
  const ctrl = input.control || input.meta;
  const key = input.key.toLowerCase();
   if ((prompts?.active || modalOpen) && ((ctrl && ['l', 'n', 't', 'w', 'r', 'd', 'h', 'j', 'f', 's', 'p', 'u', 'i', 'o', 'tab', '+', '=', '-', '0', 'delete'].includes(key)) || input.alt && ['arrowleft', 'arrowright'].includes(key))) { event.preventDefault(); return; }
  let handled = true;
  const tab = tabs.get(activeId);
  if (input.alt && key === 'f4') { window.close(); event.preventDefault(); return; }
  if (process.platform === 'darwin' && input.meta && key === ',') { openSettings(); event.preventDefault(); return; }
  if (ctrl && key === 'l') { window.focus(); window.webContents.focus(); window.webContents.send('browser:shortcut', 'address'); }
  else if (ctrl && key === 'n') { popovers.close(true); createBrowser({ private: input.shift || isPrivate }).catch(error => toast(error.message)); }
  else if (ctrl && input.shift && key === 'delete') showClearData();
  else if (ctrl && key === 't' && input.shift) createTab(closedTabs.pop() || HOME);
  else if (ctrl && key === 't') { createTab(); window.webContents.focus(); window.webContents.send('browser:shortcut', 'address'); }
  else if (ctrl && key === 'w') { if (tabs.size === 1) window.close(); else closeTab(activeId); }
  else if ((ctrl && key === 'r') || key === 'f5') reloadTab(tab);
  else if (ctrl && key === 'd') bookmark(tab);
  else if (ctrl && key === (process.platform === 'darwin' ? 'y' : 'h')) window.webContents.send('browser:shortcut', 'history');
  else if (ctrl && key === 'j') window.webContents.send('browser:shortcut', 'downloads');
  else if (ctrl && input.shift && key === 'o') window.webContents.send('browser:shortcut', 'bookmarks');
  else if (key === 'f11') { popovers.close(true); window.setFullScreen(!window.isFullScreen()); }
  else if (key === 'escape' && window.isFullScreen() && !popovers.kind && !prompts?.active && !modalOpen) window.setFullScreen(false);
  else if (ctrl && input.shift && key === 's') runPageTool(tab, 'screenshot');
  else if (ctrl && key === 's') { if (isWebUrl(tab.url)) runPageTool(tab, 'save-page'); }
  else if (ctrl && key === 'p') { if (!isInternalUrl(tab.url)) runPageTool(tab, 'print'); }
  else if (ctrl && key === 'u') { if (isWebUrl(tab.url)) runPageTool(tab, 'source'); }
  else if (ctrl && input.shift && key === 'i') { if (!tab.ie && !isInternalUrl(tab.url)) tab.view.webContents.toggleDevTools(); }
  else if (ctrl && key === 'f') { window.webContents.focus(); window.webContents.send('browser:shortcut', 'find'); }
  else if (ctrl && key === 'tab') {
    const ids = [...tabs.keys()];
    activateTab(ids[(ids.indexOf(activeId) + (input.shift ? ids.length - 1 : 1)) % ids.length]);
  } else if (ctrl && /^[1-9]$/.test(key)) {
    const ids = [...tabs.keys()]; activateTab(key === '9' ? ids.at(-1) : ids[Number(key) - 1]);
  } else if (process.platform === 'darwin' && input.meta && key === '[' && tab.view.webContents.navigationHistory.canGoBack()) tab.view.webContents.navigationHistory.goBack();
  else if (process.platform === 'darwin' && input.meta && key === ']' && tab.view.webContents.navigationHistory.canGoForward()) tab.view.webContents.navigationHistory.goForward();
  else if (input.alt && key === 'arrowleft' && tab.ie) tab.ie.request('back').catch(()=>{});
  else if (input.alt && key === 'arrowright' && tab.ie) tab.ie.request('forward').catch(()=>{});
  else if (input.alt && key === 'arrowleft' && tab.view.webContents.navigationHistory.canGoBack()) tab.view.webContents.navigationHistory.goBack();
  else if (input.alt && key === 'arrowright' && tab.view.webContents.navigationHistory.canGoForward()) tab.view.webContents.navigationHistory.goForward();
  else if (ctrl && ['+', '=', '-', '0'].includes(key)) {
    changeZoom(tab, key === '0' ? 'reset' : key === '-' ? 'out' : 'in');
  } else handled = false;
  if (handled) event.preventDefault();
}
function runPageTool(tab, action) {
  if (!tab || isInternalUrl(tab.url) || tab.error) return;
  contextMenus?.close(true); popovers?.close(true);
  (tab.ie ? runIETool(tab,action) : pageTools.run(tab, action)).catch(error => toast('无法执行此操作：' + error.message));
}
async function runIETool(tab, action) {
  if(action === 'print') return tab.ie.request('print');
  if(action === 'save-page') return tab.ie.request('save');
  if(action === 'screenshot') return pageTools.show({kind:'screenshot',title:'IE 网页截图',pageTitle:tab.title,url:tab.url,image:await tab.ie.request('capture')});
  if(['qr','source','translate-page'].includes(action))return pageTools.run(tab,action);
  if(action === 'reading-page') {
    const text=await tab.ie.request('evaluate',{code:'document.body ? document.body.innerText : ""'});
    return pageTools.show({kind:'reading',title:'阅读模式',heading:tab.title,url:tab.url,blocks:String(text||'').slice(0,500000).split(/\n+/).filter(Boolean).map(text=>({tag:'p',text}))});
  }
  throw new Error('此工具仅支持普通 Chromium 模式');
}
function bookmark(tab) {
  if (!tab || !isWebUrl(tab.url) || tab.error) return;
  try { store.toggleBookmark(tab.url, tab.title); sendState(); } catch { toast('无法保存收藏。'); }
}
function openSettings() {
  const existing = [...tabs.values()].find(tab => tab.url === SETTINGS);
  if (existing) activateTab(existing.id);
  else createTab(SETTINGS);
}
function openSettingsSection(section) { openSettings(); window.webContents.send('browser:settings-section', section); }
function changeZoom(tab, action) {
  if (!tab || isInternalUrl(tab.url) || tab.error) return;
  const web = tab.view.webContents;
  if(tab.ie) {const previous=tab.ie.zoom||100;tab.ie.zoom=action==='reset'?100:Math.min(200,Math.max(50,previous+(action==='out'?-10:10)));tab.ie.request('zoom',{zoom:tab.ie.zoom}).catch(error=>toast(error.message));sendState();return;}
  web.setZoomFactor(action === 'reset' ? 1 : Math.min(2, Math.max(0.5, Math.round((web.getZoomFactor() + (action === 'out' ? -0.1 : 0.1)) * 100) / 100)));
  if (!isPrivate && isWebUrl(tab.url)) { const origin = new URL(tab.url).origin; store.data.siteSettings[origin] = { ...store.data.siteSettings[origin], time: Date.now(), zoomFactor: web.getZoomFactor() }; store.save(); }
  sendState();
}
async function browserMenuAction(action) {
  if (!MENU_ACTIONS.has(action)) throw new Error('无效的菜单操作');
  if (modalOpen || prompts?.active) throw new Error('请先关闭当前弹窗');
  if (isPrivate && ['passwords','edge-store','chrome-store'].includes(action)) throw new Error('请在普通窗口中管理密码或安装扩展');
  if (isPrivate && action === 'extensions') { const target = focusedBrowser() || await createBrowser(); target.window.show(); target.window.focus(); target.openExtensions(); return; }
  const tab = tabs.get(activeId);
  if (['zoom-in','zoom-out','zoom-reset'].includes(action)) { changeZoom(tab, action.slice(5)); return; }
  if (['bookmarks','history','downloads'].includes(action)) {
    const selector = action === 'bookmarks' ? 'panel-button' : action === 'history' ? 'history-button' : 'downloads-button';
    const anchor = await window.webContents.executeJavaScript(`(()=>{const r=document.getElementById(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
    await popovers.open(action, anchor); return;
  }
  popovers.close(true);
  switch (action) {
    case 'ie-mode':
      passwordManager?.forget(tab?.id);
      try {if(tab?.ie)await compatibility.leave(tab);else await compatibility.enter(tab);}catch(error){toast(error.message);throw error;}
      break;
    case 'new-tab': createTab(); break;
    case 'new-window': await createBrowser({ private: isPrivate }); break;
    case 'private-window': await createBrowser({ private: true }); break;
    case 'groups': window.webContents.focus(); window.webContents.send('browser:shortcut', 'groups'); break;
    case 'split': if (split) endSplit(); else { window.webContents.focus(); window.webContents.send('browser:shortcut', 'split'); } break;
    case 'fullscreen': window.setFullScreen(!window.isFullScreen()); break;
    case 'extensions': openExtensions(); break;
    case 'passwords': openSettingsSection('passwords'); break;
    case 'settings': openSettings(); break;
    case 'about': openSettingsSection('about'); break;
    case 'shortcuts': window.webContents.focus(); window.webContents.send('browser:shortcut','help'); break;
    case 'clear-data': showClearData(); break;
    case 'find': window.webContents.focus(); window.webContents.send('browser:shortcut','find'); break;
    case 'edge-store': createTab('https://microsoftedge.microsoft.com/addons/'); break;
    case 'chrome-store': createTab('https://chromewebstore.google.com/'); break;
    case 'close': window.close(); break;
    case 'devtools': if (tab && !tab.ie && isWebUrl(tab.url) && !tab.error) tab.view.webContents.toggleDevTools(); break;
    default: if (tab && isWebUrl(tab.url) && !tab.error) await (tab.ie?runIETool(tab,action):pageTools.run(tab,action)); else toast('请先打开网页');
  }
  sendState();
}
function openExtensions() {
  const existing = [...tabs.values()].find(tab => tab.url === EXTENSIONS);
  if (existing) activateTab(existing.id); else createTab(EXTENSIONS);
}
function applySettings(value) {
  const previous = store.data.settings;
  store.data.settings = sanitizeSettings(value);
  if (isPrivate) { store.data.settings.savePasswords = false; store.data.settings.autofillPasswords = false; }
  if (!isPrivate) nativeTheme.themeSource = store.data.settings.theme;
  store.save();
  if (previous.savePasswords !== store.data.settings.savePasswords || previous.autofillPasswords !== store.data.settings.autofillPasswords) passwordManager?.settingsChanged();
  if (previous.searchSuggestions !== store.data.settings.searchSuggestions || previous.searchEngine !== store.data.settings.searchEngine) {
    suggestionService.cancel(); suggestionRequest++; suggestions.phrases = []; suggestions.selected = -1;
    suggestions.items = searchCandidates(suggestions.query, { tabs: [...tabs.values()], bookmarks: store.data.bookmarks, history: isPrivate ? [] : store.data.history }, store.data.settings.searchEngine, [], suggestions.filter);
  }
  updateAppearanceWindows();
  sendState();
}
function updateAppearanceWindows() {
  if (!store || !window || window.isDestroyed()) return;
  const appearance = store.data.settings.appearance;
  contextMenus?.updateAppearance(); pageTools?.updateAppearance(appearance, nativeTheme.shouldUseDarkColors);
  const iconKey = appearance.icons.custom.brand || '';
  if (iconKey !== lastWindowIcon) {
    const icon = appearanceAssets?.windowIcon(iconKey);
    if (icon && !icon.isEmpty()) { if (process.platform === 'darwin') app.dock?.setIcon(icon); else window.setIcon(icon); lastWindowIcon = iconKey; }
  }
}

function downloadName(input) { return path.basename(String(input || 'download.bin')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180) || 'download.bin'; }
async function saveDownload(tab, url, suggestedName) {
  const pageURL = tab.url;
  const name = downloadName(suggestedName || decodeURIComponent(new URL(url).pathname.split('/').at(-1) || 'download.bin'));
  const selected = await dialog.showSaveDialog(window, { title: '另存为', defaultPath: path.join(store.data.settings.downloadPath || app.getPath('downloads'), name) });
  if (selected.canceled || !selected.filePath || tab.view.webContents.isDestroyed() || tab.url !== pageURL) return;
  for (const [pending, value] of tab.pendingSaveAs) if (Date.now() - value.time > 60000) tab.pendingSaveAs.delete(pending);
  tab.pendingSaveAs.set(url, { time: Date.now(), file: selected.filePath });
  try { tab.view.webContents.downloadURL(url); }
  catch (error) { tab.pendingSaveAs.delete(url); throw error; }
}
async function chooseDownloadFile(name, existing) {
  if (existing) return { file: existing, overwrite: true };
  const directory = store.data.settings.downloadPath || app.getPath('downloads');
  if (store.data.settings.askDownload) {
    const result = await dialog.showSaveDialog(window, { title: '保存下载文件', defaultPath: path.join(directory, name) });
    return result.canceled || !result.filePath ? null : { file: result.filePath, overwrite: true };
  }
  return { file: downloadManager.uniquePath(path.join(directory, name)), overwrite: false };
}
async function beginManagedDownload(url, name, headers = {}, existing) {
  const selected = await chooseDownloadFile(name, existing);
  if (!selected) return;
  const id = downloadManager.create({ url, name, headers, ...selected, threads: store.data.settings.downloadThreads });
  const job = downloadManager.jobs.get(id);
  job.windowId = window.id;
  fileIcon('', name).then(icon => { job.icon = icon; sendState(); }).catch(() => {});
  return id;
}
function configureDownloads(webSession) {
  const existing = services.get(webSession);
  if (existing) { downloadManager = existing.manager; downloads = existing.downloads; downloadHistory = existing.history; downloadManager.on('change', sendState); return; }
  downloadHistory = new DownloadHistory(directory, !isPrivate);
  downloadManager = new DownloadManager({ directory,
    fetch: (url, options) => webSession.fetch(url, { ...options, credentials: 'include' }),
    onComplete: async job => {
      job.icon = await fileIcon(job.file, job.name);
      (ownerOfDownload(job) || [...browsers].find(browser => browser.webSession === webSession))?.notice('下载完成：' + job.name);
      if (job.completion === 'open') { const error = await shell.openPath(job.file); if (error) toast('无法打开文件：' + error); }
      else if (job.completion === 'reveal') shell.showItemInFolder(job.file);
    },
  });
  services.set(webSession, { manager: downloadManager, downloads, history: downloadHistory });
  downloadManager.on('change', sendState);
  nativeTimer = setInterval(() => {
    let active = false;
    for (const entry of downloads.values()) {
      if (!['progressing', 'paused'].includes(entry.status)) continue;
      try {
        entry.received = entry.item.getReceivedBytes(); entry.total = entry.item.getTotalBytes();
        const now = Date.now(), speed = Math.max(0, entry.received - entry.lastReceived) * 1000 / Math.max(1, now - entry.lastTime);
        entry.speed = entry.status === 'progressing' ? Math.round(entry.speed ? entry.speed * 0.5 + speed * 0.5 : speed) : 0;
        entry.eta = entry.speed > 0 && entry.total ? Math.ceil(Math.max(0, entry.total - entry.received) / entry.speed) : null;
        entry.resumable = entry.item.canResume() || entry.item.isPaused();
        entry.threads[0] = { id: 1, start: 0, end: entry.total ? entry.total - 1 : null, received: entry.received, status: entry.status };
        entry.lastReceived = entry.received; entry.lastTime = now; active = true;
      } catch { /* item is no longer owned by Chromium */ }
    }
    if (active) sendState();
  }, 400);
  nativeTimer.unref();
  services.get(webSession).timer = nativeTimer;
  webSession.on('will-download', (event, item, owner) => {
    const browser = ownerOf(owner);
    if (!browser) { event.preventDefault(); return; }
    browser.nativeDownload(event, item, owner);
  });
}
function ownerOfDownload(job) { return [...browsers].find(browser => browser.window.id === job.windowId); }
function handleNativeDownload(event, item, owner) {
    const url = item.getURLChain().at(-1) || item.getURL();
    const name = downloadName(item.getFilename());
    const tab = [...tabs.values()].find(tab => tab.view.webContents === owner);
    const metadata = tab?.requests.get(url);
    const savedURL = item.getURLChain().find(url => tab?.pendingSaveAs.has(url));
    const selectedSave = savedURL && tab.pendingSaveAs.get(savedURL);
    const forceSave = selectedSave && Date.now() - selectedSave.time < 60000;
    if (savedURL) tab.pendingSaveAs.delete(savedURL);
    // Downloads based on POST, blob URLs, unknown requests, and small files keep
    // Chromium's native transfer so request semantics are preserved.
    if (!forceSave && store.data.settings.parallelDownloads && isWebUrl(url) && item.getTotalBytes() >= 512 * 1024 && metadata?.method === 'GET' && Date.now() - metadata.time < 30000) {
      const savedPath = item.getSavePath();
      event.preventDefault();
      beginManagedDownload(url, name, metadata.headers, savedPath).catch(error => toast('无法开始下载：' + error.message));
      return;
    }
    if (downloads.size >= 100) {
      for (const [id, entry] of downloads) { if (['completed', 'cancelled'].includes(entry.status)) { downloads.delete(id); break; } }
    }
    const id = 'native-' + Date.now() + '-' + downloads.size;
    const entry = { id, name, url, item, file: '', received: 0, total: item.getTotalBytes(), status: 'waiting', managed: false, mode: 'native', threads: [], resumable: false, speed: 0, eta: null, speedLimit: 0, completion: 'none', error: '', icon: '', createdAt: Date.now(), lastTime: Date.now(), lastReceived: 0 };
    downloads.set(id, entry);
    fileIcon('', name).then(icon => { entry.icon = icon; sendState(); }).catch(() => {});
    item.on('updated', (_, state) => {
      entry.received = item.getReceivedBytes();
      entry.total = item.getTotalBytes();
      entry.status = state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing';
      sendState();
    });
    item.once('done', async (_, state) => {
      if (entry.removed) return;
      entry.status = state; entry.file = item.getSavePath(); entry.received = item.getReceivedBytes(); entry.total = item.getTotalBytes();
      entry.speed = 0; entry.eta = null;
      entry.threads = [{ id: 1, start: 0, end: entry.total ? entry.total - 1 : null, received: entry.received, status: state }];
      downloadHistory.import([entry]);
      if (state === 'completed') {
        entry.icon = await fileIcon(entry.file, entry.name); toast('下载完成：' + name);
        if (entry.completion === 'open') { const error = await shell.openPath(entry.file); if (error) toast(error); }
        else if (entry.completion === 'reveal') shell.showItemInFolder(entry.file);
      }
      sendState();
    });
    sendState();
    // Electron owns the save dialog and starts the download after a path is chosen.
    const directory = store.data.settings.downloadPath || app.getPath('downloads');
    if (forceSave) item.setSavePath(selectedSave.file);
    else if (store.data.settings.askDownload) item.setSaveDialogOptions({ title: '保存下载文件', defaultPath: path.join(directory, name) });
    else {
      try {
        fs.mkdirSync(directory, { recursive: true });
        const extension = path.extname(name), stem = path.basename(name, extension);
        let destination = path.join(directory, path.basename(name)), suffix = 1;
        while (fs.existsSync(destination)) destination = path.join(directory, `${stem} (${suffix++})${extension}`);
        item.setSavePath(destination);
      } catch { item.cancel(); toast('无法保存到下载目录，请在设置中更换位置。'); }
    }
}
function showClearData(types = ['history', 'cookies', 'cache', 'downloads'], range = 'hour') {
  window.webContents.send('browser:clear-data', { types, range }); window.webContents.focus();
}
function destroyTabs() {
  const owned = [...tabs.values()].map(tab => ({ view: tab.view, web: tab.view.webContents }));
  // Unregister tabs before close emits navigation/focus/destroyed events. A View's
  // webContents property becomes undefined after its contents are destroyed.
  tabs.clear(); groups.clear(); split = null; activeId = null;
  for (const {view, web} of owned) {
    if (window && !window.isDestroyed()) window.contentView.removeChildView(view);
    if (web && !web.isDestroyed()) web.close();
  }
}
async function requestClose() {
  if (closing) return true;
  if (closePending) return false;
  closePending = true;
  contextMenus?.close(true);
  popovers?.close(true);
  try {
    let result;
    const activeDownloads = snapshot().downloads.filter(entry => !entry.historical && !['completed', 'cancelled'].includes(entry.status)).length;
    if (tabs.size > 1 || activeDownloads) {
      result = await prompts.ask({ kind: 'close-browser', title: '关闭浏览器', message: '关闭这 ' + tabs.size + ' 个标签页？',
        detail: activeDownloads ? '还有 ' + activeDownloads + ' 个下载未完成。分段下载将暂停并保留进度；原生下载可能需要重新下载。' : '',
         confirmLabel: '关闭窗口', restore: isPrivate ? undefined : store.data.settings.startup === 'restore',
        tabs: [...tabs.values()].map(tab => ({ title: tab.title, url: tab.url, icon: tab.favicon })),
      });
      if (!result.accepted) return false;
    }
    closing = true;
    clearTimeout(updateTimer); updateTimer = null;
    const saved = [...tabs.values()];
    if (!isPrivate) {
      if (!result || result.restore) closedSessions.push(sessionLayout());
      const remaining = [...browsers].filter(browser => browser !== controller && !browser.isPrivate);
      store.data.sessionWindows = [...closedSessions, ...remaining.map(browser => browser.sessionLayout())].slice(-12);
      store.data.session = result && !result.restore ? [] : saved.map(tab => tab.url);
      store.data.sessionActive = Math.max(0, saved.findIndex(tab => tab.id === activeId));
      if (result) store.data.restoreOnce = store.data.sessionWindows.length > 0;
      store.save();
    }
    prompts.cancelAll();
    if (clearingPromise) await clearingPromise.catch(() => {});
    if (importingPromise) await importingPromise.catch(() => {});
    suggestionService.cancel();
    await Promise.all(saved.map(tab=>compatibility.closeTab(tab).catch(error=>toast(error.message))));
    const lastSessionWindow = ![...browsers].some(browser => browser !== controller && browser.webSession === webSession);
    if (lastSessionWindow) {
      if (isPrivate || browsers.size === 1) { clearInterval(services.get(webSession)?.timer); await downloadManager.shutdown(); }
      else await Promise.all([...downloadManager.jobs.values()].filter(job => job.running && job.status !== 'merging').map(job => downloadManager.action(job.id, 'pause')));
      if (isPrivate) {
        for (const entry of downloads.values()) if (['waiting','progressing','paused','interrupted'].includes(entry.status)) { try { entry.item.cancel(); } catch {} }
        // Drop the context before async cleanup so a newly opened private window
        // immediately gets a fresh partition rather than the closing session.
        const expired = context; if (privateContext === expired) privateContext = null;
        await expired.extensionsReady;
        expired.extensionManager?.dispose();
        expired.protection.removeAllListeners();
        extensionPartitions.delete(expired.partition);
        destroyTabs();
        await webSession.clearStorageData(); await webSession.clearCache(); await webSession.closeAllConnections();
        webSession.flushStorageData();
        services.delete(webSession); await removePrivateDirectory(expired.directory);
      }
    }
    if (browsers.size === 1) for (const [otherSession, service] of services) if (otherSession !== webSession) { clearInterval(service.timer); await service.manager.shutdown(); }
    clearTimeout(updateTimer); updateTimer = null;
    destroyTabs();
    window?.close();
    return true;
   } catch (error) { closing = false; console.error('Window close failed:', error); toast('无法关闭浏览器：' + error.message); }
  finally { closePending = false; }
}

  configureDownloads(webSession);
  window = new BrowserWindow({ width: 1360, height: 900, minWidth: 760, minHeight: 560, frame: process.platform === 'darwin',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 14, y: 12 } } : {}),
    backgroundColor: '#ffffff', title: isPrivate ? 'luna · 无痕' : 'luna', show: false,
    icon: path.join(__dirname, 'ui', 'assets', 'app.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.bundle.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  popovers = new Popovers(window, path.join(__dirname, 'preload.bundle.js'), snapshot, sendState);
  modalLayer = new ModalLayer(window, layout);
  controller = { window, tabs, groups, isPrivate, webSession, popovers, createTab, activateTab, closeTab, navigate, openExtensions, queueState, sendState, notice: toast, updateAppearance: updateAppearanceWindows, nativeDownload: handleNativeDownload, sessionLayout, tabEvent, handleShortcut, receiveTab, detachTab, moveTab, close: requestClose,
    allowedURL: url => isWebUrl(url) || isViewSourceUrl(url) || extensionManager?.allowedURL(url), canReceiveTab: () => !closing && !modalOpen && !prompts?.active && tabs.size < 30,
    get compatibility() { return compatibility; },
    get activeId() { return activeId; }, get registeringTab() { return registeringTab; }, get prompts() { return prompts; } };
  browsers.add(controller);
  const ipcMain = scopedIPC(window, event => event.sender === window.webContents || popovers.owns(event.sender));
  popovers.handleShortcut = handleShortcut;
  contextMenus = new ContextMenus(window, () => nativeTheme.shouldUseDarkColors, toast, () => store.data.settings.appearance);
  pageTools = new PageTools({ parent: window, settings: () => store.data.settings, theme: () => nativeTheme.shouldUseDarkColors, createTab, notice: toast, bookmark, reload: reloadTab, saveDownload,
    find: () => { window.webContents.focus(); window.webContents.send('browser:shortcut', 'find'); } });
  updateAppearanceWindows();
  prompts = new Prompts((channel, payload) => { if (window && !window.isDestroyed()) window.webContents.send(channel, payload); }, () => { if (prompts?.active) { popovers.close(true); contextMenus.close(true); } layout(); if (prompts?.active && window && !window.isDestroyed()) window.webContents.focus(); sendState(); });
  compatibility = new Compatibility({parent:window,session:webSession,tabs,activeId:()=>activeId,changed:sendState,navigate,notice:toast,visit:recordVisit,layout,isPrivate,
    newTab:url=>{const id=createTab(HOME);const tab=tabs.get(id);if(tab)compatibility.enter(tab,url).catch(error=>toast(error.message));},
    shortcut:(type,value)=>{
      if(type==='activate-ie'&&tabs.has(value)){activeId=value;extensionManager?.bridge.selectTab(tabs.get(value).view.webContents);sendState();}
      else if(type==='native-key')handleShortcut({preventDefault(){}},{type:'keyDown',...value});
    }
  });
  if (!isPrivate) passwordManager = new PasswordManager({ directory: app.getPath('userData'), session: webSession, tabs, parent: window, vault: sharedVault,
    settings: () => store.data.settings, activeId: () => activeId, changed: sendState, prompt: options => prompts.ask(options), notice: toast,
    openPopup: anchor => {
      if (prompts?.active || modalOpen) return false;
      if (!anchor && popovers.kind === 'passwords' && !popovers.anchor?.field) return true;
      contextMenus.close(true); popovers.open('passwords', anchor || { x: window.getContentSize()[0] - 310, y: 48, width: 34, height: 36 }).catch(() => {}); return true;
    },
    closePopup: fieldOnly => { if (popovers.kind === 'passwords' && (!fieldOnly || popovers.anchor?.field)) popovers.close(true); },
    popupKey: key => { if (popovers.kind === 'passwords' && popovers.anchor?.field && popovers.window && !popovers.window.isDestroyed()) { if (key === 'Escape') popovers.close(true); else popovers.window.webContents.send('browser:password-key', key); } },
  });
  if (passwordManager) { sharedVault = passwordManager.vault; popovers.onFieldClose = () => passwordManager.popupClosed(); }
  const service = services.get(webSession);
  if (!service.permissions) service.permissions = new SitePermissions({ session: webSession, store, owner: ownerOf, changed: broadcast });
  sitePermissions = service.permissions;
  if (!service.browsingData) service.browsingData = new BrowsingData({ session: webSession, store, downloadManager, nativeDownloads: downloads, downloadHistory, tabs: {
    *values() { for (const browser of browsers) if (browser.webSession === webSession) yield* browser.tabs.values(); }
  }, passwordVault: passwordManager?.vault });
  browsingData = service.browsingData;
  if (isPrivate) {
    if (context.extensionStorage && !context.extensionManager) {
      context.extensionManager = new ExtensionManager({ directory, session: webSession, window, privateMode: true, partition: context.partition,
        createTab: async details => { const browser = [...browsers].find(b => b.webSession === webSession && b.window.id === details.windowId) || privateBrowser(context); if (!browser) throw new Error('无痕会话已关闭'); const id = browser.createTab(details.url || HOME, details.active !== false); return [browser.tabs.get(id).view.webContents, browser.window]; },
        selectTab: web => { const browser = ownerOf(web), tab = browser && [...browser.tabs.values()].find(t => t.view.webContents === web); if (browser?.webSession === webSession && tab && !browser.registeringTab && tab.id !== browser.activeId) browser.activateTab(tab.id); },
        removeTab: web => { const browser = ownerOf(web), tab = browser && [...browser.tabs.values()].find(t => t.view.webContents === web); if (browser?.webSession === webSession && tab) browser.closeTab(tab.id); },
         getTabDetails: web => { const browser = ownerOf(web), tab = browser && [...browser.tabs.values()].find(t => t.view.webContents === web); return tab ? { url: tab.url, title: tab.title, incognito: true, active: tab.id === browser.activeId, pinned: !!tab.pinned, index: [...browser.tabs.keys()].indexOf(tab.id), favIconUrl: tab.favicon } : {}; },
        createWindow: async details => (await createBrowser({ private: true, urls: Array.isArray(details.url) ? details.url : [details.url || HOME] })).window,
        removeWindow: target => { if ([...browsers].some(b => b.webSession === webSession && b.window === target)) target.close(); },
        trustedRenderer: event => event.type === 'frame' && event.senderFrame === event.sender.mainFrame && [...browsers].some(b => b.webSession === webSession && (event.sender === b.window.webContents || b.popovers.owns(event.sender))),
        prompt: options => privateBrowser(context)?.prompts.ask(options) || Promise.resolve({ accepted: false }),
      });
      Object.defineProperty(context.extensionManager, 'window', { get: () => privateBrowser(context)?.window || window });
      context.extensionManager.on('change', broadcast);
      context.extensionManager.bridge.on('open-external-tab', url => privateBrowser(context)?.createTab(url));
      context.extensionsReady = context.extensionManager.syncPrivate(sharedExtensions);
      context.extensionManager.on('unloaded', id => { for (const browser of browsers) if (browser.webSession === webSession) for (const tab of browser.tabs.values()) if (tab.url.startsWith('chrome-extension://' + id + '/')) browser.navigate(tab, HOME); });
    }
    extensionManager = context.extensionManager || emptyExtensions();
    context.protection.on('change', sendState);
    window.once('closed', () => context.protection.removeListener('change', sendState));
  } else {
    if (!sharedExtensions) {
      sharedExtensions = new ExtensionManager({ directory: app.getPath('userData'), session: webSession, window,
        createTab: async details => { const browser = [...browsers].find(b => b.window.id === details.windowId && !b.isPrivate) || focusedBrowser(); const id = browser.createTab(details.url || HOME, details.active !== false); return [browser.tabs.get(id).view.webContents, browser.window]; },
        selectTab: web => { const browser = ownerOf(web), tab = browser && [...browser.tabs.values()].find(tab => tab.view.webContents === web); if (tab && !browser.registeringTab && tab.id !== browser.activeId) browser.activateTab(tab.id); },
        removeTab: web => { const browser = ownerOf(web), tab = browser && [...browser.tabs.values()].find(tab => tab.view.webContents === web); if (tab) browser.closeTab(tab.id); },
        getTabDetails: web => { const browser = ownerOf(web), tab = browser && [...browser.tabs.values()].find(tab => tab.view.webContents === web); return tab ? { url: tab.url, title: tab.title, active: tab.id === browser.activeId, pinned: !!tab.pinned, index: [...browser.tabs.keys()].indexOf(tab.id), favIconUrl: tab.favicon } : {}; },
        createWindow: async details => { const browser = await createBrowser({ urls: Array.isArray(details.url) ? details.url : [details.url || HOME] }); return browser.window; },
        removeWindow: target => { const browser = [...browsers].find(b => b.window === target && !b.isPrivate); browser?.window.close(); },
        trustedRenderer: event => event.type === 'frame' && event.senderFrame === event.sender.mainFrame && [...browsers].some(b => !b.isPrivate && (event.sender === b.window.webContents || b.popovers.owns(event.sender))),
        prompt: options => focusedBrowser().prompts.ask(options),
      });
      Object.defineProperty(sharedExtensions, 'window', { get: () => focusedBrowser()?.window || window });
      sharedExtensions.on('change', () => {
        broadcast();
        if (privateContext?.extensionManager) {
          const current = privateContext;
          current.extensionsReady = (current.extensionsReady || Promise.resolve()).then(() => current.extensionManager.syncPrivate(sharedExtensions));
          current.extensionsReady.catch(error => privateBrowser(current)?.notice('无痕扩展同步失败：' + error.message));
        }
      });
      sharedExtensions.on('installed', name => focusedBrowser()?.notice('已安装扩展：' + name));
      sharedExtensions.on('unloaded', id => { for (const browser of browsers) if (!browser.isPrivate) for (const tab of browser.tabs.values()) { try { if (new URL(tab.url).protocol === 'chrome-extension:' && new URL(tab.url).hostname === id) browser.navigate(tab, HOME); } catch { /* internal page */ } } });
      extensionsReady = sharedExtensions.init().catch(error => focusedBrowser()?.notice('扩展恢复失败：' + error.message));
      sharedExtensions.bridge.on('open-external-tab', url => focusedBrowser()?.createTab(url));
    }
    extensionManager = sharedExtensions;
  }
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('before-input-event', handleShortcut);
  window.on('resize', () => { layout(); sendState(); });
  window.on('move', layout);
  window.on('maximize', sendState);
  window.on('unmaximize', sendState);
  window.on('enter-full-screen', sendState); window.on('leave-full-screen', sendState);
  window.on('close', event => {
    if (closing) return;
    event.preventDefault(); requestClose();
  });
  window.on('closed', () => { prompts.cancelAll(); downloadManager.removeListener('change', sendState); browsers.delete(controller); window = null; });
  ipcMain.handle('browser:prompt-response', (event, id, response) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted sender');
    return prompts.reply(id, response);
  });
  ipcMain.handle('browser:command', async (event, action, payload) => {
    const popupSender = popovers?.owns(event.sender);
    const popupActions = ['state', 'popover-open', 'popover-size', 'popover-close', 'browser-menu-action', 'extension-pin', 'extension-enable', 'extensions-enable', 'extension-remove', 'extension-options', 'extension-launch', 'extensions', 'extension-store', 'new-tab', 'navigate', 'download-action', 'new-download', 'remove-bookmark', 'clear-history', 'settings', 'password-settings', 'password-accept', 'password-never', 'password-dismiss', 'password-fill', 'clear-browsing-data', 'show-find', 'show-download-dialog', 'address-select', 'address-filter', 'bookmark-manager'];
    if (!window || event.senderFrame !== event.sender.mainFrame || (event.sender !== window.webContents && !(popupSender && popupActions.includes(action)))) throw new Error('Untrusted sender');
    const tab = tabs.get(activeId);
    if (isPrivate && (action.startsWith('password-') || action.startsWith('extension-') && !['extension-launch','extension-options','extension-action-anchor'].includes(action) || action === 'extensions-enable')) throw new Error('请在普通窗口中管理密码及扩展授权');
    if (isPrivate && action.startsWith('browser-import')) throw new Error('请在普通窗口中导入浏览器数据');
    if (closing && !['state','modal-state','overlay'].includes(action)) return;
    if (action === 'password-settings') { popovers.close(true); openSettings(); window.webContents.send('browser:shortcut', 'password-settings'); return; }
    if(tab?.ie&&['password-fill','password-accept','extension-launch'].includes(action))throw new Error('IE 模式不支持 Chromium 扩展或密码自动填充');
    if (typeof action === 'string' && action.startsWith('password-')) return passwordManager.command(action, payload, tab);
    if ((modalOpen || prompts?.active) && ['ie-mode','split-start','split-ratio','split-swap','split-exit','group-action','new-window','private-window'].includes(action)) throw new Error('请先关闭当前弹窗');
    switch (action) {
      case 'state': return snapshot();
      case 'dialog-snapshot': modalLayer.update(payload); return;
      case 'browser-import-list': return sharedImporter.list();
      case 'browser-import-dismiss': store.data.importWelcomeSeen = true; store.save(); sendState(); return;
      case 'browser-import-run': {
        if (importingPromise || sharedImporter.busy) throw new Error('正在导入，请等待完成');
        const source = sharedImporter.profiles.get(payload?.id), types = payload?.types;
        if (!source || !Array.isArray(types) || !types.length || types.some(type => !IMPORT_TYPES.includes(type))) throw new Error('请选择浏览器配置和数据类型');
        const names = { bookmarks: '收藏', history: '历史', downloads: '下载记录', passwords: '密码' };
        const confirmed = await prompts.ask({ kind: 'browser-import', title: '导入浏览器数据', message: '从 ' + source.browser + ' · ' + source.name + ' 导入 ' + types.map(type => names[type]).join('、') + '？', detail: '保留原浏览器数据和 Luna 中已有的记录。可解密的密码会重新加密保存到当前设备；受应用绑定保护的密码需使用 CSV。', confirmLabel: '导入' });
        if (!confirmed.accepted) return null;
        importingPromise = sharedImporter.read(source.id, types).then(data => {
          const result = { warnings: data.warnings, results: {} };
          for (const type of types) {
            if (!data.outcomes[type]) continue;
            try {
              if (type === 'bookmarks') result.results[type] = store.importBookmarks(data.bookmarks);
              if (type === 'history') result.results[type] = store.importHistory(data.history);
              if (type === 'downloads') result.results[type] = downloadHistory.import(data.downloads);
              if (type === 'passwords') { const summary = passwordManager.vault.import(data.passwords.entries); result.results[type] = { ...summary, skipped: summary.skipped + data.passwords.skipped + data.passwords.protectedCount, protectedCount: data.passwords.protectedCount }; }
            } catch (error) { result.warnings.push({ type, message: String(error.message).slice(0, 250) }); }
          }
          if (data.passwords) { for (const entry of data.passwords.entries) entry.password = ''; data.passwords.entries.length = 0; }
          store.data.importWelcomeSeen = true; store.save(); broadcast(); return result;
        });
        try { return await importingPromise; } finally { importingPromise = null; }
      }
      case 'default-browser-status': return { ...(process.platform === 'darwin' ? { isDefault: app.isDefaultProtocolClient('http') && app.isDefaultProtocolClient('https') } : await defaultStatus(process.execPath)), platform: process.platform, available: app.isPackaged && ['win32', 'darwin'].includes(process.platform) && !customProfile };
      case 'default-browser-register': {
        if (!app.isPackaged || customProfile || !['win32', 'darwin'].includes(process.platform)) throw new Error('请在正式成品中设置默认浏览器');
        if (process.platform === 'darwin') {
          app.setAsDefaultProtocolClient('http'); app.setAsDefaultProtocolClient('https');
          toast('请在系统提示中确认；也可在 macOS 系统设置的默认网页浏览器中选择 luna'); return;
        }
        await registerBrowser(process.execPath); await shell.openExternal('ms-settings:defaultapps'); toast('已注册 luna，请在 Windows 默认应用中选择 luna'); return;
      }
      case 'address-suggest': {
        if (typeof payload?.query !== 'string' || payload.query.length > 8192 || modalOpen || prompts?.active) return;
        const request = ++suggestionRequest; suggestionService.cancel();
        const local = () => ({ tabs: [...tabs.values()], bookmarks: store.data.bookmarks, history: isPrivate ? [] : store.data.history });
        const engine = store.data.settings.searchEngine;
        suggestions = { query: payload.query, selected: -1, filter: 'all', phrases: [], items: searchCandidates(payload.query, local(), engine) };
        if (suggestions.items.length) await popovers.open('address', payload.anchor); else if (popovers.kind === 'address') popovers.close(true);
        if (!isPrivate && store.data.settings.searchSuggestions && payload.query.trim()) {
          suggestionService.get(payload.query, engine).then(phrases => {
            if (request !== suggestionRequest || closing || suggestions.query !== payload.query || popovers.kind !== 'address' || suggestions.selected >= 0 || store.data.settings.searchEngine !== engine || !store.data.settings.searchSuggestions) return;
            suggestions.phrases = phrases; suggestions.items = searchCandidates(payload.query, local(), engine, phrases, suggestions.filter); sendState();
          });
        }
        sendState();
        return suggestions;
      }
      case 'address-filter': {
        if (!popupSender || popovers.kind !== 'address' || !['all', 'tab', 'bookmark', 'history'].includes(payload)) return;
        suggestions.filter = payload; suggestions.selected = -1;
        suggestions.items = searchCandidates(suggestions.query, { tabs: [...tabs.values()], bookmarks: store.data.bookmarks, history: isPrivate ? [] : store.data.history }, store.data.settings.searchEngine, suggestions.phrases, payload); break;
      }
      case 'address-key': {
        const key = typeof payload === 'string' ? payload : payload?.key;
        if (typeof payload === 'object' && payload.query !== suggestions.query) return false;
        if (popovers.kind !== 'address' || !['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(key)) return false;
        if (key === 'Escape') { suggestionService.cancel(); suggestionRequest++; popovers.close(true); return true; }
        if (key === 'Enter') {
          const selected = suggestions.items[suggestions.selected]; if (!selected) return false;
          popovers.close(true); if (selected.tabId && tabs.has(selected.tabId)) activateTab(selected.tabId); else navigate(tab, selected.url); return true;
        }
        if (!suggestions.items.length) return false;
        suggestions.selected = (suggestions.selected + (key === 'ArrowDown' ? 1 : suggestions.items.length - 1) + suggestions.items.length) % suggestions.items.length; sendState(); return true;
      }
      case 'address-select': {
        if (!popupSender || popovers.kind !== 'address' || payload?.query !== suggestions.query) return;
        const selected = payload.url ? suggestions.items.find(item => item.url === payload.url && item.type === payload.type) : suggestions.items[payload.index]; if (!selected) return;
        popovers.close(true); if (selected.tabId && tabs.has(selected.tabId)) activateTab(selected.tabId); else navigate(tab, selected.url); return;
      }
      case 'site-permission-set': {
        if (!tab || tab.id !== payload?.tabId || !secureOrigin(tab.url) || new URL(tab.url).origin !== payload.origin || tab.ie) throw new Error('网站已变化，请重新打开网站信息');
        sitePermissions.set(payload.origin, payload.key, payload.value); toast('权限已更新，重新加载网页后生效'); break;
      }
      case 'site-data-summary': {
        if (!tab || !isWebUrl(tab.url) || tab.id !== payload?.tabId || new URL(tab.url).origin !== payload.origin) throw new Error('网站已变化');
        return { cookies: (await webSession.cookies.get({ url: tab.url })).length };
      }
      case 'browser-menu-action': return browserMenuAction(payload);
      case 'ie-mode': return browserMenuAction('ie-mode');
      case 'private-protection-toggle':
        if (!isPrivate || typeof payload !== 'boolean' || !tab || !isWebUrl(tab.url)) throw new Error('请先打开无痕网页');
        if (payload && !context.protection.snapshot(tab.view.webContents).enabled) {
          if (tab.view.webContents.isDevToolsOpened()) throw new Error('请先关闭开发者工具，再恢复无痕拦截');
          if (!tab.view.webContents.debugger.isAttached()) { tab.view.webContents.debugger.attach('1.3'); await context.protection.attach(tab.view.webContents); }
        }
        context.protection.toggle(tab.view.webContents, payload); reloadTab(tab); break;
      case 'popover-open': contextMenus.close(true); await popovers.open(payload?.kind, payload?.anchor || popovers.anchor); return;
      case 'popover-close': if (popovers.kind === 'address') { suggestionService.cancel(); suggestionRequest++; } popovers.close(); return;
      case 'popover-size': if (popupSender) popovers.resize(payload); return;
      case 'show-find': popovers.close(true); window.webContents.send('browser:shortcut', 'find'); return;
      case 'show-download-dialog': popovers.close(true); window.webContents.send('browser:shortcut', 'new-download'); return;
      case 'new-tab': createTab(typeof payload === 'string' ? payload : HOME); break;
      case 'new-window': await createBrowser({ private: isPrivate }); break;
      case 'private-window': await createBrowser({ private: true }); break;
      case 'split-start': startSplit(payload); break;
      case 'split-exit': endSplit(); break;
      case 'split-ratio': if (split && Number.isFinite(payload)) { split.ratio = Math.min(0.75, Math.max(0.25, payload)); layout(); } break;
      case 'split-swap': if (split) { [split.leftId, split.rightId] = [split.rightId, split.leftId]; split.ratio = 1 - split.ratio; layout(); } break;
      case 'group-action': await groupAction(payload); break;
      case 'activate': activateTab(Number(payload)); break;
      case 'tab-action': await tabAction(payload); break;
      case 'tab-drop': {
        const source = [...browsers].find(browser => browser.window.id === payload?.windowId), moving = source?.tabs.get(payload?.id);
        if (!moving || moving.dragKey !== payload?.dragKey || source.webSession !== webSession) throw new Error('无法移动此标签');
        if (source === controller) orderTabs(moving.id, Number(payload.beforeId));
        else await source.moveTab(moving, window.id, Number(payload.beforeId)); break;
      }
      case 'close-tab': closeTab(Number(payload)); break;
      case 'navigate': if (typeof payload === 'string' && payload.length <= 8192) navigate(tab, payload); break;
      case 'home': navigate(tab, store.data.settings.homePage || HOME); break;
      case 'settings': openSettings(); break;
      case 'extensions': if (isPrivate) return browserMenuAction('extensions'); else openExtensions(); break;
      case 'extension-launch': {
        const record = extensionManager.records.get(payload?.id);
        if (!record || !extensionManager.session.extensions.getExtension(record.id)) return;
        const rect = popupSender ? popovers.toParentRect(payload.rect) : payload.rect;
        extensionManager.setActionAnchor(record.id, rect); popovers.close(true);
        await extensionManager.launch(record.id, tab.view.webContents.id, rect); return;
      }
      case 'extension-load-directory': await extensionManager.importDirectory(); break;
      case 'extension-install-package': await extensionManager.importPackage(); break;
      case 'extension-install-store': await extensionManager.installFromStore(payload); break;
      case 'extension-enable': await extensionManager.enable(payload?.id, payload?.enabled === true); break;
      case 'extension-incognito':
        if (typeof payload?.allowed !== 'boolean') throw new Error('无痕授权参数无效');
        if (await sharedExtensions.setIncognito(payload.id, payload.allowed) && payload.allowed) toast(privateContext && !privateContext.extensionStorage ? '授权已保存，关闭全部无痕窗口后重新打开生效' : '已允许在无痕会话中运行');
        break;
      case 'extension-pin': extensionManager.setPinned(payload?.id, payload?.pinned === true); break;
      case 'extensions-enable': await extensionManager.setGlobalEnabled(payload === true); toast(payload ? '扩展程序已启用' : '扩展程序已暂停，刷新网页后生效'); break;
      case 'extension-action-anchor': extensionManager.setActionAnchor(payload?.id, payload?.rect); return;
      case 'extension-remove': await extensionManager.remove(payload); break;
      case 'extension-update': await extensionManager.update(); break;
      case 'extension-options': {
        const record = extensionManager.records.get(payload);
        if (record?.options && extensionManager.session.extensions.getExtension(record.id)) createTab(new URL(record.options, 'chrome-extension://' + record.id + '/').href);
        break;
      }
      case 'extension-store': createTab(payload === 'chrome' ? 'https://chromewebstore.google.com/' : 'https://microsoftedge.microsoft.com/addons/'); break;
      case 'update-settings': {
        if (!payload || typeof payload !== 'object') break;
        const updates = { ...payload };
        delete updates.downloadPath;
        if (typeof updates.homePage === 'string' && updates.homePage.trim()) {
          const resolved = resolveWebsite(updates.homePage.trim());
          if (!resolved) throw new Error('请输入有效的主页网址。');
          updates.homePage = resolved;
        }
        applySettings({ ...store.data.settings, ...updates });
        return store.data.settings;
      }
      case 'appearance-update': {
        const appearance = patchAppearance(store.data.settings.appearance, payload);
        applySettings({ ...store.data.settings, appearance }); return appearance;
      }
      case 'appearance-choose-background': {
        if (!Object.hasOwn(REGIONS, payload) || !REGIONS[payload].image) throw new Error('此区域不支持背景图片');
        const image = await appearanceAssets.choose(window, 'background'); if (!image) return null;
        const appearance = patchAppearance(store.data.settings.appearance, { section: 'regions', key: payload, values: image });
        applySettings({ ...store.data.settings, appearance }); return appearance;
      }
      case 'appearance-choose-icon': {
        if (!Object.hasOwn(ICONS, payload)) throw new Error('未知的图标');
        const image = await appearanceAssets.choose(window, 'icon', payload === 'brand'); if (!image) return null;
        const appearance = sanitizeAppearance(store.data.settings.appearance); appearance.icons.custom[payload] = image.image;
        applySettings({ ...store.data.settings, appearance }); return appearance;
      }
      case 'appearance-reset-region': {
        if (!Object.hasOwn(REGIONS, payload)) throw new Error('未知的外观区域');
        const appearance = sanitizeAppearance(store.data.settings.appearance); appearance.regions[payload] = { ...DEFAULT_APPEARANCE.regions[payload] };
        applySettings({ ...store.data.settings, appearance }); return appearance;
      }
      case 'appearance-reset-icon': {
        if (!Object.hasOwn(ICONS, payload)) throw new Error('未知的图标');
        const appearance = sanitizeAppearance(store.data.settings.appearance); delete appearance.icons.custom[payload];
        applySettings({ ...store.data.settings, appearance }); return appearance;
      }
      case 'appearance-reset': {
        const selected = await prompts.ask({ kind: 'reset-appearance', title: '恢复默认外观', message: '恢复所有区域的默认外观？', detail: '自定义背景、颜色和图标将恢复默认。', confirmLabel: '恢复默认' });
        if (selected.accepted) { applySettings({ ...store.data.settings, appearance: DEFAULT_APPEARANCE }); return store.data.settings.appearance; }
        return null;
      }
      case 'choose-download-path': {
        const selected = await dialog.showOpenDialog(window, { title: '选择下载位置', defaultPath: store.data.settings.downloadPath || app.getPath('downloads'), properties: ['openDirectory', 'createDirectory'] });
        if (!selected.canceled && selected.filePaths[0]) applySettings({ ...store.data.settings, downloadPath: selected.filePaths[0] });
        break;
      }
      case 'reset-download-path': applySettings({ ...store.data.settings, downloadPath: '' }); break;
      case 'clear-cache': {
        showClearData(['cache'], 'all'); break;
      }
      case 'reset-settings': {
        const selected = await prompts.ask({ kind: 'reset-settings', title: '重置设置', message: '恢复默认设置？', detail: '收藏、历史和快捷方式会保留。', confirmLabel: '重置设置' });
        if (selected.accepted) applySettings(DEFAULT_SETTINGS);
        break;
      }
      case 'back': if(tab.ie)await tab.ie.request('back');else if (tab.view.webContents.navigationHistory.canGoBack()) { tab.error = null; tab.view.webContents.navigationHistory.goBack(); layout(); } break;
      case 'forward': if(tab.ie)await tab.ie.request('forward');else if (tab.view.webContents.navigationHistory.canGoForward()) { tab.error = null; tab.view.webContents.navigationHistory.goForward(); layout(); } break;
      case 'reload': reloadTab(tab); break;
      case 'stop': if(tab.ie)await tab.ie.request('stop');else tab.view.webContents.stop(); break;
      case 'bookmark': bookmark(tab); break;
      case 'bookmark-manager': popovers.close(true); window.webContents.send('browser:shortcut', { action: 'bookmark-manager' }); return;
      case 'bookmark-action': {
        const target = isPrivate ? sharedStore : store;
        if (['delete', 'folder-delete'].includes(payload?.action)) {
          const result = await prompts.ask({ kind: 'bookmark-delete', title: '删除收藏', message: payload.action === 'folder-delete' ? '删除此文件夹及其中的全部收藏？' : '删除此收藏？', confirmLabel: '删除' });
          if (!result.accepted) return;
        }
        target.bookmarkAction(payload); break;
      }
      case 'bookmark-import': {
        const selected = await dialog.showOpenDialog(window, { title: '导入浏览器书签 HTML', filters: [{ name: '书签 HTML', extensions: ['html', 'htm'] }], properties: ['openFile'] });
        if (selected.canceled || !selected.filePaths[0]) return null;
        const handle = await fs.promises.open(selected.filePaths[0], 'r'); let parsed;
        try {
          if ((await handle.stat()).size > 5 * 1024 * 1024) throw new Error('书签文件超过 5 MB');
          const buffer = Buffer.alloc(5 * 1024 * 1024 + 1); let length = 0;
          while (length < buffer.length) { const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length); if (!bytesRead) break; length += bytesRead; }
          parsed = parseBookmarkHTML(buffer.subarray(0, length).toString('utf8'));
        } finally { await handle.close(); }
        if (!parsed.bookmarks.length && !parsed.bookmarkFolders.length) throw new Error('文件中没有可导入的收藏');
        const result = await prompts.ask({ kind: 'bookmark-import', title: '导入收藏', message: '导入 ' + parsed.bookmarks.length + ' 条收藏和 ' + parsed.bookmarkFolders.length + ' 个文件夹？', detail: '已有网址会保留，危险协议和无效链接会跳过。', confirmLabel: '导入' });
        if (!result.accepted) return null;
        const imported = (isPrivate ? sharedStore : store).importBookmarks(parsed); sendState(); return imported;
      }
      case 'bookmark-export': {
        const selected = await dialog.showSaveDialog(window, { title: '导出收藏', defaultPath: path.join(app.getPath('downloads'), 'luna-bookmarks.html'), filters: [{ name: '书签 HTML', extensions: ['html'] }] });
        if (selected.canceled || !selected.filePath) return null;
        await fs.promises.writeFile(selected.filePath, exportBookmarkHTML(sharedStore.data), 'utf8'); toast('收藏已导出'); return { success: true };
      }
      case 'add-bookmark': {
        const url = typeof payload?.url === 'string' ? resolveWebsite(payload.url) : null;
        if (!isWebUrl(url)) throw new Error('请输入有效的网站地址。');
        if (!store.data.bookmarks.some(entry => entry.url === url)) store.toggleBookmark(url, String(payload.title || new URL(url).hostname).slice(0, 300));
        break;
      }
      case 'add-shortcut': {
        const url = typeof payload?.url === 'string' ? resolveWebsite(payload.url) : null;
        if (!isWebUrl(url)) throw new Error('请输入有效的网站地址。');
        store.addShortcut(url, String(payload.title || new URL(url).hostname).slice(0, 300));
        break;
      }
      case 'remove-shortcut': {
        store.data.shortcuts = store.data.shortcuts.filter(entry => entry.url !== payload);
        store.save(); break;
      }
      case 'remove-bookmark': {
        if (typeof payload !== 'string') break;
        const bookmarkStore = isPrivate ? sharedStore : store;
        bookmarkStore.data.bookmarks = bookmarkStore.data.bookmarks.filter(entry => entry.url !== payload); bookmarkStore.save(); break;
      }
      case 'clear-history': {
        showClearData(['history'], 'all'); break;
      }
      case 'clear-browsing-data': showClearData(); break;
      case 'browsing-data-stats': return {...await browsingData.stats(payload?.range || 'hour'),ieCacheExcluded:[...browsers].some(browser=>[...browser.tabs.values()].some(tab=>tab.ie))};
      case 'delete-browsing-data': {
        const affected=[...browsers].filter(browser=>browser.webSession===webSession);
        const ieOrigins=payload?.types?.includes('cookies')&&payload.range!=='all'?(await browsingData.selected(payload.range)).origins:null;
        for(const browser of affected)browser.compatibility.beginClear(payload?.types||[]);
        clearingPromise = browsingData.clear(payload);
         try { const result = await clearingPromise; await Promise.all(affected.map(browser=>browser.compatibility.clear(payload?.types||[],ieOrigins))); if (payload?.types?.includes('passwords') && passwordManager) { passwordManager.pending.clear(); passwordManager.targets.clear(); passwordManager.staged.clear(); } sendState(); toast('浏览数据已删除'); return result; }
        finally { clearingPromise = null; for(const browser of affected)browser.compatibility.endClear(); }
      }
      case 'modal-state': modalOpen = Boolean(payload); if (modalOpen) contextMenus.close(true); return;
      case 'overlay': overlay = Boolean(payload); layout(); if (overlay && !modalLayer.window) window.webContents.focus(); return;
      case 'bounds': {
        if (payload && Number.isFinite(payload.y) && Number.isFinite(payload.height)) {
          bounds = { x: 0, y: Math.max(0, Math.round(payload.y)), height: Math.max(0, Math.round(payload.height)) }; layout();
        } return;
      }
      case 'find': if (typeof payload?.text === 'string' && payload.text.trim() && payload.text.length < 1000 && !isInternalUrl(tab.url)) {if(tab.ie){const result=await tab.ie.request('find',{text:payload.text,forward:payload.forward!==false?1:0});window.webContents.send('browser:find-result',result);}else tab.view.webContents.findInPage(payload.text, { forward: payload.forward !== false, findNext: !payload.next });} return;
      case 'stop-find': if(!tab?.ie)tab?.view.webContents.stopFindInPage('clearSelection'); break;
      case 'download-action': {
        const entry = downloadManager.jobs.get(payload?.id) || downloads.get(payload?.id) || downloadHistory.records.get(payload?.id);
        if (!entry) break;
        if (payload.action === 'remove' || payload.action === 'delete-file') {
          if (payload.action === 'delete-file') {
            if (entry.status !== 'completed') throw new Error('只能删除已完成下载的文件');
            const identity = await fileIdentity(entry.file).catch(error => { throw new Error(error.code === 'ENOENT' ? '文件已不存在，可移除这条记录' : error.message); });
            const confirmed = await prompts.ask({ kind: 'download-delete-file', title: '删除下载文件', message: '将“' + entry.name + '”移入回收站并移除记录？', detail: identity.real, confirmLabel: '删除文件' });
            if (!confirmed.accepted) return;
            const current = await fileIdentity(entry.file);
            if (JSON.stringify(identity) !== JSON.stringify(current)) throw new Error('文件已变化，请重新确认删除');
            await shell.trashItem(current.real);
          } else if (!entry.historical && !['completed', 'cancelled', 'interrupted'].includes(entry.status) || downloadManager.jobs.has(entry.id) && entry.status === 'interrupted') {
            const confirmed = await prompts.ask({ kind: 'download-remove', title: '移除下载', message: '取消此下载并移除记录？', detail: entry.name, confirmLabel: '取消并移除' }); if (!confirmed.accepted) return;
          }
          if (downloadManager.jobs.has(entry.id)) await downloadManager.remove(entry.id);
          else { if (entry.item && !['completed', 'cancelled'].includes(entry.status)) { entry.removed = true; entry.item.cancel(); } downloads.delete(entry.id); }
          downloadHistory.remove(entry.id); sendState(); return true;
        }
        if (payload.action === 'open' && entry.status === 'completed') {
          if (downloadManager.jobs.has(entry.id)) await markDownloadedFile(entry.file, entry.url);
          const error = await shell.openPath(entry.file); if (error) toast('无法打开文件：' + error);
        }
        if (payload.action === 'reveal' && entry.status === 'completed') shell.showItemInFolder(entry.file);
        if (downloadManager.jobs.has(entry.id)) await downloadManager.action(entry.id, payload.action, payload.value);
        else if (!entry.historical) {
          if (payload.action === 'pause' && entry.status === 'progressing') { entry.item.pause(); entry.status = 'paused'; }
          if (payload.action === 'resume' && entry.status === 'paused') { entry.item.resume(); entry.status = 'progressing'; }
          if (payload.action === 'retry' && entry.status === 'interrupted' && isWebUrl(entry.url)) webSession.downloadURL(entry.url);
          if (payload.action === 'cancel' && ['progressing', 'paused', 'waiting', 'interrupted'].includes(entry.status)) entry.item.cancel();
          if (payload.action === 'completion' && ['none', 'open', 'reveal'].includes(payload.value)) entry.completion = payload.value;
        }
        break;
      }
      case 'new-download': {
        const url = resolveWebsite(payload);
        if (!url) throw new Error('请输入有效的下载链接');
        const name = downloadName(decodeURIComponent(new URL(url).pathname.split('/').at(-1) || 'download.bin'));
        await beginManagedDownload(url, name); break;
      }
      case 'minimize': window.minimize(); break;
      case 'maximize': window.isMaximized() ? window.unmaximize() : window.maximize(); break;
      case 'close-window': window.close(); return;
      default: throw new Error('Unknown command');
    }
    sendState();
  });
  const ready = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
  window.loadFile(path.join(__dirname, 'ui', 'index.html'));
  window.once('ready-to-show', () => { window.show(); });
  window.webContents.once('did-finish-load', () => {
    const saved = options.layout?.urls || options.urls || [], savedActive = options.layout?.activeIndex || 0;
    if (saved.length) {
      const ids = saved.map(url => {
        if (url.startsWith('chrome-extension://') && !extensionManager.allowedURL(url)) {
          const id = createTab(HOME, false);
           extensionsReady?.then(() => { const tab = tabs.get(id); if (tab?.url === HOME && extensionManager.allowedURL(url)) navigate(tab, url); });
          return id;
        }
        return createTab(url, false);
       }); restoreLayout(options.layout, ids); activateTab(ids[Math.min(savedActive, ids.length - 1)]);
    } else createTab();
    prompts.setReady();
    extensionsReady?.then(sendState);
    sendState();
  });
  await ready;
  return controller;
}
app.whenReady().then(async () => {
  if (!singleInstance) return;
  cleanupPrivateDirectories(privateSessionsRoot);
  sharedStore = new Store(app.getPath('userData'));
  sharedImporter = new BrowserImporter({ helper: process.platform === 'win32' ? app.isPackaged ? path.join(process.resourcesPath, 'luna-browser-import.exe') : path.join(__dirname, 'native', 'luna-browser-import.exe') : undefined });
  sharedAssets = new AppearanceAssets(app.getPath('userData'), session.defaultSession);
  await sharedAssets.cleanup(sharedStore.data.settings.appearance);
  nativeTheme.themeSource = sharedStore.data.settings.theme;
  nativeTheme.on('updated', broadcast);
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' },
  ]) : null);
  const restore = sharedStore.data.restoreOnce ?? (sharedStore.data.settings.startup === 'restore');
  const saved = restore ? sharedStore.data.sessionWindows?.length ? sharedStore.data.sessionWindows : sharedStore.data.session.length ? [{ urls: [...sharedStore.data.session], activeIndex: sharedStore.data.sessionActive }] : [] : [];
  sharedStore.data.restoreOnce = null; sharedStore.save();
  if (saved.length) for (const layout of saved) await createBrowser({ layout });
  else await createBrowser();
  const browser = focusedBrowser(); for (const url of launchURLs.splice(0, 20)) browser?.createTab(url);
}).catch(error => { console.error(error); app.quit(); });
app.on('activate', () => { if (app.isReady() && !browsers.size) createBrowser().catch(console.error); });
app.on('before-quit', event => {
  if (process.platform !== 'darwin' || quitting || !browsers.size) return;
  event.preventDefault(); if (quitRequest) return;
  quitRequest = (async () => {
    for (const browser of [...browsers]) if (!await browser.close()) return;
    quitting = true; app.quit();
  })().finally(() => { quitRequest = null; });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
