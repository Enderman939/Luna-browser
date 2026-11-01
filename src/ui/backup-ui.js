(() => {
  const $ = selector => document.querySelector(selector), bridge = window.browser;
  let state, staged = null;
  const cleanError = error => String(error?.message || error || '操作失败').replace(/^Error invoking remote method .*?:\s*(?:Error: )?/, '');
  async function call(action, payload) {
    try { return await bridge.command(action, payload); }
    catch (error) { window.lunaNotify?.(cleanError(error)); return null; }
  }
  function update(next) {
    state = next;
    const disabled = state?.private === true;
    $('#backup-export').disabled = disabled; $('#backup-import').disabled = disabled;
    $('#backup-include-passwords').disabled = disabled; $('#backup-passphrase').disabled = disabled;
    if (disabled) $('#backup-passphrase').value = '';
  }
  $('#backup-export').onclick = async () => {
    const includePasswords = $('#backup-include-passwords').checked, passphrase = $('#backup-passphrase').value;
    if (includePasswords && passphrase.length < 12) { window.lunaNotify?.('包含密码时，请输入至少 12 个字符的备份口令。'); $('#backup-passphrase').focus(); return; }
    $('#backup-export').disabled = true;
    await call('backup-export', { includePasswords, passphrase });
    if (!state?.private) $('#backup-export').disabled = false;
    $('#backup-passphrase').value = '';
  };
  $('#backup-import').onclick = async () => {
    const result = await call('backup-import'); if (!result) return;
    staged = result;
    $('#backup-restore-summary').textContent = '创建于 ' + new Date(result.createdAt).toLocaleString('zh-CN') + ' · 收藏 ' + result.bookmarks + ' 条 · 文件夹 ' + result.folders + ' 个 · 历史 ' + result.history + ' 条 · 下载记录 ' + result.downloads + ' 条' + (result.hasPasswords ? ' · 包含加密密码' : '');
    $('#backup-restore-passphrase-row').hidden = !result.hasPasswords; $('#backup-restore-passphrase').value = ''; $('#backup-restore-error').textContent = '';
    $('#backup-restore-dialog').showModal(); window.browserDialogs.overlays();
  };
  $('#backup-restore-close').onclick = $('#backup-restore-cancel').onclick = () => $('#backup-restore-dialog').close();
  $('#backup-restore-dialog').addEventListener('close', () => window.browserDialogs.overlays());
  $('#backup-restore-form').onsubmit = async event => {
    event.preventDefault(); if (!staged) return;
    const mode = $('#backup-restore-mode').value, passphrase = $('#backup-restore-passphrase').value;
    if (staged.hasPasswords && passphrase.length < 12) { $('#backup-restore-error').textContent = '请输入创建备份时使用的口令。'; return; }
    $('#backup-restore-submit').disabled = true; $('#backup-restore-error').textContent = '';
    const result = await call('backup-restore', { id: staged.id, mode, passphrase });
    $('#backup-restore-submit').disabled = false;
    if (result) { staged = null; $('#backup-restore-dialog').close(); }
  };
  window.backupUI = { update };
})();
