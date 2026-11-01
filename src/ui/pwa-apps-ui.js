(() => {
  const $ = selector => document.querySelector(selector), bridge = window.browser;
  let state;
  const call = (action, payload) => bridge.command(action, payload).catch(error => window.lunaNotify?.(String(error.message).replace(/^Error invoking remote method .*?:\s*(?:Error: )?/, '')));
  function render() {
    const list = $('#installed-apps-list'); if (!list) return;
    list.replaceChildren();
    const apps = state?.private ? [] : state?.installedApps || [];
    if (!apps.length) { const empty = document.createElement('p'); empty.className = 'essentials-note'; empty.textContent = state?.private ? '请在普通窗口中管理网站应用。' : '尚未安装网站应用。打开网站后，可在地址栏左侧的网站信息中检查安装选项。'; list.append(empty); return; }
    for (const app of apps) {
      const row = document.createElement('div'); row.className = 'installed-app-row';
      const text = document.createElement('div'); text.className = 'installed-app-text';
      const name = document.createElement('strong'); name.textContent = app.name;
      const url = document.createElement('small'); url.textContent = app.startUrl;
      text.append(name, url);
      const open = document.createElement('button'); open.className = 'secondary-button'; open.textContent = '打开'; open.disabled = state?.private === true; open.onclick = () => call('pwa-launch', app.id);
      const remove = document.createElement('button'); remove.className = 'text-button'; remove.textContent = '移除'; remove.disabled = state?.private === true; remove.onclick = () => call('pwa-remove', app.id);
      row.append(text, open, remove); list.append(row);
    }
  }
  window.pwaAppsUI = { update(next) { state = next; render(); } };
})();
