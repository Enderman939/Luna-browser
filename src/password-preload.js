// Runs in an isolated, sandboxed world. No password APIs are exposed to websites.
const { ipcRenderer } = require('electron');
(() => {
  if (!/^https?:$/.test(location.protocol)) return;
  const token = crypto.randomUUID(), forms = new Map(), touched = new WeakSet(), scanned = new WeakMap();
  let sequence = 0, timer, lastSubmit = '', focusTime = 0, gestureTime = 0, suggestions = false, suggestionForm = null, suggestionField = null, suggestionSerial = 0;
  const visible = input => {
    if (!input?.isConnected || input.disabled || input.readOnly || input.type === 'hidden') return false;
    const rect = input.getBoundingClientRect(); if (rect.width < 5 || rect.height < 5 || !input.getClientRects().length) return false;
    for (let element = input; element; element = element.parentElement) {
      const style = getComputedStyle(element); if (style.visibility !== 'visible' || style.display === 'none' || Number(style.opacity) === 0) return false;
    }
    return true;
  };
  const inputs = root => [...root.querySelectorAll('input')].filter(visible);
  const safeAction = root => {
    const action = root.tagName === 'FORM' ? root.action : location.href;
    try { return new URL(action).origin === location.origin ? action : null; } catch { return null; }
  };
  function rootFor(input) {
    const form = input?.form || input?.closest?.('[role="form"]'); if (form) return form;
    let root = input?.parentElement;
    for (let i = 0; root && i < 6; i++, root = root.parentElement) {
      if (root.querySelector('input[type="password"]') && root.querySelector('button,[role="button"],input[type="submit"]')) return root;
    }
    return input?.parentElement;
  }
  function usernameForm(root) {
    if (!root?.isConnected || !safeAction(root) || inputs(root).some(input => input.type === 'password')) return null;
    const username = inputs(root).find(input => input.autocomplete === 'username');
    return username ? { root, username, usernameOnly: true, actionURL: safeAction(root), newPassword: false } : null;
  }
  function describe(root) {
    if (!root?.isConnected || !safeAction(root)) return null;
    const list = inputs(root), passwords = list.filter(input => input.type === 'password');
    if (!passwords.length || passwords.length > 3) return null;
    const fresh = passwords.filter(input => input.autocomplete === 'new-password');
    const password = fresh[0] || passwords[0];
    const username = list.find(input => input.autocomplete === 'username') || list.find(input => input.type === 'email') || list.filter(input => ['text', 'tel'].includes(input.type) && (input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
    return { root, username, password, passwords, newPassword: !!fresh.length || passwords.length > 1, actionURL: safeAction(root) };
  }
  function roots() {
    const values = new Set();
    for (const input of document.querySelectorAll('input[type="password"],input[autocomplete="username"]')) if (visible(input)) values.add(rootFor(input));
    return [...values];
  }
  function formId(root) { for (const [id, value] of forms) if (value === root) return id; const id = String(++sequence); forms.set(id, root); return id; }
  function request(action, form, extra = {}) {
    return ipcRenderer.invoke('passwords:page', { action, token, form: formId(form.root), actionURL: form.actionURL, username: form.username?.value || '', hasUsername: !!form.username, newPassword: form.newPassword, usernameOnly: form.usernameOnly === true, ...extra }).catch(() => null);
  }
  function inputRect(input) {
    if (!visible(input)) return null;
    const bounds = input.getBoundingClientRect();
    let rect = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, current = window;
    try {
      while (current !== current.top) {
        const frame = current.frameElement; if (!frame || !frame.offsetWidth || !frame.offsetHeight) return null;
        const box = frame.getBoundingClientRect(), sx = box.width / frame.offsetWidth, sy = box.height / frame.offsetHeight;
        rect = { x: box.x + (rect.x + frame.clientLeft) * sx, y: box.y + (rect.y + frame.clientTop) * sy, width: rect.width * sx, height: rect.height * sy };
        current = current.parent;
      }
      return rect;
    } catch { return null; }
  }
  function showSuggestions(input) {
    const root = rootFor(input), form = describe(root) || usernameForm(root);
    if (!form || form.newPassword || input !== form.password && input !== form.username) return;
    const rect = inputRect(input); if (!rect) return;
    focusTime = Date.now(); suggestionForm = form; suggestionField = input;
    const serial = ++suggestionSerial;
    request('focus', form, { rect, requestId: serial }).then(result => { if (serial === suggestionSerial) suggestions = result?.shown === true; });
  }
  function dismissSuggestions() {
    suggestions = false; suggestionSerial++;
    ipcRenderer.invoke('passwords:page', { action: 'dismiss', token, form: '', actionURL: location.href }).catch(() => {});
  }
  function scan() {
    for (const [id, root] of forms) if (!root.isConnected) forms.delete(id);
    for (const root of roots()) {
      const form = describe(root) || usernameForm(root); if (!form || form.newPassword || form.password && (form.password.value || touched.has(form.password)) || form.usernameOnly && (form.username.value || touched.has(form.username))) continue;
      const signature = [form.password || form.username, form.username?.value || '', form.actionURL];
      const previous = scanned.get(root);
      if (previous && previous.every((item, i) => item === signature[i])) continue;
      scanned.set(root, signature); request('scan', form);
    }
  }
  const schedule = () => { if (suggestions && !visible(suggestionField)) dismissSuggestions(); clearTimeout(timer); timer = setTimeout(scan, 180); };
  function capture(root) {
    const form = describe(root); if (!form || !form.password.value) return;
    if (!form.passwords.some(input => touched.has(input))) return;
    if (form.newPassword && form.passwords.filter(input => input !== form.password && input.autocomplete === 'new-password').some(input => input.value !== form.password.value)) return;
    const key = form.actionURL + '\n' + (form.username?.value || '') + '\n' + form.password.value;
    if (key === lastSubmit) return; lastSubmit = key;
    request('submit', form, { password: form.password.value });
  }
  document.addEventListener('input', event => {
    if (!event.isTrusted || event.target.tagName !== 'INPUT') return;
    touched.add(event.target);
    if (event.target.type !== 'password') { lastSubmit = ''; schedule(); }
    if (suggestions && event.target.type !== 'password') showSuggestions(event.target);
  }, true);
  document.addEventListener('change', event => { if (event.isTrusted && event.target.tagName === 'INPUT') touched.add(event.target); }, true);
  document.addEventListener('focusin', event => {
    if (!event.isTrusted || Date.now() - gestureTime > 500 || Date.now() - focusTime < 120) return;
    showSuggestions(event.target);
  }, true);
  function stage(root) {
    if (!root || !safeAction(root)) return;
    const list = inputs(root); if (list.some(input => input.type === 'password')) return;
    const username = list.find(input => input.autocomplete === 'username' || input.type === 'email') || list.find(input => /user|login|account/i.test(input.name || input.id));
    if (username?.value && touched.has(username)) request('username', {root, actionURL:safeAction(root)}, { username: username.value });
  }
  document.addEventListener('submit', event => { if (event.isTrusted) { capture(event.target); stage(event.target); } }, true);
  document.addEventListener('keydown', event => {
    if (event.isTrusted) gestureTime = Date.now();
    if (event.isTrusted && suggestions && ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation(); request('key', suggestionForm, { key: event.key }); return;
    }
    if (event.isTrusted && suggestions && event.key === 'Tab') dismissSuggestions();
    if (event.isTrusted && event.key === 'Enter' && event.target.tagName === 'INPUT') { const root = rootFor(event.target); capture(root); stage(root); }
  }, true);
  document.addEventListener('pointerdown', event => {
    if (!event.isTrusted) return; gestureTime = Date.now();
    const form = describe(rootFor(event.target)) || usernameForm(rootFor(event.target));
    if (form && (event.target === form.password || event.target === form.username)) showSuggestions(event.target);
    else dismissSuggestions();
  }, true);
  window.addEventListener('scroll', dismissSuggestions, true);
  window.addEventListener('resize', dismissSuggestions);
  ipcRenderer.on('passwords:suggestions-closed', (_, value) => { if (value.token === token && value.requestId === suggestionSerial) { suggestions = false; suggestionSerial++; } });
  document.addEventListener('click', event => {
    if (!event.isTrusted) return;
    const button = event.target.closest?.('button,input[type="submit"],[role="button"]'); if (!button) return;
    const root = rootFor(button);
    if (root && (button.type === 'submit' || button.getAttribute('role') === 'button' || /登录|登錄|注册|註冊|保存|继续|sign.?in|log.?in|submit|continue|next/i.test(button.textContent))) { capture(root); stage(root); }
  }, true);
  function setValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  ipcRenderer.on('passwords:fill', (_, value) => {
    if (value.token !== token || value.origin !== location.origin) return;
    if (value.explicit) { suggestions = false; suggestionSerial++; focusTime = Date.now(); }
    if (value.usernameOnly) {
      const form = usernameForm(forms.get(value.form)); if (!form || !value.explicit && (form.username.value || touched.has(form.username))) return;
      setValue(form.username, value.username); if (value.explicit) form.username.focus({ preventScroll: true }); return;
    }
    const form = describe(forms.get(value.form)); if (!form || form.newPassword) return;
    if (!value.explicit && (form.password.value || touched.has(form.password) || form.username?.value && form.username.value !== value.username)) return;
    if (form.username) setValue(form.username, value.username);
    // Page event handlers may navigate or replace inputs while receiving username.
    if (!visible(form.password) || form.password.type !== 'password' || describe(form.root)?.password !== form.password || safeAction(form.root) !== form.actionURL || location.origin !== value.origin) return;
    setValue(form.password, value.password);
    if (value.explicit) form.password.focus({ preventScroll: true });
  });
  ipcRenderer.on('passwords:refresh', () => { for (const root of roots()) scanned.delete(root); schedule(); });
  window.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(schedule).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['type', 'autocomplete', 'action', 'hidden', 'style', 'class'] }); schedule();
  }, { once: true });
})();
