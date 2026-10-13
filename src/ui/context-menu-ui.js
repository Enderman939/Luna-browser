const root = document.getElementById('root'), submenu = document.getElementById('submenu');
let data, activeParent, submenuStack = [], hoverTimer;
const searchIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>';
function fit() {
  const height = Math.max(root.getBoundingClientRect().height, submenu.hidden ? 0 : submenu.getBoundingClientRect().height) + 16;
  window.contextMenu.fit({ height, columns: submenu.hidden ? 1 : 2 });
}
function closeSubmenu(focus = false) {
  clearTimeout(hoverTimer); submenu.hidden = true; submenuStack = [];
  activeParent?.setAttribute('aria-expanded', 'false'); if (focus) activeParent?.focus(); activeParent = null; fit();
}
function showSubmenu(item, button, nested = false) {
  clearTimeout(hoverTimer);
  if (!nested) { activeParent?.setAttribute('aria-expanded', 'false'); activeParent = button; submenuStack = []; }
  submenuStack.push(item); activeParent.setAttribute('aria-expanded', 'true'); submenu.hidden = false;
  render(submenu, item.submenu, submenuStack.length > 1); fit();
}
function render(container, items, back = false) {
  container.replaceChildren();
  if (back) {
    const button = document.createElement('button'); button.className = 'back'; button.textContent = '‹  ' + submenuStack.at(-1).label;
    button.onclick = () => { submenuStack.pop(); render(submenu, submenuStack.at(-1).submenu, submenuStack.length > 1); fit(); submenu.querySelector('button:not(:disabled)')?.focus(); };
    container.append(button);
  }
  for (const item of items) {
    if (item.type === 'separator') { const separator = document.createElement('div'); separator.className = 'separator'; separator.setAttribute('role', 'separator'); container.append(separator); continue; }
    const button = document.createElement('button'); button.dataset.id = item.id; button.disabled = !item.enabled;
    button.setAttribute('aria-label', item.label);
    button.setAttribute('role', ['checkbox', 'radio'].includes(item.type) ? 'menuitemcheckbox' : 'menuitem');
    if (['checkbox', 'radio'].includes(item.type)) button.setAttribute('aria-checked', item.checked);
    const symbol = document.createElement('span'); symbol.className = 'symbol';
    if (item.icon) { const image = document.createElement('img'); image.src = item.icon; image.alt = ''; symbol.append(image); }
    else if (item.symbol === 'search') {
      const custom = window.lunaAppearanceModel.assetURL(window.lunaAppearance.current.icons.custom.search);
      if (custom) { const image = document.createElement('img'); image.src = custom; image.alt = ''; symbol.append(image); }
      else symbol.innerHTML = searchIcon;
    }
    else if (item.checked) symbol.textContent = '✓';
    const label = document.createElement('span'); label.className = 'label'; label.textContent = item.label; button.title = item.label; button.append(symbol, label);
    if (item.submenu) {
      button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
      const arrow = document.createElement('span'); arrow.className = 'arrow'; arrow.textContent = '›'; button.append(arrow);
      button.onclick = () => { showSubmenu(item, button, container === submenu); submenu.querySelector('button:not(:disabled)')?.focus(); };
      // Nested menus use a back row, keeping the entire menu within the display.
      button.onmouseenter = () => { clearTimeout(hoverTimer); if (container === root && activeParent !== button) hoverTimer = setTimeout(() => showSubmenu(item, button), 140); };
    } else {
      if (item.shortcut) { const shortcut = document.createElement('span'); shortcut.className = 'shortcut'; shortcut.textContent = item.shortcut; button.append(shortcut); }
      button.onclick = () => window.contextMenu.action(item.id);
      button.onmouseenter = () => { if (container === root) closeSubmenu(); };
    }
    container.append(button);
  }
  container.style.maxHeight = Math.max(80, data.maxHeight - 16) + 'px';
}
document.addEventListener('keydown', event => {
  const container = document.activeElement?.closest('.menu') || root;
  const buttons = [...container.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(document.activeElement);
  if (event.key === 'Escape') { event.preventDefault(); submenu.hidden ? window.contextMenu.close() : closeSubmenu(true); }
  else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  } else if (event.key === 'ArrowRight' && document.activeElement?.hasAttribute('aria-haspopup')) { event.preventDefault(); document.activeElement.click(); }
  else if (event.key === 'ArrowLeft' && !submenu.hidden) { event.preventDefault(); closeSubmenu(true); }
});
document.addEventListener('contextmenu', event => { event.preventDefault(); window.contextMenu.close(); });
window.contextMenu.onClosing(() => document.body.classList.add('closing'));
window.contextMenu.onAppearance(value => window.lunaAppearance.apply(value.appearance, value.dark, 'menu'));
window.contextMenu.data().then(value => {
  data = value; window.lunaAppearance.apply(data.appearance, data.dark, 'menu'); document.body.dataset.side = data.side;
  render(root, data.items); fit();
});
