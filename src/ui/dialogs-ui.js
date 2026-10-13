(() => {
  const $ = selector => document.querySelector(selector), bridge = window.browser;
  const confirmation = $('#confirmation-dialog'), clearDialog = $('#clear-data-dialog');
  let promptId = null, range = 'hour', serial = 0, loading = false, deleting = false;
  function overlays() {
    if (window.popoverHost) return;
    const modal = [...document.querySelectorAll('dialog')].some(dialog => dialog.open);
    bridge.command('modal-state', modal).catch(() => {});
    bridge.command('overlay', modal).catch(() => {});
  }
  function showPrompt(prompt) {
    if (!prompt || prompt.id === promptId) return;
    promptId = prompt.id; confirmation.dataset.kind = prompt.kind || 'confirm';
    $('#confirmation-title').textContent = prompt.title || '确认';
    $('#confirmation-message').textContent = prompt.message || '';
    $('#confirmation-detail').textContent = prompt.detail || '';
    $('#confirmation-detail').hidden = !prompt.detail;
    $('#confirmation-accept').textContent = prompt.confirmLabel || '确定';
    $('#confirmation-cancel').textContent = prompt.cancelLabel || '取消';
    $('#confirmation-restore-wrap').hidden = prompt.kind !== 'close-browser' || typeof prompt.restore !== 'boolean';
    $('#confirmation-restore').checked = prompt.restore === true;
    const tabs = $('#confirmation-tabs'); tabs.replaceChildren();
    tabs.hidden = !prompt.tabs?.length;
    for (const tab of prompt.tabs || []) {
      const row = document.createElement('div'); row.className = 'confirmation-tab';
      if (tab.icon?.startsWith('data:image/')) { const image = document.createElement('img'); image.src = tab.icon; image.alt = ''; row.append(image); }
      const text = document.createElement('span'); text.textContent = tab.title; row.append(text); row.title = tab.url; tabs.append(row);
    }
    if (!confirmation.open) confirmation.showModal();
    overlays(); $('#confirmation-cancel').focus();
  }
  function respond(accepted) {
    if (promptId) bridge.respondPrompt(promptId, { accepted, restore: $('#confirmation-restore').checked }).catch(() => {});
  }
  $('#confirmation-accept').onclick = () => respond(true);
  $('#confirmation-cancel').onclick = $('#confirmation-close').onclick = () => respond(false);
  confirmation.addEventListener('cancel', event => { event.preventDefault(); respond(false); });
  confirmation.addEventListener('close', overlays);
  bridge.onPrompt(showPrompt);
  bridge.onPromptClose(({ id }) => { if (promptId === id) { promptId = null; confirmation.close(); } });
  function bytes(value) { if (value < 1024) return value + ' B'; if (value < 1048576) return (value / 1024).toFixed(1) + ' KB'; return (value / 1048576).toFixed(1) + ' MB'; }
  function updateSubmit() {
    $('#clear-data-submit').disabled = loading || deleting || !document.querySelector('[data-clear-type]:checked');
    $('#clear-data-submit').textContent = deleting ? '正在删除…' : '删除数据';
    $('#clear-data-cancel').disabled = $('#clear-data-close').disabled = deleting;
  }
  async function updateStats() {
    const version = ++serial; loading = true; updateSubmit();
    document.querySelectorAll('[data-clear-range]').forEach(button => button.classList.toggle('selected', button.dataset.clearRange === range));
    $('#clear-data-more').value = ['month', 'all'].includes(range) ? range : '';
    ['history', 'cookies', 'cache', 'downloads', 'siteSettings', 'passwords'].forEach(type => $('#clear-stat-' + type).textContent = '正在计算…');
    try {
      const stats = await bridge.command('browsing-data-stats', { range });
      if (version !== serial || !clearDialog.open) return;
      $('#clear-stat-history').textContent = stats.history + ' 条记录';
      $('#clear-stat-cookies').textContent = stats.cookies + ' 个 Cookie，' + stats.sites + ' 个网站' + (range !== 'all' && stats.unknownCookies ? '；时间未知的 Cookie 会保留' : '');
      $('#clear-stat-cache').textContent = '总缓存 ' + bytes(stats.cacheBytes) + (stats.ieCacheExcluded ? '（Chromium 缓存，IE 缓存由 Windows 管理）' : '');
      $('#clear-stat-downloads').textContent = stats.downloads + ' 条已结束的下载记录';
      $('#clear-stat-siteSettings').textContent = stats.siteSettings + ' 个网站';
      $('#clear-stat-passwords').textContent = stats.passwords + ' 个已保存密码（按保存或更新时间）';
    } catch (error) { $('#clear-data-error').textContent = error.message; }
    finally { if (version === serial) { loading = false; updateSubmit(); } }
  }
  function openClear(options = {}) {
    if (clearDialog.open) return;
    range = options.range || 'hour';
    const types = options.types || ['history', 'cookies', 'cache', 'downloads'];
    document.querySelectorAll('[data-clear-type]').forEach(input => { input.checked = types.includes(input.dataset.clearType); input.disabled = false; });
    $('#clear-data-error').textContent = ''; deleting = false;
    clearDialog.showModal(); $('#clear-data-cancel').focus(); overlays(); updateStats();
  }
  function closeClear() { if (!deleting) { serial++; clearDialog.close(); } }
  document.querySelectorAll('[data-clear-range]').forEach(button => button.onclick = () => { if (!deleting) { range = button.dataset.clearRange; updateStats(); } });
  $('#clear-data-more').onchange = () => { if ($('#clear-data-more').value && !deleting) { range = $('#clear-data-more').value; updateStats(); } };
  document.querySelectorAll('[data-clear-type]').forEach(input => input.onchange = updateSubmit);
  $('#clear-data-cancel').onclick = $('#clear-data-close').onclick = closeClear;
  clearDialog.addEventListener('cancel', event => { event.preventDefault(); closeClear(); });
  clearDialog.addEventListener('close', overlays);
  $('#clear-data-submit').onclick = async () => {
    if (loading || deleting) return;
    deleting = true; updateSubmit(); $('#clear-data-error').textContent = '';
    document.querySelectorAll('[data-clear-type],[data-clear-range],#clear-data-more').forEach(control => control.disabled = true);
    try {
      await bridge.command('delete-browsing-data', { range, types: [...document.querySelectorAll('[data-clear-type]:checked')].map(input => input.dataset.clearType) });
      deleting = false; clearDialog.close();
    } catch (error) { deleting = false; $('#clear-data-error').textContent = error.message; }
    finally { document.querySelectorAll('[data-clear-type],[data-clear-range],#clear-data-more').forEach(control => control.disabled = false); updateSubmit(); }
  };
  bridge.onClearData(openClear);
  window.browserDialogs = { sync: prompt => showPrompt(prompt), openClear, overlays };
})();
