(() => {
  const $ = selector => document.querySelector(selector), bridge = window.browser;
  const menu = $('#browser-menu'), submenu = $('#browser-menu-submenu');
  let current, openSection = null, opener = null, hoverTimer;
  const webPage = tab => !!tab && !tab.error && /^https?:\/\//.test(tab.url);
  const activeTab = () => current?.tabs.find(tab => tab.id === current.activeId);
  const call = (action, payload) => bridge.command(action, payload).catch(error => window.lunaNotify?.(error.message.replace(/^Error invoking remote method .*?:\s*(?:Error: )?/, '')));
  function size() {
    if (window.popoverHost?.kind !== 'browser') return;
    const rootHeight = menu.offsetHeight;
    const inline = current?.windowWidth < 660;
    submenu.dataset.inline = String(inline);
    const width = 636;
    if (openSection && !inline) {
      const requested = opener.getBoundingClientRect().top - menu.getBoundingClientRect().top;
      submenu.style.top = Math.max(0, Math.min(requested, rootHeight - submenu.offsetHeight)) + 'px';
    }
    call('popover-size', { width, height: menu.offsetHeight + 24 });
  }
  function closeSubmenu(restoreFocus = false) {
    clearTimeout(hoverTimer);
    const previous = opener; openSection = null; opener = null; submenu.hidden = true;
    menu.querySelectorAll('[data-menu-submenu]').forEach(button => button.setAttribute('aria-expanded', 'false'));
    size(); if (restoreFocus) previous?.focus();
  }
  function openSubmenu(button, focus = false) {
    clearTimeout(hoverTimer); if (button.disabled) return;
    if (openSection === button.dataset.menuSubmenu) {
      if (focus) submenu.querySelector('[data-submenu-page]:not([hidden]) button:not([disabled])')?.focus();
      return;
    }
    openSection = button.dataset.menuSubmenu; opener = button;
    submenu.hidden = false;
    submenu.querySelectorAll('[data-submenu-page]').forEach(page => page.hidden = page.dataset.submenuPage !== openSection);
    menu.querySelectorAll('[data-menu-submenu]').forEach(item => item.setAttribute('aria-expanded', String(item === button)));
    size(); requestAnimationFrame(size);
    if (focus) submenu.querySelector('[data-submenu-page]:not([hidden]) button:not([disabled])')?.focus();
  }
  menu.querySelectorAll('[data-menu-submenu]').forEach(button => {
    button.onclick = () => openSection === button.dataset.menuSubmenu ? closeSubmenu(true) : openSubmenu(button, true);
    button.onpointerenter = () => { clearTimeout(hoverTimer); hoverTimer = setTimeout(() => openSubmenu(button), 140); };
  });
  menu.querySelectorAll('[data-browser-action]').forEach(button => {
    button.onclick = () => { clearTimeout(hoverTimer); call('browser-menu-action', button.dataset.browserAction); };
    button.onpointerenter = () => { if (!button.closest('#browser-menu-submenu')) { clearTimeout(hoverTimer); hoverTimer = setTimeout(() => closeSubmenu(), 320); } };
  });
  submenu.onpointerenter = () => clearTimeout(hoverTimer);
  menu.addEventListener('pointerleave', () => clearTimeout(hoverTimer));
  $('#menu-submenu-back').onclick = () => closeSubmenu(true);
  $('#menu-zoom-out').onclick = () => call('browser-menu-action', 'zoom-out');
  $('#menu-zoom-in').onclick = () => call('browser-menu-action', 'zoom-in');
  $('#menu-zoom-reset').onclick = () => call('browser-menu-action', 'zoom-reset');
  $('#menu-fullscreen').onclick = () => call('browser-menu-action', 'fullscreen');
  $('#help-close').onclick = $('#help-done').onclick = () => $('#help-dialog').close();
  $('#help-dialog').addEventListener('close', () => window.browserDialogs.overlays());
  function visibleButtons() {
    const root = openSection && submenu.contains(document.activeElement) ? submenu : $('.browser-menu-root');
    return [...root.querySelectorAll('button:not([disabled])')].filter(button => button.getClientRects().length);
  }
  document.addEventListener('keydown', event => {
    if (window.popoverHost?.kind !== 'browser' || event.ctrlKey || event.metaKey || event.altKey) return;
    const focused = document.activeElement;
    if (event.key === 'Escape' && openSection || event.key === 'ArrowLeft' && openSection) { event.preventDefault(); event.stopImmediatePropagation(); closeSubmenu(true); return; }
    if (event.key === 'ArrowRight' && focused.dataset.menuSubmenu) { event.preventDefault(); openSubmenu(focused, true); return; }
    if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
    const buttons = visibleButtons(); if (!buttons.length) return;
    event.preventDefault(); const index = buttons.indexOf(focused);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next].focus();
  });
  window.browserMenu = {
    hasSubmenu: () => !!openSection,
    showHelp: () => { $('#help-dialog').showModal(); window.browserDialogs.overlays(); },
    update(state) {
      current = state; const tab = activeTab(), page = webPage(tab);
      menu.dataset.defaultColors = String(!state.settings.appearance?.regions.menu.color);
      menu.querySelectorAll('[data-needs-page]').forEach(button => { button.disabled = !page; button.title = page ? '' : '请先打开网页'; });
      $('#menu-zoom-out').disabled = !page || tab.zoom <= 50;
      $('#menu-zoom-in').disabled = !page || tab.zoom >= 200;
      $('#menu-zoom-reset').disabled = !page; $('#menu-zoom-reset').textContent = (page ? tab.zoom : 100) + '%';
      $('#menu-fullscreen').title = state.fullscreen ? '退出全屏 (F11)' : '全屏 (F11)'; $('#menu-fullscreen').setAttribute('aria-label', $('#menu-fullscreen').title);
      $('#menu-split-label').textContent = state.split ? '退出分屏' : '分屏';
      for (const action of ['passwords','edge-store','chrome-store']) menu.querySelectorAll('[data-browser-action="'+action+'"]').forEach(button => { button.disabled = state.private === true; button.title = state.private ? '请在普通窗口管理密码或安装扩展' : ''; });
      menu.querySelector('[data-menu-submenu="extensions"]').disabled = false;
      $('#menu-ie-label').textContent = tab?.compatibility?.enabled ? '退出 IE 兼容模式' : '使用 IE 兼容模式重新加载';
      const reloadable = !!tab && /^https?:\/\//.test(tab.url);
      $('#menu-ie-mode').disabled = !reloadable || !tab?.compatibility?.available;
      $('#menu-ie-mode').hidden = state.platform === 'darwin';
      $('#menu-ie-mode').title = tab?.compatibility?.reason || (!reloadable ? '请先打开网页' : '使用 IE 内核，并同步网站 Cookie 与切换时的网站存储');
      for(const action of ['devtools','screenshot-full']) {const button=menu.querySelector('[data-browser-action="'+action+'"]');if(tab?.compatibility?.enabled){button.disabled=true;button.title='此功能仅支持普通 Chromium 模式';}}
      if (window.popoverHost?.kind === 'browser') requestAnimationFrame(size);
    },
  };
})();
