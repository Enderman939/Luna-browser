const $ = selector => document.querySelector(selector);
const HOME = 'luna://newtab';
const SETTINGS = 'luna://settings';
const EXTENSIONS = 'luna://extensions';
const engineNames = { baidu: '百度', google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo' };
const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
  square: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  left: '<path d="m12 5-7 7 7 7M5 12h14"/>', right: '<path d="m12 5 7 7-7 7M5 12h14"/>',
  up: '<path d="m6 15 6-6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>',
  reload: '<path d="M20 7v5h-5M19.2 12a7.5 7.5 0 1 0-1.5 5M20 7l-3-3"/>',
  home: '<path d="m3 10 9-7 9 7M5 9v11h5v-7h4v7h5V9"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16m3-11h1m-1 4h1"/>',
  menu: '<path d="M5 6h14M5 12h14M5 18h14"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  leaf: '<path d="M19 4C8 3 3 8 6 16c7 4 14-1 13-12ZM5 20l10-10"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  history: '<path d="M3 5v5h5m-4-1a9 9 0 1 1-1 6M12 7v5l3 2"/>',
  arrow: '<path d="M6 18 18 6M7 6h11v11"/>',
  file: '<path d="M14 3H5v18h14V8zm0 0v5h5M8 13h8m-8 4h5"/>',
  moon: '<path d="M18.5 3.6A9.5 9.5 0 1 0 21 16.8 8 8 0 0 1 18.5 3.6Z"/>',
  pencil: '<path d="m14 4 6 6M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/>',
  settings: '<path d="m9 3-.7 2.4-2.1 1.2L3.8 6 2 9l1.7 1.8v2.4L2 15l1.8 3 2.4-.6 2.1 1.2L9 21h6l.7-2.4 2.1-1.2 2.4.6 1.8-3-1.7-1.8v-2.4L22 9l-1.8-3-2.4.6-2.1-1.2L15 3z"/><circle cx="12" cy="12" r="3"/>',
  palette: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M12 3a9 9 0 0 0 0 18" fill="currentColor"/>',
  power: '<path d="M12 3v8M7 5a8 8 0 1 0 10 0"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  puzzle: '<path d="M9 5V3.5a2.5 2.5 0 0 1 5 0V5h4v4h1.5a2.5 2.5 0 0 1 0 5H18v4h-4v1.5a2.5 2.5 0 0 1-5 0V18H5v-4h1.5a2.5 2.5 0 0 0 0-5H5V5z"/>',
  pin: '<path d="m15 3 6 6-4 1-4 4v4l-7-7h4l4-4zM3 21l5-5"/>',
  volume: '<path d="M3 9h4l5-5v16l-5-5H3zM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>', mute: '<path d="M3 9h4l5-5v16l-5-5H3zm13 0 6 6m0-6-6 6"/>',
  unpin: '<path d="m15 3 6 6-4 1-2 2M11 15v3l-5-5h3M3 21l5-5M3 3l18 18"/>',
  more: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
  folder: '<path d="M3 6h7l2 3h9v12H3zM3 6V4h7l2 2h9v3"/>',
  key: '<circle cx="8" cy="9" r="5"/><path d="m12 13 8 8m-4-4 3-3m-6 0 3-3"/>',
  newtab: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9h2m3 0h2m3 0h1"/>',
  private: '<path d="M3 13h18M5 13l2-8h10l2 8M4 18h6m4 0h6"/><circle cx="7" cy="18" r="3"/><circle cx="17" cy="18" r="3"/>',
  zoom: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10h6m-3-3v6"/>',
  fullscreen: '<path d="M14 3h7v7M3 14v7h7M21 3l-7 7M3 21l7-7"/>',
  groups: '<rect x="3" y="3" width="13" height="13" rx="2"/><path d="M8 20h11a2 2 0 0 0 2-2V8"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  print: '<path d="M6 8V3h12v5M6 17H3V8h18v9h-3M6 14h12v7H6zM17 11h1"/>',
  translate: '<path d="M3 5h11M8 3v2m4 0c0 5-4 9-8 10M5 8l7 7m2 6 4-10 4 10m-7-3h6"/>',
  split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  camera: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="m8 6 2-3h4l2 3"/><circle cx="12" cy="13" r="4"/>',
  reading: '<path d="M12 5C8 3 5 3 3 4v16c3-1 6-1 9 1m0-16c4-2 7-2 9-1v16c-3-1-6-1-9 1V5"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"/>',
  tools: '<path d="M21 3a6 6 0 0 1-7 8L5 20a2 2 0 0 1-3-3l9-9a6 6 0 0 1 8-7l-4 4 4 2z"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h1m3 0h1m3 0h1m3 0h1M6 13h1m3 0h1m3 0h1m3 0h1M7 16h10"/>',
};
function icon(name, original = false) {
  const key = Object.hasOwn(icons, name) ? name : 'globe';
  const custom = !original && window.lunaAppearanceModel.assetURL(window.lunaAppearance.current.icons.custom[key]);
  if (custom) return `<img class="custom-icon" src="${custom}" alt="" aria-hidden="true" data-fallback-glyph="${key}">`;
  return `<svg class="ui-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[key]}</svg>`;
}
window.lunaIcon = icon;
function setIcon(element, name) { element.dataset.glyph = name; element.innerHTML = icon(name); }
window.lunaSetIcon = setIcon;
document.addEventListener('error', event => {
  const image = event.target; if (image?.tagName !== 'IMG' || !image.dataset.fallbackGlyph) return;
  const template = document.createElement('template'); template.innerHTML = icon(image.dataset.fallbackGlyph, true); image.replaceWith(template.content.firstElementChild);
}, true);
document.querySelectorAll('[data-icon]').forEach(element => setIcon(element, element.dataset.icon));
function el(tag, className, text) { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; }
let state = { tabs: [], activeId: null, bookmarks: [], history: [], downloads: [], recentSites: [], shortcuts: [], settings: {}, icons: {}, extensions: [] };
let panelType = 'bookmarks', settingsSection = 'search', toastTimer, lastActive;
let lastCustomIcons = '';
const pendingIncognito = new Map();
const bridge = window.browser;
async function command(action, payload) {
  try { return await bridge.command(action, payload); } catch (error) {
    let message = String(error.message || '操作失败，请重试').replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/, '').replace(/^(?:TypeError|Error):\s*/, '');
    if (/^(fetch failed|Failed to fetch)$/i.test(message)) message = '网络请求失败，请检查代理或网络后重试。';
    showToast(message);
  }
}
function activeTab() { return state.tabs.find(tab => tab.id === state.activeId); }
function isInternal(tab) { return !tab || [HOME, SETTINGS, EXTENSIONS].includes(tab.url); }
function setImage(element, source, fallback = 'globe') {
  if (!source || !source.startsWith('data:image/')) { setIcon(element, fallback); return; }
  const image = el('img'); image.src = source; image.alt = '';
  image.onerror = () => setIcon(element, fallback);
  element.replaceChildren(image);
}
function favicon(url) { try { return state.icons[new URL(url).origin] || ''; } catch { return ''; } }
function host(url) { try { return new URL(url).hostname; } catch { return url; } }
function showToast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3400); }
window.lunaNotify = showToast;
function updateOverlay() { window.browserDialogs.overlays(); }
function closeOverlay() {
  if (window.popoverHost) { window.popoverHost.close(); return; }
  $('#panel').hidden = true; $('#browser-menu').hidden = true; $('#shade').hidden = true;
  $('#panel-button').classList.remove('active'); $('#downloads-button').classList.remove('active');
  $('#history-button').classList.remove('active');
  window.extensionMenu?.close();
  updateOverlay();
  command('popover-close');
}
function openPopover(kind, selector) {
  const node = $(selector), rect = node.getBoundingClientRect();
  command('popover-open', { kind, anchor: window.popoverHost ? undefined : { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
}
function openPanel(type) {
  if (!window.popoverHost || window.popoverHost.kind !== type) { openPopover(type, type === 'downloads' ? '#downloads-button' : type === 'history' ? '#history-button' : '#panel-button'); return; }
  panelType = type;
  $('#panel').hidden = false; $('#browser-menu').hidden = true; $('#shade').hidden = false;
  $('#panel-search').value = '';
  $('#panel-button').classList.toggle('active', type === 'bookmarks');
  $('#history-button').classList.toggle('active', type === 'history');
  $('#downloads-button').classList.toggle('active', type === 'downloads');
  renderPanel(); updateOverlay();
}
function togglePanel(type) { if (!$('#panel').hidden && panelType === type) closeOverlay(); else openPanel(type); }
function navigate(input) {
  closeOverlay(); hideFind(); $('#address').blur(); $('#search').blur();
  command('navigate', input);
}
function openSettings(section) {
  closeOverlay(); hideFind();
  if (section) settingsSection = section;
  $('#settings-search').value = '';
  command('settings');
}
function openExtensions() { closeOverlay(); hideFind(); command('extensions'); }
function updateBounds() {
  if (window.popoverHost) return;
  const rect = $('#viewport').getBoundingClientRect();
  command('bounds', { y: rect.top, height: rect.height });
}
new ResizeObserver(updateBounds).observe($('#viewport'));

function render(newState) {
  state = newState;
  window.lunaAppearance.apply(state.settings.appearance, state.dark);
  const customIcons = state.settings.appearance?.icons.custom || {}, signature = JSON.stringify(customIcons);
  if (signature !== lastCustomIcons) {
    lastCustomIcons = signature;
    document.querySelectorAll('[data-glyph]').forEach(node => setIcon(node, node.dataset.glyph));
    for (const image of document.querySelectorAll('.brand img,.about-card>img')) {
      image.src = window.lunaAppearanceModel.assetURL(customIcons.brand) || 'assets/mark.svg';
      image.onerror = () => { image.onerror = null; image.src = 'assets/mark.svg'; };
    }
  }
  if (!window.popoverHost) window.appearanceControls.update(state.settings, state.dark);
  window.passwordUI?.update(state);
  window.browserMenu.update(state);
  window.workspaceUI.update(state);
  window.essentialsUI.update(state);
  window.importUI?.update(state);
  window.browserDialogs.sync(state.prompt);
  const tab = activeTab();
  if (!tab) return;
  if (window.popoverHost) {
    const kind = window.popoverHost.kind;
    if (kind === 'address') window.essentialsUI.renderAddress();
    else if (kind === 'extensions') window.extensionMenu.update(state);
    else if (kind === 'passwords') window.popoverHost.initialized();
    else if (kind === 'browser') { $('#browser-menu').hidden = false; window.popoverHost.initialized(); }
    else { panelType = kind; $('#panel').hidden = false; renderPanel(); window.popoverHost.initialized(); }
    return;
  }
  if (lastActive !== tab.id) { hideFind(); lastActive = tab.id; }
  if (!window.lunaTabDragging) renderTabs(); renderBookmarks(); renderShortcuts();
  const home = tab.url === HOME && !state.split;
  const internal = isInternal(tab);
  $('#compatibility-button').hidden = !tab.compatibility?.enabled;
  document.body.dataset.ie = String(tab.compatibility?.enabled === true);
  $('#compatibility-button').title = 'IE '+(tab.compatibility?.documentMode || '兼容')+' 模式 · 点击退出。Cookie 双向同步；网站存储在切换时同步。'+(tab.compatibility?.syncError ? '\n同步问题：'+tab.compatibility.syncError : '');
  $('#newtab').hidden = !home;
  $('#settings-page').hidden = tab.url !== SETTINGS;
  $('#extensions-page').hidden = tab.url !== EXTENSIONS;
  $('#extension-actions').setAttribute('tab', String(tab.webContentsId));
  window.extensionMenu.update(state);
  $('#downloads-button').classList.toggle('active', state.popover === 'downloads');
  $('#history-button').classList.toggle('active', state.popover === 'history');
  $('#panel-button').classList.toggle('active', state.popover === 'bookmarks');
  $('#menu-button').classList.toggle('active', state.popover === 'browser');
  $('#menu-button').setAttribute('aria-expanded', String(state.popover === 'browser'));
  $('#bookmarkbar').hidden = state.settings.showBookmarks === false;
  $('#home').hidden = state.settings.showHome === false;
  $('#shortcuts').hidden = state.settings.showShortcuts === false;
  const searchPrompt = '使用 ' + (engineNames[state.settings.searchEngine] || '百度') + ' 搜索或输入网址';
  $('#search').placeholder = searchPrompt;
  $('#address').placeholder = searchPrompt;
  $('#error-page').hidden = !tab.error || !!state.split;
  $('#web-loading').hidden = !tab.loading || internal || !!tab.error;
  if (document.activeElement !== $('#address')) $('#address').value = home ? '' : tab.url;
  $('#address-hint').hidden = !home;
  setIcon($('#address-symbol'), home ? 'search' : tab.url === SETTINGS ? 'settings' : tab.url === EXTENSIONS ? 'puzzle' : tab.url.startsWith('https:') ? 'lock' : 'globe');
  $('#address-symbol').title = internal ? 'luna' : tab.url.startsWith('https:') ? '连接使用 HTTPS 加密' : '连接未使用 HTTPS 加密';
  $('#back').disabled = !tab.canBack || internal;
  $('#forward').disabled = !tab.canForward || internal;
  setIcon($('#reload'), tab.loading ? 'close' : 'reload');
  $('#reload').title = tab.loading ? '停止加载' : window.lunaShortcut('刷新 (Ctrl+R)');
  $('#bookmark').disabled = internal || !!tab.error;
  $('#reload').disabled = internal;
  $('#bookmark').classList.toggle('is-saved', state.bookmarks.some(entry => entry.url === tab.url));
  if (tab.error) {
    $('#error-message').textContent = '无法连接到 ' + host(tab.url) + '。请检查网络或网址，然后再试一次。';
    $('#error-detail').textContent = tab.error.description + ' · ' + tab.error.code;
  }
  if (!$('#panel').hidden) renderPanel();
  if (tab.url === SETTINGS) renderSettings();
  if (tab.url === EXTENSIONS) renderExtensions();
  updateBounds();
}
function renderTabs() {
  const container = $('#tabs');
  const scroll = container.scrollLeft;
  container.replaceChildren();
  const renderedGroups = new Set();
  const ordered = [];
  for (const tab of state.tabs) {
    const group = state.groups.find(group => group.id === tab.groupId);
    if (!group) ordered.push(tab);
    else if (!renderedGroups.has(group.id)) {
      renderedGroups.add(group.id);
      ordered.push({ group }, ...state.tabs.filter(member => member.groupId === group.id && (!group.collapsed || member.id === state.activeId)));
    }
  }
  ordered.forEach(tab => {
    if (tab.group) {
      const group = tab.group, button = el('button','group-chip'); button.dataset.groupId = group.id; button.dataset.color = group.color;
      button.append(el('span','',group.name),el('small','',String(state.tabs.filter(tab => tab.groupId === group.id).length)));
      button.title = group.name + ' · 点击' + (group.collapsed ? '展开' : '折叠') + '，右键编辑'; button.setAttribute('aria-expanded',String(!group.collapsed));
      button.onclick = () => command('group-action',{action:'collapse',id:group.id}); button.oncontextmenu = event => { event.preventDefault(); window.workspaceUI.editGroup(group.id); };
      container.append(button); return;
    }
    const item = el('div', 'tab' + (tab.id === state.activeId ? ' selected' : '') + (tab.loading ? ' loading' : '') + (tab.pinned ? ' pinned' : ''));
    item.draggable = true;
    item.ondragstart = event => { window.lunaTabDragging = true; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-luna-tab', JSON.stringify({ id: tab.id, windowId: state.windowId, dragKey: tab.dragKey })); };
    item.ondragend = () => { window.lunaTabDragging = false; container.querySelectorAll('.drop-before').forEach(node => node.classList.remove('drop-before')); };
    item.ondragover = event => { if (!event.dataTransfer.types.includes('application/x-luna-tab')) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; item.classList.add('drop-before'); };
    item.ondragleave = () => item.classList.remove('drop-before');
    item.ondrop = event => { event.preventDefault(); event.stopPropagation(); item.classList.remove('drop-before'); window.lunaTabDragging = false; try { command('tab-drop', { ...JSON.parse(event.dataTransfer.getData('application/x-luna-tab')), beforeId: tab.id }); } catch {} };
    if (tab.groupId) { item.classList.add('grouped'); item.dataset.groupColor = state.groups.find(group => group.id === tab.groupId)?.color || 'gray'; }
    item.setAttribute('role', 'tab'); item.setAttribute('aria-selected', String(tab.id === state.activeId)); item.tabIndex = 0;
    item.dataset.id = tab.id; item.title = tab.title;
    const symbol = el('span', 'tab-symbol');
    if (tab.loading || isInternal(tab)) setIcon(symbol, tab.loading ? 'reload' : tab.url === HOME ? 'moon' : tab.url === SETTINGS ? 'settings' : 'puzzle');
    else setImage(symbol, tab.favicon);
    const close = el('button', 'tab-close'); setIcon(close, 'close'); close.setAttribute('aria-label', '关闭 ' + tab.title); close.title = '关闭标签页';
    close.onclick = event => { event.stopPropagation(); command('close-tab', tab.id); };
    const activate = () => { closeOverlay(); command('activate', tab.id); };
    item.onclick = activate;
    item.oncontextmenu = event => { event.preventDefault(); closeOverlay(); window.workspaceUI.tabDialog(tab.id); };
    item.onkeydown = event => { if (event.target === item && ['Enter', ' '].includes(event.key)) { event.preventDefault(); activate(); } };
    item.onauxclick = event => { if (event.button === 1) { event.preventDefault(); command('close-tab', tab.id); } };
    item.append(symbol, el('span', 'tab-title', tab.title), close); container.append(item);
    if (tab.audible || tab.muted) { const sound = el('button', 'tab-sound'); setIcon(sound, tab.muted ? 'mute' : 'volume'); sound.title = tab.muted ? '取消静音' : '静音标签页'; sound.setAttribute('aria-label', sound.title); sound.onclick = event => { event.stopPropagation(); command('tab-action', { id: tab.id, action: 'mute' }); }; item.insertBefore(sound, close); }
  });
  container.scrollLeft = scroll;
}
function renderBookmarks() {
  $('#bookmark-items').replaceChildren();
  state.bookmarks.filter(entry => !entry.folderId).slice(0, 10).forEach(entry => {
    const button = el('button', 'bookmark-item'); button.title = entry.title + '\n' + entry.url;
    const symbol = el('span'); setImage(symbol, favicon(entry.url));
    button.append(symbol, el('span', '', entry.title)); button.onclick = () => navigate(entry.url); $('#bookmark-items').append(button);
  });
  for (const folder of state.bookmarkFolders.filter(folder => !folder.parentId).slice(0, 5)) { const button = el('button', 'bookmark-item'); button.append(el('span', '', '▸'), el('span', '', folder.title)); button.onclick = () => window.essentialsUI.openBookmarks(folder.id); $('#bookmark-items').append(button); }
  if (state.bookmarks.length > 10 || state.bookmarkFolders.length) { const button = el('button', 'bookmark-item', '更多…'); button.onclick = () => window.essentialsUI.openBookmarks(); $('#bookmark-items').append(button); }
}
function siteIcon(url) {
  const symbol = el('span', 'site-icon');
  if (favicon(url)) { setImage(symbol, favicon(url)); return symbol; }
  const name = host(url).replace(/^www\./, '');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', '12'); text.setAttribute('y', '17'); text.setAttribute('text-anchor', 'middle');
  text.setAttribute('fill', 'currentColor'); text.setAttribute('font-size', '17'); text.setAttribute('font-weight', '600');
  text.textContent = name.includes('baidu.com') ? '百' : name.includes('zhihu.com') ? '知' : name[0]?.toUpperCase() || 'L';
  svg.append(text); symbol.append(svg); return symbol;
}
function renderShortcuts() {
  $('#shortcuts').replaceChildren();
  (state.recentSites || []).forEach(entry => {
    const tile = el('div', 'shortcut'); tile.dataset.url = entry.url;
    const button = el('button', 'shortcut-open'); button.title = entry.title + '\n' + entry.url;
    button.append(siteIcon(entry.url), el('span', 'shortcut-title', entry.title));
    button.onclick = () => navigate(entry.url); tile.append(button);
    if (state.shortcuts.some(saved => saved.url === entry.url)) {
      const remove = el('button', 'shortcut-remove'); setIcon(remove, 'close'); remove.title = '删除快捷方式'; remove.setAttribute('aria-label', '删除快捷方式 ' + entry.title); remove.onclick = () => command('remove-shortcut', entry.url); tile.append(remove);
    }
    $('#shortcuts').append(tile);
  });
  const add = el('button', 'shortcut'); add.id = 'add-shortcut'; add.title = '添加快捷方式';
  const symbol = el('span', 'site-icon'); setIcon(symbol, 'plus');
  add.append(symbol, el('span', 'shortcut-title', '添加快捷方式')); add.onclick = addShortcut; $('#shortcuts').append(add);
}
function renderSettings() {
  const names = { search: '搜索引擎', appearance: '外观', startup: '启动与主页', import: '导入浏览资料', downloads: '下载', passwords: '密码管理器', privacy: '隐私与数据', about: '关于 luna' };
  const query = $('#settings-search').value.trim().toLowerCase();
  $('#settings-title').textContent = query ? '搜索结果' : names[settingsSection];
  document.querySelectorAll('[data-settings-section]').forEach(button => button.classList.toggle('selected', !query && button.dataset.settingsSection === settingsSection));
  let visible = 0;
  document.querySelectorAll('[data-group]').forEach(group => {
    group.hidden = state.private && ['passwords', 'import'].includes(group.dataset.group) || (query ? !group.dataset.keywords.toLowerCase().includes(query) : group.dataset.group !== settingsSection);
    if (!group.hidden) visible++;
  });
  $('#settings-empty').hidden = visible > 0;
  document.querySelectorAll('[data-setting]').forEach(control => {
    if (control.type === 'checkbox') control.checked = state.settings[control.dataset.setting];
    else control.value = state.settings[control.dataset.setting];
  });
  if (document.activeElement !== $('#setting-homePage')) $('#setting-homePage').value = state.settings.homePage || '';
  $('#download-location').textContent = state.downloadPath;
  $('#history-size').textContent = state.history.length + ' 条记录';
  $('#app-version').textContent = '版本 ' + state.version;
  $('#chromium-version').textContent = 'Chromium ' + state.chromium;
  if (!state.private && !window.popoverHost && (settingsSection === 'passwords' || query && query.includes('密码'))) window.passwordUI.refresh();
}
function renderPanel() {
  const titles = { bookmarks: '收藏夹', history: '浏览历史', downloads: '下载管理' };
  $('#panel-title').textContent = titles[panelType];
  $('#panel').dataset.kind = panelType;
  $('#panel').setAttribute('aria-label', titles[panelType]);
  $('#download-tools').hidden = panelType !== 'downloads';
  $('#bookmark-tools').hidden = panelType !== 'bookmarks';
  $('#panel-search-wrap').hidden = panelType === 'downloads';
  $('#panel-search').placeholder = panelType === 'bookmarks' ? '搜索收藏' : '搜索浏览历史';
  $('#clear-history').hidden = panelType !== 'history' || !state.history.length;
  const query = $('#panel-search').value.toLowerCase();
  const entries = state[panelType].filter(entry => panelType === 'downloads' || (entry.title + entry.url).toLowerCase().includes(query));
  $('#panel-summary').textContent = entries.length + (panelType === 'downloads' ? ' 个下载' : ' 个记录');
  const list = $('#panel-list'); const scroll = list.scrollTop;
  if (panelType === 'downloads' && entries.length) { window.downloadUI.render(list, [...entries].reverse(), { el, setIcon, setImage, bytes, command }); list.scrollTop = scroll; return; }
  list.replaceChildren();
  if (panelType === 'bookmarks' && window.essentialsUI.renderBookmarkPanel(list, query)) { list.scrollTop = scroll; return; }
  if (!entries.length) {
    const empty = el('div', 'empty-state'); empty.innerHTML = icon(panelType === 'bookmarks' ? 'star' : panelType === 'history' ? 'history' : 'download');
    empty.append(el('strong', '', query ? '无匹配记录' : { bookmarks: '暂无收藏', history: '暂无浏览记录', downloads: '暂无下载' }[panelType]));
    list.append(empty); return;
  }
  entries.forEach(entry => {
    const row = el('div', 'list-entry');
    const symbol = el('span', 'entry-icon'); setImage(symbol, favicon(entry.url));
    const label = el('span', 'entry-text');
      label.append(el('strong', '', entry.title), el('span', '', host(entry.url) + (panelType === 'history' ? ' · ' + new Date(entry.time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')));
      const open = el('button', 'entry-open'); open.title = entry.url; open.append(symbol, label); open.onclick = () => navigate(entry.url); row.append(open);
      if (panelType === 'bookmarks') { const remove = el('button', 'icon-button entry-delete'); setIcon(remove, 'close'); remove.title = '移除收藏'; remove.setAttribute('aria-label', '移除 ' + entry.title); remove.onclick = () => command('remove-bookmark', entry.url); row.append(remove); }
    list.append(row);
  });
  list.scrollTop = scroll;
}
function renderExtensions() {
  const list = $('#extension-list'); list.replaceChildren();
  $('#extension-store-install').disabled = state.extensionInstalling;
  $('#extension-store-install').textContent = state.extensionInstalling ? '正在安装…' : '安装';
  const progress = state.extensionInstallState;
  $('#extension-install-status').hidden = !progress;
  if (progress) {
    const descriptions = { downloading: '正在下载扩展' + (progress.total ? ' · ' + Math.round(progress.received * 100 / progress.total) + '%' : progress.received ? ' · ' + bytes(progress.received) : ''), verifying: '正在校验安装包', permission: '等待安装授权', loading: '正在加载扩展', completed: '已安装：' + (progress.name || ''), cancelled: '已取消安装', error: progress.error };
    $('#extension-install-message').textContent = descriptions[progress.phase] || '';
    $('#extension-install-status').classList.toggle('failed', progress.phase === 'error');
    $('#extension-install-retry').hidden = progress.phase !== 'error';
  }
  if (!state.extensions.length) { list.append(el('div', 'extensions-empty', '暂无扩展程序')); return; }
  state.extensions.forEach(extension => {
    const card = el('article', 'extension-card'); card.dataset.id = extension.id;
    const header = el('div', 'extension-card-top'), symbol = el('span', 'extension-icon'); setImage(symbol, extension.icon, 'puzzle');
    const text = el('div', 'extension-text'); text.append(el('strong', '', extension.name), el('span', '', extension.version + ' · Manifest V' + extension.manifestVersion));
    const toggle = el('input', 'switch'); toggle.type = 'checkbox'; toggle.checked = extension.configuredEnabled !== false; toggle.setAttribute('aria-label', '启用 ' + extension.name);
    toggle.onchange = () => command('extension-enable', { id: extension.id, enabled: toggle.checked });
    header.append(symbol, text, toggle); card.append(header);
    if (extension.description) card.append(el('p', 'extension-description', extension.description));
    card.append(el('code', 'extension-id', extension.id));
    if (extension.error) card.append(el('p', 'form-error', extension.error));
    const privateRow = el('label', 'extension-private-setting'), privateText = el('span');
    privateText.append(el('strong', '', '允许在无痕中运行'), el('small', '', extension.incognitoSupported === false ? '此扩展不支持无痕浏览' : '仅允许信任的扩展；无痕使用独立临时存储'));
    const privateToggle = el('input', 'switch'); privateToggle.type = 'checkbox'; privateToggle.checked = pendingIncognito.has(extension.id) ? pendingIncognito.get(extension.id) : extension.allowIncognito === true; privateToggle.disabled = extension.incognitoSupported === false || pendingIncognito.has(extension.id);
    privateToggle.setAttribute('aria-label', '允许 ' + extension.name + ' 在无痕中运行');
    privateToggle.onchange = async () => { const allowed = privateToggle.checked; pendingIncognito.set(extension.id, allowed); privateToggle.disabled = true; try { await command('extension-incognito', { id: extension.id, allowed }); } finally { pendingIncognito.delete(extension.id); const latest = await command('state'); if (latest) state = latest; renderExtensions(); } };
    privateRow.append(privateText, privateToggle); card.append(privateRow);
    const controls = el('div', 'extension-card-actions');
    if (extension.options) { const options = el('button', 'secondary-button', '选项'); options.disabled = !extension.enabled; options.onclick = () => command('extension-options', extension.id); controls.append(options); }
    const remove = el('button', 'secondary-button', '移除'); remove.onclick = () => command('extension-remove', extension.id); controls.append(remove);
    controls.append(el('span', 'extension-source', extension.source === 'webstore' ? extension.market === 'edge' ? 'Edge 扩展商店' : 'Chrome 网上应用店' : { unpacked: '已解压', package: '本地安装包' }[extension.source] || ''));
    card.append(controls); list.append(card);
  });
}
function bytes(amount) { if (amount < 1024) return amount + ' B'; if (amount < 1024 * 1024) return (amount / 1024).toFixed(1) + ' KB'; return (amount / 1024 / 1024).toFixed(1) + ' MB'; }

function showFind() {
  if (isInternal(activeTab()) || activeTab().error) { showToast('请先打开网页'); return; }
  closeOverlay(); $('#findbar').hidden = false; $('#find-input').focus(); $('#find-input').select(); updateBounds();
}
function hideFind() { if ($('#findbar').hidden) return; $('#findbar').hidden = true; $('#find-count').textContent = '0 / 0'; command('stop-find'); updateBounds(); }
function find(next = false, forward = true) { const text = $('#find-input').value; if (text.trim()) command('find', { text, next, forward }); else { command('stop-find'); $('#find-count').textContent = '0 / 0'; } }

$('#address-form').onsubmit = event => { event.preventDefault(); navigate($('#address').value); };
$('#search-form').onsubmit = event => { event.preventDefault(); navigate($('#search').value); };
$('#address').addEventListener('focus', () => { $('#address').select(); if (!window.popoverHost && state.popover !== 'address') command('popover-close'); });
$('#new-tab').onclick = () => { closeOverlay(); command('new-tab'); };
$('#tabs').ondragover = event => { if (event.dataTransfer.types.includes('application/x-luna-tab')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } };
$('#tabs').ondrop = event => { event.preventDefault(); window.lunaTabDragging = false; try { command('tab-drop', JSON.parse(event.dataTransfer.getData('application/x-luna-tab'))); } catch {} };
$('#back').onclick = () => command('back'); $('#forward').onclick = () => command('forward');
$('#reload').onclick = () => command(activeTab()?.loading ? 'stop' : 'reload');
$('#home').onclick = () => { closeOverlay(); hideFind(); command('home'); }; $('#bookmark').onclick = () => command('bookmark');
$('#compatibility-button').onclick = () => {closeOverlay();command('ie-mode');};
$('#minimize').onclick = () => command('minimize'); $('#maximize').onclick = () => command('maximize'); $('#close-window').onclick = () => command('close-window');
$('#downloads-button').onclick = () => togglePanel('downloads'); $('#panel-button').onclick = () => togglePanel('bookmarks'); $('#bookmarks-button').onclick = () => togglePanel('bookmarks');
$('#history-button').onclick = () => togglePanel('history'); $('#extensions-button').onclick = () => window.extensionMenu.toggle();
$('#panel-close').onclick = closeOverlay; $('#shade').onclick = closeOverlay;
$('#menu-button').onclick = () => openPopover('browser', '#menu-button');
$('#panel-search').oninput = renderPanel; $('#clear-history').onclick = () => command('clear-history');
document.querySelectorAll('[data-menu]').forEach(button => button.onclick = () => { const action = button.dataset.menu; if (['bookmarks', 'history', 'downloads'].includes(action)) openPanel(action); else { closeOverlay(); if (action === 'find') window.popoverHost ? command('show-find') : showFind(); else if (action === 'settings') openSettings(); else if (action === 'extensions') openExtensions(); else command(action); } });
$('#find-input').oninput = () => find();
$('#find-input').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); find(true, !event.shiftKey); } };
$('#find-next').onclick = () => find(true); $('#find-prev').onclick = () => find(true, false); $('#find-close').onclick = hideFind;
$('#retry').onclick = () => command('reload'); $('#error-home').onclick = () => navigate(HOME);
function addShortcut() { closeOverlay(); $('#shortcut-form').reset(); $('#shortcut-error').textContent = ''; $('#shortcut-dialog').showModal(); updateOverlay(); }
$('#dialog-close').onclick = () => $('#shortcut-dialog').close();
$('#dialog-cancel').onclick = () => $('#shortcut-dialog').close();
$('#shortcut-dialog').addEventListener('close', updateOverlay);
$('#shortcut-form').onsubmit = async event => {
  event.preventDefault();
  const input = $('#shortcut-url').value.trim();
  let url;
  try { url = new URL(/^https?:\/\//i.test(input) ? input : 'https://' + input); if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.') && url.hostname !== 'localhost') throw new Error(); }
  catch { $('#shortcut-error').textContent = '请输入有效的网址，例如 https://example.com'; return; }
  await command('add-shortcut', { title: $('#shortcut-name').value.trim(), url: url.href });
  $('#shortcut-dialog').close();
};
$('#customize').onclick = () => openSettings('appearance');
document.querySelectorAll('[data-settings-section]').forEach(button => button.onclick = () => { settingsSection = button.dataset.settingsSection; $('#settings-search').value = ''; renderSettings(); $('.settings-main').scrollTop = 0; });
document.querySelectorAll('[data-setting]').forEach(control => control.onchange = () => command('update-settings', { [control.dataset.setting]: control.type === 'checkbox' ? control.checked : control.dataset.setting === 'downloadThreads' ? Number(control.value) : control.value }));
$('#settings-search').oninput = renderSettings;
$('#homepage-form').onsubmit = async event => {
  event.preventDefault();
  const settings = await command('update-settings', { homePage: $('#setting-homePage').value.trim() });
  if (settings) { $('#homepage-error').textContent = ''; $('#setting-homePage').value = settings.homePage; showToast('主页已保存'); }
  else $('#homepage-error').textContent = '请输入有效的网址';
};
$('#choose-download-path').onclick = () => command('choose-download-path');
$('#reset-download-path').onclick = () => command('reset-download-path');
$('#settings-clear-history').onclick = () => command('clear-history');
$('#clear-cache').onclick = () => command('clear-cache');
$('#reset-settings').onclick = () => command('reset-settings');
$('#settings-clear-data').onclick = () => command('clear-browsing-data');
$('#extension-load-directory').onclick = () => command('extension-load-directory');
$('#extension-install-package').onclick = () => command('extension-install-package');
$('#extension-store').onclick = () => command('extension-store');
$('#extension-chrome-store').onclick = () => command('extension-store', 'chrome');
$('#extension-update').onclick = async () => { $('#extension-update').disabled = true; await command('extension-update'); $('#extension-update').disabled = false; };
$('#extension-install-form').onsubmit = async event => { event.preventDefault(); await command('extension-install-store', { input: $('#extension-store-url').value, market: $('#extension-market').value }); };
$('#extension-install-retry').onclick = () => command('extension-install-store', { input: state.extensionInstallState?.id, market: state.extensionInstallState?.market || 'edge' });
$('#new-download').onclick = () => { if (window.popoverHost) { command('show-download-dialog'); return; } $('#download-form').reset(); $('#download-dialog').showModal(); updateOverlay(); };
$('#download-dialog-close').onclick = $('#download-dialog-cancel').onclick = () => $('#download-dialog').close();
$('#download-dialog').addEventListener('close', updateOverlay);
$('#download-form').onsubmit = async event => { event.preventDefault(); const url = $('#download-url').value; $('#download-dialog').close(); await command('new-download', url); };
document.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]')) return;
  if (event.key === 'Escape') {
    closeOverlay(); hideFind();
    if (document.activeElement === $('#address')) { $('#address').blur(); $('#address').value = activeTab()?.url === HOME ? '' : activeTab()?.url || ''; }
  }
});
bridge.onState(render); bridge.onNotice(showToast);
bridge.onShortcut(action => {
  if (typeof action === 'object') { window.essentialsUI.shortcut(action); return; }
  if (action === 'address') { closeOverlay(); $('#address').focus(); $('#address').select(); }
  else if (action === 'find') showFind();
  else if (action === 'new-download') { $('#download-form').reset(); $('#download-dialog').showModal(); updateOverlay(); }
  else if (action === 'password-settings') { settingsSection = 'passwords'; $('#settings-search').value = ''; renderSettings(); }
  else if (action === 'help') window.browserMenu.showHelp();
  else if (action === 'split') window.workspaceUI.showSplit();
  else if (action === 'groups') window.workspaceUI.showGroups();
  else openPanel(action);
});
bridge.onSettingsSection(section => { if (['search','appearance','startup','downloads','privacy','passwords','about'].includes(section)) { settingsSection = section; $('#settings-search').value = ''; renderSettings(); } });
bridge.onFindResult(result => { $('#find-count').textContent = result.active + ' / ' + result.matches; });
command('state').then(initial => { if (initial && !state.tabs.length) render(initial); });
