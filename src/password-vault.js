const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomInt } = require('node:crypto');

function credentialOrigin(value) {
  try {
    if (typeof value !== 'string' || value.length > 8192) return null;
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return null;
    return url.origin;
  } catch { return null; }
}
function credential(value) {
  const origin = credentialOrigin(value?.origin);
  if (!origin) throw new Error('密码仅支持 HTTPS 网站或本机测试网站。');
  if (typeof value.username !== 'string' || value.username.length > 512 || typeof value.password !== 'string' || !value.password || value.password.length > 4096) throw new Error('请输入有效的账号与密码。');
  return { origin, username: value.username.trim(), password: value.password };
}
function generatePassword(length = 20) {
  const groups = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%*-_+'];
  const chars = groups.join(''), values = groups.map(group => group[randomInt(group.length)]);
  for (let i = values.length; i < Math.min(64, Math.max(12, Number(length) || 20)); i++) values.push(chars[randomInt(chars.length)]);
  for (let i = values.length - 1; i > 0; i--) { const j = randomInt(i + 1); [values[i], values[j]] = [values[j], values[i]]; }
  return values.join('');
}
class PasswordVault {
  constructor(directory, encryption) {
    this.file = path.join(directory, 'password-vault.json'); this.encryption = encryption;
    this.data = { entries: [], blocked: [] }; this.error = ''; this.revision = 0;
    try {
      if (!fs.existsSync(this.file)) return;
      if (!this.available()) throw new Error();
      if (fs.statSync(this.file).size > 32 * 1024 * 1024) throw new Error();
      const envelope = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (envelope.version !== 1 || typeof envelope.encrypted !== 'string') throw new Error();
      const data = JSON.parse(encryption.decryptString(Buffer.from(envelope.encrypted, 'base64')));
      if (!Array.isArray(data.entries) || data.entries.length > 5000 || !Array.isArray(data.blocked) || data.blocked.length > 5000) throw new Error();
      const ids = new Set(), accounts = new Set();
      this.data.entries = data.entries.map(entry => {
        const clean = credential(entry), key = clean.origin + '\n' + clean.username;
        if (!/^[\da-f-]{36}$/.test(entry.id) || ids.has(entry.id) || accounts.has(key) || !Number.isFinite(entry.createdAt) || !Number.isFinite(entry.updatedAt)) throw new Error();
        ids.add(entry.id); accounts.add(key); return { ...clean, id: entry.id, createdAt: entry.createdAt, updatedAt: entry.updatedAt };
      });
      this.data.blocked = [...new Set(data.blocked.map(credentialOrigin))];
      if (this.data.blocked.includes(null)) throw new Error();
    } catch { this.data = { entries: [], blocked: [] }; this.error = '密码库无法解密或已损坏。原文件已保留，请使用原设备的系统账号或恢复备份。'; }
  }
  available() { return this.encryption.isEncryptionAvailable() && (!this.encryption.getSelectedStorageBackend || this.encryption.getSelectedStorageBackend() !== 'basic_text'); }
  check() { if (this.error) throw new Error(this.error); if (!this.available()) throw new Error('系统加密暂不可用，密码保存与读取已暂停。'); }
  commit(data) {
    this.check();
    const encrypted = this.encryption.encryptString(JSON.stringify(data)).toString('base64');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify({ version: 1, encrypted }), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file); this.data = data; this.revision++;
  }
  list() { this.check(); return this.data.entries.map(({ password, ...entry }) => ({ ...entry })); }
  find(origin, username) { this.check(); return this.data.entries.find(entry => entry.origin === origin && entry.username === username); }
  get(id) { this.check(); const entry = this.data.entries.find(entry => entry.id === id); if (!entry) throw new Error('此密码已删除。'); return { ...entry }; }
  accounts(origin) { return this.list().filter(entry => entry.origin === origin); }
  save(value, id) {
    this.check(); const clean = credential(value), now = Date.now();
    const previous = id ? this.get(id) : this.find(clean.origin, clean.username);
    const duplicate = this.find(clean.origin, clean.username);
    if (duplicate && previous && duplicate.id !== previous.id) throw new Error('此网站已保存相同账号，请编辑已有记录。');
    if (!previous && this.data.entries.length >= 5000) throw new Error('密码库已满，请先删除部分记录。');
    const entry = { ...clean, id: previous?.id || randomUUID(), createdAt: previous?.createdAt || now, updatedAt: now };
    this.commit({ ...this.data, entries: [...this.data.entries.filter(item => item.id !== entry.id), entry] });
    return entry.id;
  }
  remove(id) { this.get(id); this.commit({ ...this.data, entries: this.data.entries.filter(entry => entry.id !== id) }); }
  import(entries) {
    this.check(); const next = [...this.data.entries]; let added = 0, skipped = 0; const now = Date.now();
    for (const value of entries) {
      const clean = credential(value);
      if (next.some(entry => entry.origin === clean.origin && entry.username === clean.username)) { skipped++; continue; }
      if (next.length >= 5000) throw new Error('导入后密码将超过 5000 个，未保存此次导入。');
      next.push({ ...clean, id: randomUUID(), createdAt: now, updatedAt: now }); added++;
    }
    if (added) this.commit({ ...this.data, entries: next });
    return { added, skipped };
  }
  restore(value, replace = false) {
    this.check();
    if (!value || !Array.isArray(value.entries) || value.entries.length > 5000 || !Array.isArray(value.blocked) || value.blocked.length > 5000) throw new Error('密码备份数据无效');
    const now = Date.now(), previousCount = this.data.entries.length, entries = replace ? [] : [...this.data.entries], keys = new Set(entries.map(entry => entry.origin + '\n' + entry.username));
    for (const entry of value.entries) {
      const clean = credential(entry), key = clean.origin + '\n' + clean.username;
      if (keys.has(key)) { if (replace) continue; else continue; }
      if (entries.length >= 5000) throw new Error('恢复后密码数量超过 5000 条');
      keys.add(key); entries.push({ ...clean, id: /^[\da-f-]{36}$/.test(entry.id || '') && !entries.some(item => item.id === entry.id) ? entry.id : randomUUID(),
        createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : now, updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : now });
    }
    const blocked = new Set(replace ? [] : this.data.blocked);
    for (const origin of value.blocked) { const safe = credentialOrigin(origin); if (!safe) throw new Error('密码备份包含无效的网站'); blocked.add(safe); }
    if (blocked.size > 5000) throw new Error('恢复后密码例外数量超过 5000 条');
    this.commit({ entries, blocked: [...blocked] });
    return { entries: entries.length, added: entries.length - (replace ? 0 : previousCount), skipped: value.entries.length - (entries.length - (replace ? 0 : previousCount)) };
  }
  block(origin, blocked) {
    this.check(); origin = credentialOrigin(origin); if (!origin) throw new Error('无效的网站。');
    if (blocked && this.data.blocked.length >= 5000 && !this.data.blocked.includes(origin)) throw new Error('例外名单已满。');
    this.commit({ ...this.data, blocked: [...this.data.blocked.filter(item => item !== origin), ...(blocked ? [origin] : [])] });
  }
  clear(start = 0, end = Date.now()) { this.commit({ ...this.data, entries: this.data.entries.filter(entry => entry.updatedAt < start || entry.updatedAt > end) }); }
}
module.exports = { PasswordVault, credentialOrigin, credential, generatePassword };
