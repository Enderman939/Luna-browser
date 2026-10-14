const fs = require('node:fs');
const path = require('node:path');
const { sanitizeData } = require('./core');
const { randomUUID } = require('node:crypto');
const { bookmarkURL, MAX_BOOKMARKS, MAX_FOLDERS, sanitizeBookmarks } = require('./bookmarks');

class Store {
  constructor(directory) {
    this.file = path.join(directory, 'browser-data.json');
    this.data = sanitizeData();
    try { this.data = sanitizeData(JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* first run or recover corrupt data */ }
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(temporary, this.file);
  }
  toggleBookmark(url, title) {
    const index = this.data.bookmarks.findIndex(entry => entry.url === url);
    if (index >= 0) this.data.bookmarks.splice(index, 1);
    else { if (this.data.bookmarks.length >= MAX_BOOKMARKS) throw new Error('收藏已达 5000 条上限'); this.data.bookmarks.unshift({ url, title, time: Date.now() }); }
    this.data = sanitizeData(this.data);
    this.save();
  }
  visit(url, title) {
    this.data.history = this.data.history.filter(entry => entry.url !== url);
    this.data.history.unshift({ url, title, time: Date.now() });
    this.data = sanitizeData(this.data);
    this.save();
  }
  addShortcut(url, title) {
    this.data.shortcuts = this.data.shortcuts.filter(entry => new URL(entry.url).origin !== new URL(url).origin);
    this.data.shortcuts.unshift({ url, title, time: Date.now() });
    this.data = sanitizeData(this.data);
    this.save();
  }
  bookmarkAction(value) {
    if (!value || typeof value !== 'object') throw new Error('无效的收藏操作');
    const folders = this.data.bookmarkFolders, bookmarks = this.data.bookmarks;
    const parent = id => { if (id && !folders.some(folder => folder.id === id)) throw new Error('收藏文件夹已不存在'); return id || null; };
    if (value.action === 'folder-save') {
      const entry = value.id ? folders.find(folder => folder.id === value.id) : null;
      if (value.id && !entry) throw new Error('文件夹已不存在');
      if (!entry && folders.length >= MAX_FOLDERS) throw new Error('文件夹已达上限');
      const id = entry?.id || randomUUID(), parentId = parent(value.parentId); let cursor = parentId, depth = 0;
      while (cursor) { if (cursor === id || ++depth > 32) throw new Error('不能把文件夹放入自身或超过 32 层'); cursor = folders.find(folder => folder.id === cursor)?.parentId; }
      if (typeof value.title !== 'string' || !value.title.trim()) throw new Error('请输入文件夹名称');
      const result = { id, parentId, title: value.title.trim().slice(0, 300) };
      if (entry) Object.assign(entry, result); else folders.push(result);
    } else if (value.action === 'save') {
      const entry = value.id ? bookmarks.find(entry => entry.id === value.id) : null;
      if (value.id && !entry) throw new Error('收藏已不存在');
      const url = bookmarkURL(value.url); if (!url) throw new Error('请输入有效的 HTTP 或 HTTPS 地址');
      if (bookmarks.some(other => other !== entry && bookmarkURL(other.url) === url)) throw new Error('此网址已收藏');
      if (!entry && bookmarks.length >= MAX_BOOKMARKS) throw new Error('收藏已达上限');
      const result = { id: entry?.id || randomUUID(), title: String(value.title || url).trim().slice(0, 300), url, folderId: parent(value.folderId), time: entry?.time || Date.now() };
      if (entry) Object.assign(entry, result); else bookmarks.unshift(result);
    } else if (value.action === 'delete') this.data.bookmarks = bookmarks.filter(entry => entry.id !== value.id);
    else if (value.action === 'folder-delete') {
      const removed = new Set([value.id]); let size;
      do { size = removed.size; for (const folder of folders) if (removed.has(folder.parentId)) removed.add(folder.id); } while (size !== removed.size);
      this.data.bookmarkFolders = folders.filter(folder => !removed.has(folder.id)); this.data.bookmarks = bookmarks.filter(entry => !removed.has(entry.folderId));
    } else if (value.action === 'reorder') {
      const entry = bookmarks.find(entry => entry.id === value.id); if (!entry) throw new Error('收藏已不存在');
      const others = bookmarks.filter(item => item !== entry), index = others.findIndex(item => item.id === value.beforeId);
      others.splice(index < 0 ? others.length : index, 0, entry); this.data.bookmarks = others;
    } else throw new Error('无效的收藏操作');
    const clean = sanitizeBookmarks(this.data.bookmarks, this.data.bookmarkFolders); Object.assign(this.data, clean); this.save();
  }
  importBookmarks(parsed) {
    const urls = new Set(this.data.bookmarks.map(entry => bookmarkURL(entry.url)));
    const incoming = parsed.bookmarks.filter(entry => !urls.has(bookmarkURL(entry.url)));
    const ids = new Set(this.data.bookmarkFolders.map(folder => folder.id));
    const folders = parsed.bookmarkFolders.filter(folder => { if (ids.has(folder.id)) return false; ids.add(folder.id); return true; });
    if (this.data.bookmarks.length + incoming.length > MAX_BOOKMARKS || this.data.bookmarkFolders.length + folders.length > MAX_FOLDERS) throw new Error('导入后收藏或文件夹数量超过上限');
    this.data.bookmarks.push(...incoming); this.data.bookmarkFolders.push(...folders); this.save();
    return { added: incoming.length, folders: folders.length, skipped: (parsed.skipped || 0) + parsed.bookmarks.length - incoming.length };
  }
  importHistory(entries) {
    const urls = new Map(this.data.history.map(entry => [entry.url, entry])); let added = 0, skipped = 0;
    for (const entry of entries) {
      const url = bookmarkURL(entry.url); if (!url || !Number.isFinite(entry.time) || entry.time <= 0) { skipped++; continue; }
      const previous = urls.get(url);
      if (!previous) { urls.set(url, { url, title: String(entry.title || url).slice(0, 300), time: entry.time }); added++; }
      else { skipped++; if (entry.time > previous.time) urls.set(url, { ...previous, time: entry.time }); }
    }
    this.data.history = [...urls.values()].sort((a, b) => b.time - a.time).slice(0, 10000); this.save(); return { added, skipped };
  }
}

module.exports = { Store };
