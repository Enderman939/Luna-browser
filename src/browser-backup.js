const crypto = require('node:crypto');
const { sanitizeData } = require('./core');
const { bookmarkURL } = require('./bookmarks');

const VERSION = 1;
const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
function cleanData(value) {
  const data = sanitizeData(value);
  data.session = []; data.sessionWindows = []; data.sessionActive = 0; data.restoreOnce = null;
  return data;
}
function passwordEnvelope(passwords, passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 1024) throw new Error('密码备份口令至少需要 12 个字符');
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(passwords), 'utf8'), cipher.final()]);
  return { algorithm: 'scrypt-aes-256-gcm', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') };
}
function createBackup({ data, downloads = [], passwords, includePasswords = false, passphrase = '' }) {
  const backup = { format: 'luna-browser-backup', version: VERSION, createdAt: Date.now(), data: cleanData(data), downloads: downloads.slice(0, 1000).map(entry => {
    try { const url = new URL(entry.url); url.search = ''; url.hash = ''; return { id: entry.id, name: entry.name, url: url.href, file: entry.file, total: entry.total, received: entry.received, createdAt: entry.createdAt, status: entry.status, source: entry.source }; } catch { return null; }
  }).filter(Boolean) };
  if (includePasswords) backup.passwords = passwordEnvelope(passwords || { entries: [], blocked: [] }, passphrase);
  const encoded = Buffer.from(JSON.stringify(backup));
  if (encoded.length > MAX_BACKUP_BYTES) throw new Error('备份文件超过 64 MB');
  return encoded;
}
function base64(value, bytes) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('密码备份数据格式无效');
  const decoded = Buffer.from(value, 'base64'); if (decoded.length !== bytes) throw new Error('密码备份数据格式无效'); return decoded;
}
function parseBackup(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (!bytes.length || bytes.length > MAX_BACKUP_BYTES) throw new Error('备份文件为空或超过 64 MB');
  let value; try { value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); } catch { throw new Error('备份文件不是有效的 JSON'); }
  if (value?.format !== 'luna-browser-backup' || value.version !== VERSION || !Number.isFinite(value.createdAt) || !value.data || typeof value.data !== 'object' || !Array.isArray(value.downloads) || value.downloads.length > 1000) throw new Error('不支持此备份文件格式');
  let passwords = null;
  if (value.passwords !== undefined) {
    const envelope = value.passwords;
    if (!envelope || envelope.algorithm !== 'scrypt-aes-256-gcm') throw new Error('不支持的密码加密格式');
    base64(envelope.salt, 16); base64(envelope.iv, 12); base64(envelope.tag, 16);
    const ciphertext = Buffer.from(envelope.data || '', 'base64'); if (!ciphertext.length || ciphertext.length > 32 * 1024 * 1024) throw new Error('密码备份数据格式无效');
    passwords = envelope;
  }
  return { createdAt: value.createdAt, data: cleanData(value.data), downloads: value.downloads, passwords };
}
function decryptPasswords(envelope, passphrase) {
  if (!envelope) return null;
  if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 1024) throw new Error('请输入至少 12 个字符的备份口令');
  try {
    const key = crypto.scryptSync(passphrase, base64(envelope.salt, 16), 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, base64(envelope.iv, 12));
    decipher.setAuthTag(base64(envelope.tag, 16));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'));
  } catch { throw new Error('备份口令错误或密码数据已损坏'); }
}
function mergeData(currentValue, incomingValue, mode = 'merge') {
  const incoming = cleanData(incomingValue);
  if (mode === 'replace') return incoming;
  if (mode !== 'merge') throw new Error('无效的恢复方式');
  const current = cleanData(currentValue);
  const folders = [...current.bookmarkFolders], importedFolders = [], folderIds = new Map(folders.map(folder => [folder.id, folder]));
  const remap = new Map();
  for (const folder of incoming.bookmarkFolders) {
    const existing = folderIds.get(folder.id);
    if (existing && (existing.title !== folder.title || existing.parentId !== folder.parentId)) { const id = crypto.randomUUID(); remap.set(folder.id, id); importedFolders.push({ ...folder, id }); folderIds.set(id, { ...folder, id }); }
    else if (!existing) { importedFolders.push(folder); folderIds.set(folder.id, folder); }
  }
  for (const folder of importedFolders) if (remap.has(folder.parentId)) folder.parentId = remap.get(folder.parentId);
  folders.push(...importedFolders);
  const bookmarks = [...current.bookmarks]; const known = new Set(bookmarks.map(entry => bookmarkURL(entry.url)));
  for (const entry of incoming.bookmarks) if (!known.has(bookmarkURL(entry.url))) { bookmarks.push({ ...entry, folderId: remap.get(entry.folderId) || entry.folderId }); known.add(bookmarkURL(entry.url)); }
  const history = new Map(current.history.map(entry => [bookmarkURL(entry.url), entry]));
  for (const entry of incoming.history) { const key = bookmarkURL(entry.url), previous = history.get(key); if (!previous || entry.time > previous.time) history.set(key, entry); }
  const shortcuts = new Map(current.shortcuts.map(entry => [new URL(entry.url).origin, entry]));
  for (const entry of incoming.shortcuts) if (!shortcuts.has(new URL(entry.url).origin)) shortcuts.set(new URL(entry.url).origin, entry);
  return cleanData({ ...current, bookmarks, bookmarkFolders: folders, history: [...history.values()].sort((a, b) => b.time - a.time).slice(0, 10000), shortcuts: [...shortcuts.values()].slice(0, 8),
    siteSettings: { ...incoming.siteSettings, ...current.siteSettings }, icons: { ...incoming.icons, ...current.icons } });
}
module.exports = { VERSION, MAX_BACKUP_BYTES, createBackup, parseBackup, decryptPasswords, mergeData };
