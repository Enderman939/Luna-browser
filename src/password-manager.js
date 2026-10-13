const { safeStorage, dialog } = require('electron');
const { scopedIPC } = require('./scoped-ipc');
const path = require('node:path');
const fs = require('node:fs/promises');
const { PasswordVault, credentialOrigin, credential, generatePassword } = require('./password-vault');
const { parsePasswordCSV } = require('./password-csv');
const { fieldAnchor } = require('./password-popup-layout');

class PasswordManager {
  constructor({ directory, session, tabs, settings, activeId, changed, openPopup, closePopup, popupKey, prompt, notice, parent, vault }) {
    Object.assign(this, { session, tabs, settings, activeId, changed, openPopup, closePopup, popupKey, prompt, notice, parent });
    this.vault = vault || new PasswordVault(directory, safeStorage); this.pending = new Map(); this.targets = new Map(); this.staged = new Map();
    if (!session.getPreloadScripts().some(script => script.id === 'luna-password-forms')) session.registerPreloadScript({ id: 'luna-password-forms', type: 'frame', filePath: path.join(__dirname, 'password-preload.js') });
    const ipcMain = scopedIPC(parent, event => [...tabs.values()].some(tab => tab.view.webContents === event.sender));
    ipcMain.handle('passwords:page', (event, value) => this.page(event, value));
    this.timer = setInterval(() => {
      let changed = false;
      for (const [id, entry] of this.pending) if (entry.expires < Date.now()) { this.pending.delete(id); changed = true; }
      for (const [id, entry] of this.staged) if (entry.expires < Date.now()) this.staged.delete(id);
      if (changed) this.changed();
    }, 10000); this.timer.unref();
    parent.once('closed', () => { clearInterval(this.timer); this.pending.clear(); this.targets.clear(); this.staged.clear(); });
  }
  sender(event) {
    const tab = [...this.tabs.values()].find(tab => tab.view.webContents === event.sender);
    const frame = event.senderFrame, top = event.sender.mainFrame;
    const origin = credentialOrigin(frame?.url);
    if (!tab || tab.ie || event.sender.session !== this.session || !frame || frame.isDestroyed() || !origin || origin !== credentialOrigin(top.url) || origin !== credentialOrigin(tab.url) || tab.sourceMode) return null;
    for (let ancestor = frame.parent; ancestor; ancestor = ancestor.parent) if (credentialOrigin(ancestor.url) !== origin) return null;
    return { tab, frame, origin };
  }
  page(event, value) {
    const context = this.sender(event);
    if (!context || !value || typeof value !== 'object' || !/^[\da-f-]{36}$/.test(value.token || '') || typeof value.form !== 'string' || value.form.length > 80) return null;
    const { tab, frame, origin } = context;
    if (value.action === 'dismiss') { if (tab.id === this.activeId()) this.closePopup(true); return null; }
    if (value.action === 'key') {
      const target = this.suggestionTarget;
      if (target?.tabId === tab.id && target.frame === frame && target.token === value.token && target.form === value.form && ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(value.key)) this.popupKey(value.key);
      return null;
    }
    if (this.vault.error || !this.vault.available()) return null;
    if (credentialOrigin(value.actionURL) !== origin) return null;
    if (value.action === 'username') {
      if (this.settings().savePasswords && typeof value.username === 'string' && value.username.length <= 512) this.staged.set(tab.id, { origin, username: value.username.trim(), expires: Date.now() + 120000 });
      return null;
    }
    if (value.action === 'submit') {
      if (!this.settings().savePasswords || this.vault.data.blocked.includes(origin)) return null;
      let clean; try { clean = credential({ ...value, origin }); } catch { return null; }
      if (!clean.username) { const staged = this.staged.get(tab.id); if (staged?.origin === origin && staged.expires > Date.now()) clean.username = staged.username; }
      const previous = this.vault.find(origin, clean.username);
      if (previous?.password === clean.password) return null;
      const pending = this.pending.get(tab.id);
      if (pending?.origin === origin && pending.username === clean.username && pending.password === clean.password && pending.expires > Date.now()) return null;
      this.pending.set(tab.id, { ...clean, id: previous?.id, expires: Date.now() + 120000 });
      this.changed();
      // Wait for the page's click/submit handler and navigation before opening UI.
      setTimeout(() => { if (tab.id === this.activeId() && this.pending.has(tab.id)) this.openPopup(); }, 300);
      return null;
    }
    if (!['scan', 'focus'].includes(value.action) || !this.settings().autofillPasswords || value.newPassword === true) return null;
    const accounts = this.vault.accounts(origin);
    const target = { tabId: tab.id, frame, url: frame.url, origin, token: value.token, form: value.form, requestId: value.requestId, usernameOnly: value.usernameOnly === true, username: typeof value.username === 'string' ? value.username.slice(0, 512) : '' };
    this.targets.set(tab.id, target);
    const staged = this.staged.get(tab.id);
    const username = typeof value.username === 'string' && value.username || (value.hasUsername === false && staged?.origin === origin && staged.expires > Date.now() ? staged.username : '');
    const matching = username ? accounts.filter(item => item.username === username) : accounts;
    if (value.action === 'scan' && matching.length === 1) this.fill(target, matching[0].id, false);
    let shown = false;
    if (value.action === 'focus' && accounts.length && tab.id === this.activeId()) {
      const anchor = fieldAnchor(value.rect, tab.view.getBounds(), tab.view.webContents.getZoomFactor());
      if (anchor) { shown = this.openPopup(anchor) !== false; if (shown) this.suggestionTarget = target; }
      else this.closePopup(true);
    }
    this.changed(); return { count: accounts.length, shown };
  }
  fill(target, id, explicit) {
    if (!target || !this.settings().autofillPasswords) return false;
    const tab = this.tabs.get(target.tabId), frame = target.frame;
    if (!tab || tab.sourceMode || frame.isDestroyed() || frame.url !== target.url || credentialOrigin(tab.url) !== target.origin || credentialOrigin(tab.view.webContents.mainFrame.url) !== target.origin) return false;
    const entry = this.vault.get(id); if (entry.origin !== target.origin) return false;
    for (let ancestor = frame.parent; ancestor; ancestor = ancestor.parent) if (credentialOrigin(ancestor.url) !== target.origin) return false;
    if (target.usernameOnly) this.staged.set(tab.id, { origin: target.origin, username: entry.username, expires: Date.now() + 120000 });
    frame.send('passwords:fill', { token: target.token, form: target.form, origin: target.origin, username: entry.username, password: target.usernameOnly ? undefined : entry.password, usernameOnly: target.usernameOnly, explicit });
    return true;
  }
  summary(tab) {
    const origin = credentialOrigin(tab?.view.webContents.getURL()), pending = this.pending.get(tab?.id);
    const available = !this.vault.error && this.vault.available();
    return { available, revision: this.vault.revision, error: this.vault.error || (!available ? '系统加密暂不可用' : ''),
      origin, accounts: available && origin ? this.vault.accounts(origin) : [],
      query: this.suggestionTarget && this.suggestionTarget.tabId === tab?.id ? this.suggestionTarget.username : '',
      pending: pending && pending.expires > Date.now() ? { origin: pending.origin, username: pending.username, update: !!pending.id } : null,
      blocked: available && origin ? this.vault.data.blocked.includes(origin) : false };
  }
  popupClosed() {
    const target = this.suggestionTarget; this.suggestionTarget = null;
    if (target && !target.frame.isDestroyed()) target.frame.send('passwords:suggestions-closed', { token: target.token, form: target.form, requestId: target.requestId });
  }
  forget(tabId) { if (this.suggestionTarget?.tabId === tabId) this.closePopup(true); this.pending.delete(tabId); this.targets.delete(tabId); this.staged.delete(tabId); }
  async command(action, value, tab) {
    switch (action) {
      case 'password-list': return { entries: this.vault.list(), blocked: [...this.vault.data.blocked] };
      case 'password-generate': return generatePassword();
      case 'password-import': {
        this.vault.check();
        const selected = await dialog.showOpenDialog(this.parent, { title: '导入 Edge / Chrome 密码', filters: [{ name: '密码 CSV', extensions: ['csv'] }], properties: ['openFile'] });
        if (selected.canceled || !selected.filePaths[0]) return null;
        const handle = await fs.open(selected.filePaths[0], 'r'); let csv;
        try {
          if ((await handle.stat()).size > 5 * 1024 * 1024) throw new Error('CSV 文件超过 5 MB。');
          const buffer = Buffer.alloc(5 * 1024 * 1024 + 1); let size = 0;
          while (size < buffer.length) { const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size); if (!bytesRead) break; size += bytesRead; }
          if (size > 5 * 1024 * 1024) throw new Error('CSV 文件超过 5 MB。'); csv = buffer.subarray(0, size).toString('utf8');
        } finally { await handle.close(); }
        const parsed = parsePasswordCSV(csv); csv = null;
        if (!parsed.entries.length) throw new Error('文件中没有可导入的 HTTPS 或本机测试网站密码。');
        const confirmed = await this.prompt({ kind: 'password-import', title: '导入密码', message: '将 ' + parsed.entries.length + ' 条密码导入此设备？', detail: '已存在的同网站同账号密码将保留。无效或不安全的网站记录会跳过。导入后请妥善处理原始 CSV 文件，它包含明文密码。', confirmLabel: '导入' });
        if (!confirmed.accepted) return null;
        const result = this.vault.import(parsed.entries); result.skipped += parsed.skipped; this.changed(); return result;
      }
      case 'password-detail': {
        const selected = await this.prompt({ kind: 'password-reveal', title: '查看保存的密码', message: '允许在此浏览器中显示该密码？', detail: '请确认屏幕周围没有其他人。密码会在 30 秒后自动隐藏。', confirmLabel: '显示密码' });
        return selected.accepted ? this.vault.get(value) : null;
      }
      case 'password-save': this.vault.save(value, value?.id); this.changed(); return true;
      case 'password-delete': {
        const entry = this.vault.get(value);
        const selected = await this.prompt({ kind: 'password-delete', title: '删除密码', message: '删除 ' + entry.origin + ' 的已保存密码？', detail: entry.username || '未填写账号', confirmLabel: '删除' });
        if (selected.accepted) { this.vault.remove(value); this.changed(); } return selected.accepted;
      }
      case 'password-unblock': this.vault.block(value, false); this.changed(); return true;
      case 'password-accept': {
        const pending = this.pending.get(tab?.id); if (!pending || pending.expires < Date.now()) return false;
        this.vault.save(pending, pending.id); this.pending.delete(tab.id); this.changed(); this.closePopup(); this.notice(pending.id ? '密码已更新' : '密码已加密保存'); return true;
      }
      case 'password-never': {
        const pending = this.pending.get(tab?.id); if (!pending || pending.expires < Date.now()) return false;
        this.vault.block(pending.origin, true); this.pending.delete(tab.id); this.changed(); this.closePopup(); return true;
      }
      case 'password-dismiss': if (tab) this.pending.delete(tab.id); this.changed(); this.closePopup(); return true;
      case 'password-fill': {
        const target = this.suggestionTarget?.tabId === tab?.id ? this.suggestionTarget : this.targets.get(tab?.id);
        const filled = this.fill(target, value, true); this.closePopup();
        if (!filled) this.notice('请先点击网页中的登录输入框，再选择账号。'); return filled;
      }
      default: throw new Error('无效的密码操作。');
    }
  }
  settingsChanged() {
    if (!this.settings().savePasswords) { this.pending.clear(); this.staged.clear(); }
    if (!this.settings().autofillPasswords) this.targets.clear();
    for (const tab of this.tabs.values()) if (!tab.view.webContents.isDestroyed()) tab.view.webContents.send('passwords:refresh');
  }
}
module.exports = { PasswordManager };
