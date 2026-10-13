(() => {
  const $ = selector => document.querySelector(selector), bridge = window.browser;
  let state, entries = [], blocked = [], editId, fetched = 0, busy = false, secretTimer, lastPopup = '', revision = -1, selected = 0;
  const node = (tag, cls, text) => { const element = document.createElement(tag); element.className = cls || ''; if (text !== undefined) element.textContent = text; return element; };
  async function call(action, payload) {
    try { return await bridge.command(action, payload); }
    catch (error) { window.lunaNotify?.(error.message.replace(/^Error invoking remote method .*?:\s*(?:Error: )?/, '')); return null; }
  }
  function draw() {
    const query = $('#password-search').value.trim().toLowerCase(), list = $('#password-list'); list.replaceChildren();
    const matching = entries.filter(entry => (entry.origin + ' ' + entry.username).toLowerCase().includes(query)).sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username));
    $('#password-count').textContent = entries.length;
    if (!matching.length) list.append(node('div', 'password-empty', query ? '没有匹配的账号' : '暂无已保存的密码'));
    for (const entry of matching) {
      const row = node('div', 'password-entry'), symbol = node('span', 'password-site-mark', new URL(entry.origin).hostname[0].toUpperCase());
      const text = node('div', 'password-entry-text'); text.append(node('strong', '', new URL(entry.origin).host), node('span', '', entry.username || '未填写账号'));
      const edit = node('button', 'text-button', '查看 / 编辑'); edit.setAttribute('aria-label', '编辑 ' + entry.username + ' ' + entry.origin); edit.onclick = () => openEdit(entry);
      const remove = node('button', 'text-button', '删除'); remove.onclick = async () => { if (await call('password-delete', entry.id)) refresh(true); };
      row.append(symbol, text, edit, remove); list.append(row);
    }
    const exceptions = $('#password-blocked'); exceptions.replaceChildren();
    if (!blocked.length) exceptions.append(node('div', 'password-empty', '暂无例外网站'));
    for (const origin of blocked) {
      const row = node('div', 'password-entry'), text = node('div', 'password-entry-text', origin);
      const remove = node('button', 'text-button', '允许保存'); remove.onclick = async () => { await call('password-unblock', origin); refresh(true); };
      row.append(text, remove); exceptions.append(row);
    }
  }
  async function refresh(force = false) {
    if (window.popoverHost || busy || !force && Date.now() - fetched < 1500) return;
    busy = true;
    try { const data = await bridge.command('password-list'); entries = data.entries; blocked = data.blocked; fetched = Date.now(); $('#password-vault-error').textContent = ''; draw(); }
    catch (error) { $('#password-vault-error').textContent = state?.passwords?.error || '密码库暂不可用'; }
    finally { busy = false; }
  }
  function clearSecret() { clearTimeout(secretTimer); $('#password-value').value = ''; $('#password-value').type = 'password'; $('#password-show').textContent = '显示'; }
  function expiry() { clearTimeout(secretTimer); secretTimer = setTimeout(() => { clearSecret(); if ($('#password-dialog').open) $('#password-form-error').textContent = '密码已自动清除，请重新输入或重新打开。'; }, 30000); }
  async function openEdit(entry) {
    const detail = entry && await call('password-detail', entry.id); if (entry && !detail) return;
    clearSecret(); editId = detail?.id; $('#password-form').reset();
    $('#password-dialog-title').textContent = entry ? '编辑密码' : '添加密码';
    $('#password-origin').value = detail?.origin || ''; $('#password-username').value = detail?.username || ''; $('#password-value').value = detail?.password || '';
    $('#password-form-error').textContent = ''; $('#password-dialog').showModal(); window.browserDialogs.overlays();
    if (detail) expiry(); $('#password-origin').focus();
  }
  $('#password-add').onclick = () => openEdit(); $('#password-search').oninput = draw;
  $('#password-import').onclick = async () => { $('#password-import').disabled = true; try { const result = await call('password-import'); if (result) { refresh(true); window.lunaNotify?.('已导入 ' + result.added + ' 个密码，跳过 ' + result.skipped + ' 条已有或无效记录'); } } finally { $('#password-import').disabled = false; } };
  $('#password-dialog-close').onclick = $('#password-dialog-cancel').onclick = () => { clearSecret(); $('#password-dialog').close(); };
  $('#password-dialog').addEventListener('cancel', clearSecret);
  $('#password-dialog').addEventListener('close', () => { clearSecret(); editId = null; window.browserDialogs.overlays(); });
  $('#password-show').onclick = () => { const input = $('#password-value'); input.type = input.type === 'password' ? 'text' : 'password'; $('#password-show').textContent = input.type === 'password' ? '显示' : '隐藏'; expiry(); };
  $('#password-value').addEventListener('input', expiry);
  $('#password-generate').onclick = async () => { const value = await call('password-generate'); if (value) { $('#password-value').value = value; expiry(); window.modalSource?.schedule(); } };
  $('#password-form').onsubmit = async event => {
    event.preventDefault();
    try {
      await bridge.command('password-save', { id: editId, origin: $('#password-origin').value, username: $('#password-username').value, password: $('#password-value').value });
      clearSecret(); $('#password-dialog').close(); refresh(true); window.lunaNotify?.('密码已加密保存');
    } catch (error) { $('#password-form-error').textContent = error.message.replace(/^Error invoking remote method .*?:\s*(?:Error: )?/, ''); }
  };
  $('#passwords-button').onclick = () => { const rect = $('#passwords-button').getBoundingClientRect(); call('popover-open', { kind: 'passwords', anchor: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }); };
  $('#password-popup-close').onclick = () => call('popover-close');
  $('#password-manage').onclick = () => call('password-settings');
  function popup(value) {
    const container = $('#password-popup-content'); container.replaceChildren(); $('#password-popup').hidden = false;
    const field = value?.fieldPopup === true, pending = !field && value?.pending;
    $('#password-popup').dataset.presentation = field ? 'fill' : 'manager';
    $('#password-popup-title').textContent = pending ? pending.update ? '更新密码？' : '保存密码？' : field ? '已保存的密码' : '密码管理器';
    $('#password-popup').setAttribute('aria-label', $('#password-popup-title').textContent);
    $('#password-popup-content').setAttribute('role', field ? 'listbox' : 'group');
    $('#password-popup-content').setAttribute('aria-label', '已保存的账号');
    window.lunaSetIcon?.($('#password-manage span'), field ? 'key' : 'right');
    if (!value?.available) { container.append(node('p', 'password-popup-note', value?.error || '密码库暂不可用')); return; }
    if (pending) {
      container.append(node('div', 'password-popup-site', new URL(pending.origin).host), node('div', 'password-popup-account', pending.username || '未填写账号'), node('div', 'password-masked', '••••••••••••'));
      const actions = node('div', 'password-popup-actions'), accept = node('button', 'primary-button', pending.update ? '更新' : '保存'), later = node('button', 'secondary-button', '暂不保存');
      accept.id = 'password-accept'; accept.onclick = () => call('password-accept'); later.id = 'password-dismiss'; later.onclick = () => call('password-dismiss'); actions.append(later, accept); container.append(actions);
      const never = node('button', 'text-button password-never', '此网站不再询问'); never.id = 'password-never'; never.onclick = () => call('password-never'); container.append(never);
    } else {
      if (!field) container.append(node('div', 'password-popup-site', value.origin ? new URL(value.origin).host : '打开网站以使用已保存的密码'));
      if (!state.settings.autofillPasswords) container.append(node('p', 'password-popup-note', '自动填充已关闭，可在管理页开启。'));
      else if (!value.accounts.length) container.append(node('p', 'password-popup-note', value.blocked ? '此网站已设为不再保存。' : '此网站暂无已保存账号'));
      const query = field ? value.query.toLowerCase() : '';
      const accounts = !query || value.accounts.some(entry => entry.username.toLowerCase() === query) ? value.accounts : value.accounts.filter(entry => entry.username.toLowerCase().includes(query));
      selected = 0;
      if (field && value.accounts.length && !accounts.length) container.append(node('p', 'password-popup-note', '没有匹配的已保存账号'));
      for (const entry of accounts) {
        const button = node('button', 'password-account-choice'); button.dataset.credentialId = entry.id; button.disabled = !state.settings.autofillPasswords;
        button.setAttribute('aria-label', (entry.username || '未填写账号') + '，填充账号与密码');
        if (field) { button.setAttribute('role', 'option'); button.onpointerenter = () => { selected = [...container.querySelectorAll('.password-account-choice')].indexOf(button); highlight(); }; }
        const mask = node('span', 'password-choice-mask', '••••••••'); mask.setAttribute('aria-hidden', 'true');
        button.append(node('strong', '', entry.username || '未填写账号'), mask); button.onclick = () => call('password-fill', entry.id); container.append(button);
      }
      highlight();
    }
  }
  function highlight() {
    const buttons = [...$('#password-popup-content').querySelectorAll('.password-account-choice')];
    buttons.forEach((button, index) => { button.classList.toggle('selected', index === selected); if (state?.passwords?.fieldPopup) button.setAttribute('aria-selected', String(index === selected)); });
    buttons[selected]?.scrollIntoView({ block: 'nearest' });
  }
  function chooseKey(key) {
    if (!state?.passwords?.fieldPopup) return;
    const buttons = [...$('#password-popup-content').querySelectorAll('.password-account-choice')];
    if (key === 'Escape') { call('popover-close'); return; }
    if (!buttons.length) return;
    if (key === 'Enter') buttons[selected]?.click();
    else { selected = (selected + (key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length; highlight(); }
  }
  bridge.onPasswordKey(chooseKey);
  bridge.onPasswordPlacement(placement => { if (!window.popoverHost) return; $('#password-popup').dataset.edge = placement.edge; $('#password-popup').style.setProperty('--password-pointer', placement.pointer + 'px'); });
  document.addEventListener('keydown', event => {
    if (window.popoverHost?.kind !== 'passwords' || !state?.passwords?.fieldPopup || !['ArrowDown','ArrowUp','Enter'].includes(event.key)) return;
    if (event.key === 'Enter' && event.target.closest('button') && !event.target.closest('.password-account-choice')) return;
    event.preventDefault(); chooseKey(event.key);
  });
  window.passwordUI = { refresh, update(next) {
    state = next; $('#passwords-button').classList.toggle('has-password', !!next.passwords?.pending); $('#passwords-button').classList.toggle('active', next.popover === 'passwords');
    $('#passwords-button').setAttribute('aria-expanded', String(next.popover === 'passwords'));
    $('#password-vault-error').textContent = next.passwords?.error || '';
    if (!window.popoverHost && revision !== next.passwords?.revision) { revision = next.passwords?.revision; fetched = 0; if (!document.querySelector('[data-group="passwords"]').hidden && !$('#settings-page').hidden) refresh(true); }
    if (window.popoverHost?.kind === 'passwords') { const signature = JSON.stringify([next.passwords, next.settings.autofillPasswords]); if (signature !== lastPopup) { lastPopup = signature; popup(next.passwords); } }
  } };
})();
