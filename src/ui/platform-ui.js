(() => {
  const mac = window.browser?.platform === 'darwin';
  window.lunaShortcut = value => mac ? value.replaceAll('Ctrl+H', 'Cmd+Y').replaceAll('Ctrl', 'Cmd').replaceAll('Alt+', 'Option+') : value;
  if (!mac) return;
  document.body.dataset.platform = 'darwin';
  for (const element of document.querySelectorAll('[title]')) element.title = window.lunaShortcut(element.title);
  for (const element of document.querySelectorAll('kbd,#address-hint')) element.textContent = window.lunaShortcut(element.textContent);
  const note = document.querySelector('.password-note'); if (note) note.textContent = '仅在匹配的网站填充，不会自动提交登录。密码通过当前 macOS 账号的钥匙串加密保护。';
})();
