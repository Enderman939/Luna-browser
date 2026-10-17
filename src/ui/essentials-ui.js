(() => {
  const $ = selector => document.querySelector(selector), bridge = window.browser;
  let state, displayedSite;
  const node = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
  async function call(action, payload) { try { return await bridge.command(action, payload); } catch (error) { window.lunaNotify?.(String(error.message).replace(/^Error invoking remote method .*?:\s*(?:Error: )?/, '')); return null; } }
  function renderSite() {
    const site = state.siteInfo; if (!site || site.tabId !== displayedSite?.tabId || site.origin !== displayedSite?.origin) { $('#site-info-dialog').close(); return; }
    $('#site-info-origin').textContent = site.origin;
    $('#site-info-connection').textContent = site.legacy ? 'IE 兼容模式的连接由 Windows 管理；此处的网站授权适用于 Chromium 页面。' : site.secure ? '此页面使用 HTTPS 加密连接。' : '此页面未建立有效的 HTTPS 连接。请勿在未加密的网站输入敏感信息。';
    $('#site-info-session').textContent = state.private ? '仅本次无痕会话' : '保存在此设备';
    const details = $('#site-certificate-details'); details.replaceChildren();
    const cert = site.security;
    for (const [label, value] of [['协议', cert?.protocol], ['证书主体', cert?.subjectName], ['颁发者', cert?.issuer], ['有效期起', cert?.validFrom && new Date(cert.validFrom * 1000).toLocaleString()], ['有效期止', cert?.validTo && new Date(cert.validTo * 1000).toLocaleString()], ['加密算法', cert?.cipher]]) {
      if (value) details.append(node('dt', label), node('dd', value));
    }
    if (!cert?.issuer) details.append(node('dt', '证书'), node('dd', '此页面的证书详情暂不可用；浏览器仍执行系统证书验证。'));
    const list = $('#site-info-permissions'); list.replaceChildren();
    for (const permission of site.permissions) {
      const row = node('label', undefined, 'permission-row'), select = node('select'); select.dataset.permission = permission.key; select.setAttribute('aria-label', permission.label);
      for (const [value, label] of [['ask', '每次询问'], ['allow', '允许'], ['block', '禁止']]) { const option = node('option', label); option.value = value; select.append(option); }
      select.value = permission.value; select.disabled = site.legacy || (!site.secure && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(site.origin));
      select.onchange = () => call('site-permission-set', { ...displayedSite, key: permission.key, value: select.value }); row.append(node('span', permission.label), select); list.append(row);
    }
  }
  $('#address-symbol').onclick = async () => {
    if (!state?.siteInfo) return;
    await call('popover-close'); displayedSite = { tabId: state.siteInfo.tabId, origin: state.siteInfo.origin }; renderSite();
    $('#site-info-cookies').textContent = '正在读取网站 Cookie 数量…'; $('#site-info-dialog').showModal(); window.browserDialogs.overlays();
    const summary = await call('site-data-summary', displayedSite); if (summary && $('#site-info-dialog').open) $('#site-info-cookies').textContent = '当前页面可访问 ' + summary.cookies + ' 个 Cookie（不会显示 Cookie 值）。';
  };
  $('#site-info-close').onclick = () => $('#site-info-dialog').close();
  $('#site-info-dialog').addEventListener('close', () => window.browserDialogs.overlays());
  $('#site-info-reload').onclick = async () => { $('#site-info-dialog').close(); await call('modal-state', false); await call('overlay', false); await call('reload'); };
  let inputTimer;
  function suggest() {
    const address = $('#address'), rect = $('#address-form').getBoundingClientRect();
    call('address-suggest', { query: address.value, anchor: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
  }
   $('#address').addEventListener('input', event => { clearTimeout(inputTimer); if (!event.isComposing) inputTimer = setTimeout(suggest, 150); });
   $('#address').addEventListener('compositionend', () => { clearTimeout(inputTimer); inputTimer = setTimeout(suggest, 150); });
  $('#address').addEventListener('keydown', async event => {
    if (event.isComposing || !['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); clearTimeout(inputTimer);
    const handled = await call('address-key', { key: event.key, query: $('#address').value });
    if (event.key === 'Enter') { if (!handled) $('#address-form').requestSubmit(); else $('#address').blur(); }
    else if (event.key === 'ArrowDown' && !handled) suggest();
    else if (event.key === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  function renderAddress() {
    const list = $('#address-suggestions'); list.hidden = false; list.replaceChildren();
    const options = node('div', undefined, 'address-candidate-list'); options.id = 'address-candidate-list'; options.setAttribute('role', 'listbox'); list.append(options);
    function highlight(title) {
      const span = node('span', undefined, 'candidate-title'), query = state.addressSuggestions.query.trim(), index = title.toLowerCase().indexOf(query.toLowerCase());
      if (query && index >= 0) { span.append(document.createTextNode(title.slice(0, index)), node('strong', title.slice(index, index + query.length)), document.createTextNode(title.slice(index + query.length))); } else span.textContent = title;
      return span;
    }
    for (const [index, item] of (state.addressSuggestions?.items || []).entries()) {
      const row = node('button', undefined, 'address-candidate' + (item.type === 'search' ? ' search-candidate' : '')); row.id = 'address-candidate-' + index; row.dataset.type = item.type; row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(index === state.addressSuggestions.selected));
      const symbol = node('span', undefined, 'candidate-symbol'); window.lunaSetIcon?.(symbol, { search: 'search', navigate: 'globe', tab: 'newtab', bookmark: 'star', history: 'history' }[item.type]);
      row.append(symbol, highlight(item.title), node('span', item.type === 'search' ? item.engine : { tab: '切换标签', bookmark: '收藏', history: '历史', navigate: '直达网站' }[item.type], 'candidate-kind'));
      if (item.type !== 'search') row.append(node('small', item.url));
      const query = state.addressSuggestions.query; row.onclick = () => call('address-select', { query, index, url: item.url, type: item.type }); options.append(row);
    }
    if (!options.children.length) options.append(node('p', '没有匹配的本地记录', 'candidate-empty'));
    const footer = node('div', undefined, 'address-filters'); footer.append(node('span', '筛选候选：'));
    for (const [value, label] of [['all', '全部'], ['history', '历史'], ['bookmark', '收藏'], ['tab', '标签']]) { const button = node('button', label); button.dataset.filter = value; button.setAttribute('aria-pressed', String(state.addressSuggestions.filter === value)); button.onclick = () => call('address-filter', value); footer.append(button); }
    footer.append(node('small', '↑↓ 选择 · Enter 打开')); list.append(footer);
    const selected = options.querySelector('[aria-selected="true"]'); if (selected) selected.scrollIntoView({ block: 'nearest' });
    window.popoverHost.initialized();
  }
  let folderId = null, editing = null;
  function folderOptions(select, current, excluded) {
    select.replaceChildren(); const root = node('option', '收藏夹根目录'); root.value = ''; select.append(root);
    for (const folder of state.bookmarkFolders || []) {
      if (folder.id === excluded) continue;
      const names = [folder.title]; let parent = folder.parentId, count = 0, invalid = false;
      while (parent && count++ < 32) { if (parent === excluded) { invalid = true; break; } const ancestor = state.bookmarkFolders.find(folder => folder.id === parent); if (!ancestor) break; names.unshift(ancestor.title); parent = ancestor.parentId; }
      if (invalid) continue; const option = node('option', names.join(' / ')); option.value = folder.id; select.append(option);
    }
    select.value = current || '';
  }
  function renderManager() {
    if (folderId && !state.bookmarkFolders.some(folder => folder.id === folderId)) folderId = null;
    folderOptions($('#bookmark-location'), folderId);
    const query = $('#bookmark-manager-search').value.trim().toLowerCase(), list = $('#bookmark-manager-list'); list.replaceChildren();
    const folders = state.bookmarkFolders.filter(folder => query ? folder.title.toLowerCase().includes(query) : folder.parentId === folderId);
    const entries = state.bookmarks.filter(entry => query ? (entry.title + entry.url).toLowerCase().includes(query) : entry.folderId === folderId);
    for (const entry of [...folders.map(folder => ({ ...folder, folder: true })), ...entries]) {
      const row = node('div', undefined, 'bookmark-manager-row'); row.dataset.id = entry.id;
      const open = node('button', undefined, 'bookmark-manager-open'); open.append(node('strong', (entry.folder ? '▸ ' : '') + entry.title), node('small', entry.folder ? '文件夹' : entry.url));
      open.onclick = async () => { if (entry.folder) { folderId = entry.id; $('#bookmark-manager-search').value = ''; renderManager(); } else { $('#bookmark-manager-dialog').close(); await call('modal-state', false); await call('overlay', false); await call('navigate', entry.url); } }; row.append(open);
      const edit = node('button', '编辑', 'text-button'); edit.onclick = () => editBookmark(entry, entry.folder); row.append(edit);
      const remove = node('button', '删除', 'text-button'); remove.onclick = () => call('bookmark-action', { action: entry.folder ? 'folder-delete' : 'delete', id: entry.id }); row.append(remove);
      if (!entry.folder) {
        row.draggable = true; row.ondragstart = event => { event.dataTransfer.setData('application/x-luna-bookmark', entry.id); event.dataTransfer.effectAllowed = 'move'; };
        row.ondragover = event => { if (event.dataTransfer.types.includes('application/x-luna-bookmark')) { event.preventDefault(); row.classList.add('drop-before'); } };
        row.ondragleave = () => row.classList.remove('drop-before'); row.ondrop = event => { event.preventDefault(); row.classList.remove('drop-before'); call('bookmark-action', { action: 'reorder', id: event.dataTransfer.getData('application/x-luna-bookmark'), beforeId: entry.id }); };
      }
      list.append(row);
    }
    if (!list.children.length) list.append(node('p', query ? '无匹配收藏' : '此文件夹为空', 'essentials-note'));
  }
  async function editBookmark(entry, folder) {
    const latest = await call('state'); if (latest) state = latest;
    editing = { id: entry?.id, folder }; $('#bookmark-editor-title').textContent = (entry ? '编辑' : '新建') + (folder ? '文件夹' : '收藏');
    $('#bookmark-edit-title').value = entry?.title || ''; $('#bookmark-edit-url').value = entry?.url || ''; $('#bookmark-edit-url-row').hidden = folder;
    $('#bookmark-edit-url').required = !folder; folderOptions($('#bookmark-edit-folder'), entry ? folder ? entry.parentId : entry.folderId : folderId, folder ? entry?.id : undefined);
    $('#bookmark-editor-error').textContent = ''; $('#bookmark-editor-dialog').showModal(); window.browserDialogs.overlays();
  }
  async function openBookmarks(id) {
    folderId = id || null; await call('popover-close'); const latest = await call('state'); if (latest) state = latest; $('#bookmark-manager-search').value = ''; renderManager(); $('#bookmark-manager-dialog').showModal(); window.browserDialogs.overlays();
  }
  for (const name of ['manager', 'editor']) {
    $('#bookmark-' + name + '-close').onclick = () => $('#bookmark-' + name + '-dialog').close();
    $('#bookmark-' + name + '-dialog').addEventListener('close', () => window.browserDialogs.overlays());
  }
  $('#bookmark-editor-cancel').onclick = () => $('#bookmark-editor-dialog').close();
  $('#bookmark-editor-form').onsubmit = async event => {
    event.preventDefault();
    try { await bridge.command('bookmark-action', { action: editing.folder ? 'folder-save' : 'save', id: editing.id, title: $('#bookmark-edit-title').value, url: $('#bookmark-edit-url').value, folderId: $('#bookmark-edit-folder').value, parentId: $('#bookmark-edit-folder').value }); $('#bookmark-editor-dialog').close(); }
    catch (error) { $('#bookmark-editor-error').textContent = String(error.message).replace(/^Error invoking remote method .*?:\s*(?:Error: )?/, ''); }
  };
  $('#bookmark-folder-new').onclick = () => editBookmark(null, true); $('#bookmark-entry-new').onclick = () => editBookmark(null, false);
  $('#bookmark-location').onchange = () => { folderId = $('#bookmark-location').value || null; renderManager(); }; $('#bookmark-manager-search').oninput = renderManager;
  $('#bookmark-manage').onclick = () => call('bookmark-manager');
  $('#bookmark-import').onclick = async () => { const result = await call('bookmark-import'); if (result) $('#bookmark-manager-notice').textContent = '已导入 ' + result.added + ' 条收藏和 ' + result.folders + ' 个文件夹，跳过 ' + result.skipped + ' 条。'; };
  $('#bookmark-export').onclick = () => call('bookmark-export');
  $('#default-browser-register').onclick = async () => { $('#default-browser-register').disabled = true; await call('default-browser-register'); $('#default-browser-register').disabled = false; };
  let defaultChecked = false;
  function renderBookmarkPanel(list, query) {
    const folders = state.bookmarkFolders || []; if (!folders.length) return false;
    for (const folder of folders.filter(folder => !folder.parentId && (!query || folder.title.toLowerCase().includes(query)))) {
      const row = node('div', undefined, 'list-entry'), button = node('button', '▸ ' + folder.title, 'entry-open'); button.onclick = () => call('bookmark-manager'); row.append(button); list.append(row);
    }
    for (const entry of state.bookmarks.filter(entry => (query || !entry.folderId) && (!query || (entry.title + entry.url).toLowerCase().includes(query)))) {
      const row = node('div', undefined, 'list-entry'), button = node('button', entry.title, 'entry-open'); button.title = entry.url; button.onclick = () => call('navigate', entry.url); row.append(button); list.append(row);
    }
    return list.children.length > 0;
  }
  window.essentialsUI = { renderAddress, renderBookmarkPanel, openBookmarks, shortcut(value) { if (value.action === 'bookmark-manager') openBookmarks(); }, update(next) {
    state = next; if (window.popoverHost) return;
    $('#address').setAttribute('aria-expanded', String(state.popover === 'address'));
    if (state.popover === 'address' && state.addressSuggestions.selected >= 0) $('#address').setAttribute('aria-activedescendant', 'address-candidate-' + state.addressSuggestions.selected); else $('#address').removeAttribute('aria-activedescendant');
    $('#address-symbol').disabled = !state.siteInfo; if ($('#site-info-dialog').open) renderSite(); if ($('#bookmark-manager-dialog').open) renderManager();
    if (!defaultChecked) { defaultChecked = true; call('default-browser-status').then(result => { if (!result) return; $('#default-browser-status').textContent = result.isDefault ? 'luna 已是 HTTP 和 HTTPS 链接的默认浏览器' : result.available ? result.platform === 'darwin' ? '在系统提示或 macOS 默认网页浏览器设置中选择 luna' : '注册后请在 Windows 默认应用中选择 luna' : '请使用正式成品设置默认浏览器'; $('#default-browser-register').disabled = !result.available; }); }
  } };
})();
