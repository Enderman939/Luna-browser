const fs = require('node:fs');
const path = require('node:path');
const { parentPort, workerData } = require('node:worker_threads');
const { createDecipheriv } = require('node:crypto');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { readJSON, idFor } = require('./browser-import');
const { bookmarkURL, sanitizeBookmarks } = require('./bookmarks');
const { credential } = require('./password-vault');
const { localFile, localName } = require('./local-files');
const chromiumTime = value => { const milliseconds = Number(value) / 1000 - 11644473600000; return milliseconds > 0 && milliseconds <= Date.now() + 86400000 ? Math.floor(milliseconds) : Date.now(); };
function database(file, reader) {
  if (fs.statSync(file).size > 512 * 1024 * 1024) throw new Error('数据库过大');
  const db = new DatabaseSync(file, { readOnly: true });
  try { db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000; BEGIN'); return reader(db); } finally { db.close(); }
}
function chromiumBookmarks(value, namespace) {
  const bookmarks = [], bookmarkFolders = []; let skipped = 0, nodes = 0;
  function walk(node, parentId, depth, position) {
    if (++nodes > 20000 || depth > 32) throw new Error('收藏数量或层级超过上限');
    if (node.type === 'url') {
      const url = bookmarkURL(node.url); if (!url) { skipped++; return; }
      if (bookmarks.length >= 5000) throw new Error('收藏超过 5000 条');
      bookmarks.push({ id: 'import-' + idFor(namespace + ':' + (node.guid || node.id || position)), url, title: String(node.name || url).slice(0, 300), folderId: parentId, time: chromiumTime(node.date_added) });
    } else if (Array.isArray(node.children)) {
      if (bookmarkFolders.length >= 1000) throw new Error('收藏文件夹超过 1000 个');
      const id = 'folder-' + idFor(namespace + ':' + (node.guid || node.id || position));
      bookmarkFolders.push({ id, title: String(node.name || '收藏夹').slice(0, 300), parentId });
      node.children.forEach((child, index) => walk(child, id, depth + 1, position + '/' + index));
    }
  }
  for (const [key, root] of Object.entries(value.roots || {})) walk(root, null, 0, key);
  return { ...sanitizeBookmarks(bookmarks, bookmarkFolders), skipped };
}
function chromiumDownloads(db, source) {
  const columns = new Set(db.prepare('PRAGMA table_info(downloads)').all().map(column => column.name));
  const target = columns.has('target_path') ? 'target_path' : columns.has('full_path') ? 'full_path' : null;
  if (!target) return [];
  const rows = db.prepare(`SELECT id, ${target} AS file, received_bytes, total_bytes, CAST(start_time AS REAL) AS start_time, state FROM downloads ORDER BY start_time DESC LIMIT 1000`).all();
  const hasChain = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='downloads_url_chains'").get();
  return rows.map(row => {
    const url = hasChain ? db.prepare('SELECT url FROM downloads_url_chains WHERE id=? ORDER BY chain_index DESC LIMIT 1').get(row.id)?.url : '';
    return { file: localFile(row.file), url: bookmarkURL(url), name: localName(row.file) || '下载文件', status: Number(row.state) === 1 ? 'completed' : Number(row.state) === 2 ? 'cancelled' : 'interrupted', total: Math.max(0, Number(row.total_bytes) || 0), received: Math.max(0, Number(row.received_bytes) || 0), createdAt: chromiumTime(row.start_time), source };
  }).filter(row => row.url);
}
function unprotect(values, helper) {
  if (!values.length) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const child = spawn(helper, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }); let output = '', settled = false;
    const fail = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Windows 解密不可用')); } };
    const timer = setTimeout(() => { child.kill(); fail(); }, 15000);
    child.on('error', fail); child.stdin.on('error', fail);
    child.stdout.on('data', data => { output += data; if (output.length > 32 * 1024 * 1024) { child.kill(); fail(); } });
    child.once('exit', code => { if (settled) return; settled = true; clearTimeout(timer); if (code) { reject(new Error('Windows 解密不可用')); return; } try { const value = JSON.parse(output); if (!Array.isArray(value) || value.length !== values.length) throw new Error(); resolve(value); } catch { reject(new Error('Windows 解密失败')); } output = ''; });
    child.stdin.end(JSON.stringify(values.map(value => Buffer.from(value).toString('base64'))));
  });
}
async function chromiumPasswords(profile, helper) {
  if (process.platform !== 'win32') {
    const count = database(path.join(profile.directory, 'Login Data'), db => db.prepare('SELECT COUNT(*) AS count FROM logins WHERE blacklisted_by_user=0').get().count);
    return { entries: [], skipped: 0, protectedCount: Math.min(5000, Math.max(0, Number(count) || 0)) };
  }
  const rows = database(path.join(profile.directory, 'Login Data'), db => db.prepare('SELECT origin_url, username_value, password_value, blacklisted_by_user FROM logins LIMIT 5000').all());
  const entries = []; let skipped = 0, protectedCount = 0, key;
  const aesRows = rows.filter(row => ['v10', 'v11'].includes(Buffer.from(row.password_value || []).subarray(0, 3).toString()));
  if (aesRows.length) {
    try { const encoded = Buffer.from(readJSON(path.join(profile.root, 'Local State')).os_crypt?.encrypted_key || '', 'base64'); if (encoded.subarray(0, 5).toString() !== 'DPAPI') throw new Error(); const decoded = await unprotect([encoded.subarray(5)], helper); key = decoded[0] ? Buffer.from(decoded[0], 'base64') : null; if (key?.length !== 32) key = null; } catch {}
  }
  const legacy = rows.filter(row => !Buffer.from(row.password_value || []).subarray(0, 3).toString().startsWith('v') && row.password_value?.length);
  let decoded = []; try { decoded = await unprotect(legacy.map(row => row.password_value), helper); } catch {}
  const legacyValues = new Map(legacy.map((row, index) => [row, decoded[index]]));
  try {
    for (const row of rows) {
      if (row.blacklisted_by_user || !row.password_value?.length) { skipped++; continue; }
      const encrypted = Buffer.from(row.password_value), version = encrypted.subarray(0, 3).toString(); let plain;
      try {
        if (version === 'v20') { protectedCount++; continue; }
        if (version === 'v10' || version === 'v11') {
          if (!key || encrypted.length < 31) { protectedCount++; continue; }
          const decipher = createDecipheriv('aes-256-gcm', key, encrypted.subarray(3, 15)); decipher.setAuthTag(encrypted.subarray(-16));
          plain = Buffer.concat([decipher.update(encrypted.subarray(15, -16)), decipher.final()]);
        } else { const value = legacyValues.get(row); if (!value) { protectedCount++; continue; } plain = Buffer.from(value, 'base64'); }
        entries.push(credential({ origin: row.origin_url, username: row.username_value || '', password: plain.toString('utf8') }));
      } catch { skipped++; } finally { plain?.fill(0); encrypted.fill(0); }
    }
  } finally { key?.fill(0); decoded.fill(null); legacyValues.clear(); }
  return { entries, skipped, protectedCount };
}
function firefoxData(profile, types) {
  return database(path.join(profile.directory, 'places.sqlite'), db => {
    const result = {};
    if (types.includes('history')) result.history = db.prepare('SELECT url, title, last_visit_date / 1000 AS time FROM moz_places WHERE last_visit_date IS NOT NULL ORDER BY last_visit_date DESC LIMIT 10000').all().filter(row => bookmarkURL(row.url));
    if (types.includes('bookmarks')) {
      const rows = db.prepare('SELECT b.id, b.type, b.parent, b.title, b.dateAdded, p.url FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id=b.fk ORDER BY b.id LIMIT 20000').all();
      const folders = new Set(rows.filter(row => row.type === 2 && row.id !== 1).map(row => row.id));
      const id = value => 'firefox-' + idFor(profile.id + ':' + value);
      result.bookmarks = { ...sanitizeBookmarks(rows.filter(row => row.type === 1).map(row => ({ id: id(row.id), title: row.title, url: bookmarkURL(row.url), time: Number(row.dateAdded) / 1000, folderId: folders.has(row.parent) ? id(row.parent) : null })), rows.filter(row => folders.has(row.id)).map(row => ({ id: id(row.id), title: row.title || '收藏夹', parentId: folders.has(row.parent) ? id(row.parent) : null }))), skipped: 0 };
    }
    if (types.includes('downloads')) {
      const rows = db.prepare("SELECT p.url, p.title, p.last_visit_date / 1000 AS time, a.content, n.name FROM moz_annos a JOIN moz_anno_attributes n ON n.id=a.anno_attribute_id JOIN moz_places p ON p.id=a.place_id WHERE n.name IN ('downloads/destinationFileURI','downloads/metaData') LIMIT 4000").all();
      const grouped = new Map();
      for (const row of rows) { const value = grouped.get(row.url) || { url: row.url, name: row.title, createdAt: row.time, source: profile.browser }; if (row.name.endsWith('destinationFileURI')) { try { value.file = localFile(require('node:url').fileURLToPath(row.content)); } catch {} } else { try { const meta = JSON.parse(row.content); value.status = meta.state === 1 ? 'completed' : 'interrupted'; value.total = value.received = Number(meta.fileSize) || 0; } catch {} } grouped.set(row.url, value); }
      result.downloads = [...grouped.values()].filter(row => bookmarkURL(row.url)).map(row => ({ ...row, name: localName(row.file) || row.name || '下载文件', status: row.status || 'interrupted' }));
    }
    return result;
  });
}
function firefoxDownloads(profile) {
  const value = readJSON(path.join(profile.directory, 'downloads.json'));
  return (Array.isArray(value.list) ? value.list : []).slice(0, 1000).map(entry => ({
    url: bookmarkURL(entry.source?.url), file: localFile(entry.target?.path), name: localName(entry.target?.path) || '下载文件',
    createdAt: typeof entry.startTime === 'number' ? entry.startTime : Date.parse(entry.startTime),
    total: Math.max(0, Number(entry.totalBytes) || 0), received: Math.max(0, Number(entry.currentBytes ?? entry.totalBytes) || 0),
    status: entry.succeeded ? 'completed' : entry.canceled ? 'cancelled' : 'interrupted', source: 'Firefox',
  })).filter(entry => entry.url && Number.isFinite(entry.createdAt));
}
async function readProfile(profile, types, helper) {
  const data = { warnings: [], outcomes: {} };
  for (const type of types) {
    try {
      if (!profile.available[type]) { data.warnings.push({ type, message: '来源没有此类数据' }); continue; }
      if (profile.kind === 'firefox') {
        if (type === 'passwords') { data.passwords = { entries: [], skipped: 0, protectedCount: readJSON(path.join(profile.directory, 'logins.json')).logins?.length || 0 }; data.warnings.push({ type, message: 'Firefox 密码请在原浏览器导出 CSV，再使用“导入密码 CSV”' }); }
        else if (type === 'downloads' && fs.existsSync(path.join(profile.directory, 'downloads.json'))) data.downloads = firefoxDownloads(profile);
        else Object.assign(data, firefoxData(profile, [type]));
      } else if (type === 'bookmarks') data.bookmarks = chromiumBookmarks(readJSON(path.join(profile.directory, 'Bookmarks')), profile.id);
      else if (type === 'history') data.history = database(path.join(profile.directory, 'History'), db => db.prepare('SELECT url, title, CAST(last_visit_time AS REAL) AS last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT 10000').all().filter(row => bookmarkURL(row.url)).map(row => ({ url: row.url, title: row.title, time: chromiumTime(row.last_visit_time) })));
      else if (type === 'downloads') data.downloads = database(path.join(profile.directory, 'History'), db => chromiumDownloads(db, profile.browser));
      else if (type === 'passwords') data.passwords = await chromiumPasswords(profile, helper);
      data.outcomes[type] = true;
    } catch { data.warnings.push({ type, message: '读取失败：请关闭来源浏览器后重试；该配置也可能使用不兼容的数据格式' }); }
  }
  if (data.passwords?.protectedCount && profile.kind !== 'firefox') data.warnings.push({ type: 'passwords', message: process.platform === 'darwin' ? data.passwords.protectedCount + ' 条密码由来源浏览器的钥匙串保护，请在来源浏览器导出 CSV 后导入' : data.passwords.protectedCount + ' 条密码受应用绑定或当前账号加密保护，请在来源浏览器导出 CSV 后导入' });
  return data;
}
if (parentPort) readProfile(workerData.profile, workerData.types, workerData.helper).then(data => parentPort.postMessage({ ok: true, data }), () => parentPort.postMessage({ ok: false }));
module.exports = { chromiumBookmarks, chromiumTime, chromiumDownloads, localFile, readProfile, database };
