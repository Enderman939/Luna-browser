(() => {
  if (window.popoverHost) return;
  const $ = selector => document.querySelector(selector), bridge = window.browser;
  const dialog = $('#browser-import-dialog'), names = { bookmarks: '收藏', history: '历史', downloads: '下载记录', passwords: '密码' };
  let profiles = [], busy = false;
  const text = (tag, value) => { const element = document.createElement(tag); element.textContent = value; return element; };
  const message = error => String(error.message || error).replace(/^Error invoking remote method .*?:\s*(?:Error: )?/, '');
  function controls() {
    for (const id of ['browser-import-submit', 'browser-import-refresh', 'browser-import-close', 'browser-import-password-csv', 'browser-import-profile']) $(('#' + id)).disabled = busy || !profiles.length && id === 'browser-import-submit';
    for (const checkbox of document.querySelectorAll('[data-import-type]')) checkbox.disabled = busy || !profiles.find(profile => profile.id === $('#browser-import-profile').value)?.available[checkbox.dataset.importType];
    if (!busy && ![...document.querySelectorAll('[data-import-type]')].some(checkbox => checkbox.checked && !checkbox.disabled)) $('#browser-import-submit').disabled = true;
    $('#browser-import-submit').textContent = busy ? '正在导入…' : '开始导入'; window.modalSource?.schedule();
  }
  function selection() {
    const profile = profiles.find(profile => profile.id === $('#browser-import-profile').value);
    $('#browser-import-profile-note').textContent = profile ? profile.passwordNote : '没有发现可导入的配置，请先在来源浏览器中使用该配置。';
    for (const checkbox of document.querySelectorAll('[data-import-type]')) checkbox.checked = !!profile?.available[checkbox.dataset.importType];
    controls();
  }
  async function refresh() {
    profiles = await bridge.command('browser-import-list'); const select = $('#browser-import-profile'); select.replaceChildren();
    for (const profile of profiles) { const option = text('option', profile.browser + ' · ' + profile.name); option.value = profile.id; select.append(option); }
    if (!profiles.length) { const option = text('option', '未发现浏览器配置'); option.value = ''; select.append(option); }
    selection();
  }
  async function open() {
    try { await bridge.command('popover-close'); $('#browser-import-result').hidden = true; $('#browser-import-error').textContent = ''; await refresh(); if (!dialog.open) dialog.showModal(); window.browserDialogs.overlays(); }
    catch (error) { window.lunaNotify?.(message(error)); }
  }
  function close() { if (!busy) dialog.close(); }
  $('#browser-import-open').onclick = $('#import-welcome-open').onclick = open;
  $('#import-welcome-dismiss').onclick = () => bridge.command('browser-import-dismiss');
  $('#browser-import-profile').onchange = selection;
  $('#browser-import-refresh').onclick = () => refresh().catch(error => { $('#browser-import-error').textContent = message(error); });
  $('#browser-import-close').onclick = close;
  for (const checkbox of document.querySelectorAll('[data-import-type]')) checkbox.onchange = controls;
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); }); dialog.addEventListener('close', () => window.browserDialogs.overlays());
  async function csv() {
    try { const result = await bridge.command('password-import'); if (result) { window.lunaNotify?.('已导入 ' + result.added + ' 条密码，跳过 ' + result.skipped + ' 条'); if (dialog.open) { $('#browser-import-result').append(text('p', 'CSV 密码：导入 ' + result.added + ' 条，跳过 ' + result.skipped + ' 条')); $('#browser-import-result').hidden = false; } } }
    catch (error) { window.lunaNotify?.(message(error)); }
  }
  $('#browser-import-csv').onclick = $('#browser-import-password-csv').onclick = csv;
  $('#browser-import-form').onsubmit = async event => {
    event.preventDefault(); if (busy) return; busy = true; controls(); $('#browser-import-error').textContent = ''; $('#browser-import-result').hidden = true;
    try {
      const result = await bridge.command('browser-import-run', { id: $('#browser-import-profile').value, types: [...document.querySelectorAll('[data-import-type]')].filter(checkbox => checkbox.checked).map(checkbox => checkbox.dataset.importType) });
      if (!result) return;
      const list = $('#browser-import-result'); list.replaceChildren(text('strong', '导入结果'));
      for (const [type, summary] of Object.entries(result.results)) list.append(text('p', names[type] + '：新增 ' + summary.added + ' 条' + (summary.folders ? '、' + summary.folders + ' 个文件夹' : '') + '，跳过 ' + summary.skipped + ' 条'));
      for (const warning of result.warnings) { const row = text('p', names[warning.type] + '：' + warning.message); row.className = 'import-warning'; list.append(row); }
      list.hidden = false;
    } catch (error) { $('#browser-import-error').textContent = message(error); }
    finally { busy = false; controls(); }
  };
  window.importUI = { open, update(state) { $('#import-welcome').hidden = state.private || state.importWelcomeSeen; $('#browser-import-open').disabled = state.private; $('#browser-import-csv').disabled = state.private; } };
})();
