const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { bookmarkURL } = require('./bookmarks');
const { localFile, localName } = require('./local-files');
function downloadRecord(value) {
  const url = bookmarkURL(value?.url); if (!url) return null;
  const file = localFile(value.file);
  const createdAt = Number(value.createdAt); if (!Number.isFinite(createdAt) || createdAt <= 0 || createdAt > Date.now() + 86400000) return null;
  const fingerprint = createHash('sha256').update([url, process.platform === 'win32' ? file.toLowerCase() : file, createdAt].join('\n')).digest('hex');
  return { id: /^native-[\d-]+$/.test(value.id || '') ? value.id : 'past-' + fingerprint.slice(0, 24), fingerprint, name: String(value.name || localName(file) || '下载文件').slice(0, 300), url, file,
    total: Math.max(0, Number(value.total) || 0), received: Math.max(0, Number(value.received) || 0), createdAt,
    status: ['completed', 'cancelled', 'interrupted'].includes(value.status) ? value.status : 'interrupted', source: String(value.source || '').slice(0, 40), historical: true, managed: false, mode: 'history', threads: [], resumable: false, speed: 0, eta: null, icon: '', error: '', completion: 'none' };
}
class DownloadHistory {
  constructor(directory, persistent = true) {
    this.file = path.join(directory, 'download-history.json'); this.persistent = persistent; this.records = new Map();
    if (!persistent) return;
    try { if (fs.statSync(this.file).size > 16 * 1024 * 1024) return; const rows = JSON.parse(fs.readFileSync(this.file, 'utf8')); for (const value of Array.isArray(rows) ? rows.slice(0, 1000) : []) { const entry = downloadRecord(value); if (entry) this.records.set(entry.id, entry); } } catch {}
  }
  save() { if (!this.persistent) return; fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file + '.tmp', JSON.stringify([...this.records.values()])); fs.renameSync(this.file + '.tmp', this.file); }
  import(values) {
    let added = 0, skipped = 0; const seen = new Set([...this.records.values()].map(entry => entry.fingerprint));
    for (const value of values) { const entry = downloadRecord(value); if (!entry || seen.has(entry.fingerprint)) { skipped++; continue; } if (this.records.size >= 1000) { skipped++; continue; } this.records.set(entry.id, entry); seen.add(entry.fingerprint); added++; }
    this.save(); return { added, skipped };
  }
  remove(id) { this.records.delete(id); this.save(); }
}
async function fileIdentity(file) {
  if (!localFile(file)) throw new Error('此记录没有可删除的本地文件');
  const stat = await fs.promises.lstat(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('只能删除普通下载文件，不能删除目录或文件链接');
  const real = await fs.promises.realpath(file);
  return { real, dev: stat.dev, ino: stat.ino, size: stat.size, mtime: stat.mtimeMs };
}
module.exports = { DownloadHistory, downloadRecord, fileIdentity };
