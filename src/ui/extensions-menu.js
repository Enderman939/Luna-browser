(() => {
  const $ = selector => document.querySelector(selector);
  const menu = $('#extensions-menu'), button = $('#extensions-button'), list = $('#extensions-menu-list');
  const more = $('#extension-more-menu');
  let current = { extensions: [], tabs: [], extensionsEnabled: true }, pendingGlobal = null;
  const element = (tag, className, text) => { const node = document.createElement(tag); node.className = className || ''; if (text !== undefined) node.textContent = text; return node; };
  const showError = error => window.lunaNotify?.(String(error.message || '操作失败').replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/, '').replace(/^Error:\s*/, ''));
  const call = async (action, payload) => { try { return await window.browser.command(action, payload); } catch (error) { showError(error); } };
  function glyph(node, name) { window.lunaSetIcon(node, name); }
  function icon(node, extension) {
    if (extension.icon?.startsWith('data:image/')) { const image = element('img'); image.src = extension.icon; image.alt = ''; node.append(image); }
    else glyph(node, 'puzzle');
  }
  function siteLabel(extension) {
    if (current.private) return extension.enabled ? '已授权在无痕中运行 · 独立存储' : '无痕扩展未加载';
    if (current.extensionsEnabled === false) return '扩展已暂停';
    if (!extension.enabled) return '已停用';
    const tab = current.tabs.find(tab => tab.id === current.activeId);
    if (!/^https?:/.test(tab?.url || '')) return '浏览器页面';
    if (extension.hosts?.includes('<all_urls>') || extension.hosts?.some(pattern => pattern === '*://*/*' || pattern === 'https://*/*')) return '可访问所有网站';
    return extension.hosts?.length ? '访问权限由扩展声明' : '无需网站访问权限';
  }
  function filterToolbar() {
    if (window.popoverHost) return;
    const root = $('#extension-actions');
    const pinned = current.extensions.filter(extension => extension.pinned && extension.enabled);
    const ids = new Set(pinned.map(extension => extension.id));
    for (const node of root.querySelectorAll('button')) if (!ids.has(node.dataset.id)) node.remove();
    for (const extension of pinned) {
      let action = root.querySelector('[data-id="' + extension.id + '"]');
      if (!action) { action = element('button', 'icon-button extension-toolbar-action'); action.dataset.id = extension.id; root.append(action); }
      action.title = extension.name; action.setAttribute('aria-label', extension.name);
      if (action.dataset.icon !== extension.icon) { action.replaceChildren(); icon(action, extension); action.dataset.icon = extension.icon; }
      action.onclick = () => launch(extension, action).catch(showError);
    }
  }
  function position() {
    if (window.popoverHost) return;
    const rect = button.getBoundingClientRect();
    menu.style.top = Math.round(rect.bottom + 8) + 'px';
    menu.style.right = Math.max(12, innerWidth - rect.right) + 'px';
    menu.style.maxHeight = Math.max(180, innerHeight - rect.bottom - 24) + 'px';
  }
  function close() {
    menu.hidden = true; more.hidden = true; button.classList.remove('active'); button.setAttribute('aria-expanded', 'false');
    if (window.popoverHost) window.popoverHost.close();
    else if (current.popover === 'extensions') call('popover-close');
  }
  async function launch(extension, source) {
    if (!extension.enabled) return;
    if (!extension.hasAction) { if (extension.options) { close(); window.browserDialogs.overlays(); await call('extension-options', extension.id); } return; }
    const rect = source.getBoundingClientRect(), tab = current.tabs.find(tab => tab.id === current.activeId);
    await call('extension-launch', { id: extension.id, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
  }
  function openMore(extension, source) {
    if (!more.hidden && more.dataset.id === extension.id) { more.hidden = true; return; }
    more.replaceChildren(); more.dataset.id = extension.id;
    const actions = current.private ? [['extension-options', '无痕扩展选项', !extension.options || !extension.enabled]] : [['extension-options', '扩展选项', !extension.options || !extension.enabled], ['toggle', extension.configuredEnabled === false ? '启用扩展' : '停用扩展', false], ['extension-remove', '移除扩展', false]];
    for (const [action, label, disabled] of actions) {
      const item = element('button', '', label); item.disabled = disabled;
      item.onclick = async () => {
        if (action === 'toggle') await call('extension-enable', { id: extension.id, enabled: extension.configuredEnabled === false });
        else { close(); window.browserDialogs.overlays(); await call(action, extension.id); }
        more.hidden = true;
      }; more.append(item);
    }
    more.hidden = false;
    const top = source.getBoundingClientRect().bottom - menu.getBoundingClientRect().top;
    more.style.top = Math.min(Math.max(80, top), menu.offsetHeight - 140) + 'px';
  }
  function render() {
    const focused = document.activeElement?.dataset?.focusKey;
    list.replaceChildren();
    $('#extensions-global-enable').checked = pendingGlobal ?? (current.extensionsEnabled !== false);
    $('#extensions-global-enable').disabled = current.private || pendingGlobal !== null || !current.extensions.length;
    $('#extensions-menu-store').hidden = current.private === true;
    $('#extensions-menu-manage').textContent = current.private ? '在普通窗口管理无痕授权' : '管理扩展程序';
    const tab = current.tabs.find(tab => tab.id === current.activeId);
    $('#extensions-current-site').textContent = /^https?:/.test(tab?.url || '') ? '当前网站：' + new URL(tab.url).hostname : '';
    const extensions = current.extensions.filter(extension => extension.configuredEnabled !== false);
    if (!extensions.length) list.append(element('div', 'extensions-menu-empty', current.private ? '没有获准运行的扩展。请在普通窗口的扩展管理页授权，关闭全部无痕窗口后重新打开。' : '没有已启用的扩展程序'));
    for (const extension of extensions) {
      const row = element('div', 'extensions-menu-row'); row.dataset.id = extension.id;
      const open = element('button', 'extension-launch'); open.title = extension.name; open.dataset.focusKey = 'launch-' + extension.id;
      open.disabled = !extension.enabled || !extension.hasAction && !extension.options;
      const symbol = element('span', 'extension-menu-icon'); icon(symbol, extension);
      const text = element('span', 'extension-menu-text'); text.append(element('strong', '', extension.name), element('small', '', siteLabel(extension))); open.append(symbol, text);
      open.onclick = () => launch(extension, row).catch(showError);
      const pin = element('button', 'icon-button extension-pin'); pin.dataset.focusKey = 'pin-' + extension.id;
      pin.classList.toggle('pinned', extension.pinned); glyph(pin, extension.pinned ? 'pin' : 'unpin');
      pin.title = extension.pinned ? '从工具栏取消固定' : '固定到工具栏'; pin.setAttribute('aria-label', pin.title + ' ' + extension.name); pin.setAttribute('aria-pressed', String(!!extension.pinned));
      pin.onclick = () => call('extension-pin', { id: extension.id, pinned: !extension.pinned });
      pin.hidden = current.private === true;
      const options = element('button', 'icon-button extension-more'); glyph(options, 'more'); options.dataset.focusKey = 'more-' + extension.id; options.title = '更多操作'; options.setAttribute('aria-label', extension.name + ' 更多操作'); options.onclick = () => openMore(extension, options);
      row.append(open, pin, options); list.append(row);
    }
    if (focused) list.querySelector('[data-focus-key="' + focused + '"]')?.focus();
    position();
  }
  function toggle() {
    if (!window.popoverHost) {
      const rect = button.getBoundingClientRect();
      call('popover-open', { kind: 'extensions', anchor: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }); return;
    }
    if (!menu.hidden) { close(); window.browserDialogs.overlays(); return; }
    $('#panel').hidden = true; $('#browser-menu').hidden = true; $('#shade').hidden = true;
    menu.hidden = false; button.classList.add('active'); button.setAttribute('aria-expanded', 'true'); render(); window.browserDialogs.overlays();
  }
  $('#extensions-global-enable').onchange = async () => {
    pendingGlobal = $('#extensions-global-enable').checked; render();
    await call('extensions-enable', pendingGlobal);
    const latest = await call('state'); pendingGlobal = null;
    if (latest) current = latest; if (!menu.hidden) render();
  };
  $('#extensions-menu-manage').onclick = () => { close(); window.browserDialogs.overlays(); call('extensions'); };
  $('#extensions-menu-store').onclick = () => { close(); window.browserDialogs.overlays(); call('extension-store'); };
  document.addEventListener('pointerdown', event => {
    if (!window.popoverHost && !event.target.closest('#extensions-button,#downloads-button,#history-button,#panel-button,#bookmarks-button,#menu-button,#extension-actions,#passwords-button')) call('popover-close');
    if (!menu.hidden && !menu.contains(event.target) && !button.contains(event.target)) { close(); window.browserDialogs.overlays(); }
  });
  addEventListener('resize', () => { if (!menu.hidden) position(); });
  window.extensionMenu = { toggle, close, update: state => {
    current = state; filterToolbar();
    if (window.popoverHost?.kind === 'extensions') { menu.hidden = false; render(); window.popoverHost.initialized(); }
    else { button.classList.toggle('active', state.popover === 'extensions'); button.setAttribute('aria-expanded', String(state.popover === 'extensions')); }
  } };
})();
