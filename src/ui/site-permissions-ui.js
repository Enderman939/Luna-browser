(() => {
  const $ = selector => document.querySelector(selector), bridge = window.browser;
  let state;
  const call = (action, payload) => bridge.command(action, payload).catch(error => window.lunaNotify?.(String(error.message).replace(/^Error invoking remote method .*?:\s*(?:Error: )?/, '')));
  function render() {
    const list = $('#site-permissions-list'); if (!list) return;
    list.replaceChildren();
    if (state?.private) { list.append(document.createTextNode('无痕窗口不会保存网站授权。')); return; }
    const entries = state?.sitePermissions || [];
    if (!entries.length) { list.append(document.createTextNode('暂无已保存的网站授权。')); return; }
    for (const entry of entries) {
      const row = document.createElement('div'); row.className = 'site-permission-manager-row';
      const text = document.createElement('div'); text.className = 'site-permission-manager-text';
      const origin = document.createElement('strong'); origin.textContent = entry.origin;
      const permissions = document.createElement('small'); permissions.textContent = entry.permissions.map(permission => permission.label + '：' + (permission.value === 'allow' ? '允许' : '禁止')).join(' · ');
      text.append(origin, permissions);
      const reset = document.createElement('button'); reset.className = 'text-button'; reset.textContent = '撤销授权'; reset.onclick = () => call('site-permission-clear', entry.origin);
      row.append(text, reset); list.append(row);
    }
  }
  window.sitePermissionsUI = { update(next) { state = next; render(); } };
})();
