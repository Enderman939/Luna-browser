const { createHash, randomUUID } = require('node:crypto');
const MAX_BOOKMARKS = 5000, MAX_FOLDERS = 1000, MAX_DEPTH = 32;
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(value);
function bookmarkURL(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function sanitizeBookmarks(bookmarks, folders) {
  const folderMap = new Map();
  for (const entry of Array.isArray(folders) ? folders.slice(0, MAX_FOLDERS) : []) {
    if (entry && validId(entry.id) && typeof entry.title === 'string') folderMap.set(entry.id, { id: entry.id, title: entry.title.trim().slice(0, 300) || '文件夹', parentId: validId(entry.parentId) ? entry.parentId : null });
  }
  for (const folder of folderMap.values()) {
    let parent = folder.parentId, seen = new Set([folder.id]);
    while (parent) { if (!folderMap.has(parent) || seen.has(parent) || seen.size > MAX_DEPTH) { folder.parentId = null; break; } seen.add(parent); parent = folderMap.get(parent).parentId; }
  }
  const urls = new Map(), ids = new Set();
  for (const entry of Array.isArray(bookmarks) ? bookmarks : []) {
    if (!entry || !bookmarkURL(entry.url)) continue;
    // Preserve existing URL strings for backwards-compatible exact matching.
    let id = validId(entry.id) ? entry.id : 'b-' + createHash('sha256').update(entry.url).digest('hex').slice(0, 24);
    if (ids.has(id) && urls.get(entry.url)?.id !== id) id = 'b-' + createHash('sha256').update(entry.url).digest('hex').slice(0, 24);
    ids.add(id); urls.set(entry.url, { id, url: entry.url, title: String(entry.title || entry.url).slice(0, 300), time: Number(entry.time) || Date.now(), folderId: folderMap.has(entry.folderId) ? entry.folderId : null });
    if (urls.size > MAX_BOOKMARKS) throw new Error('收藏超过 5000 条，无法保存');
  }
  return { bookmarks: [...urls.values()], bookmarkFolders: [...folderMap.values()] };
}
function entities(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }, key = entity.toLowerCase();
    if (named[key]) return named[key];
    const code = key.startsWith('#x') ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
  });
}
function parseBookmarkHTML(html) {
  if (typeof html !== 'string' || Buffer.byteLength(html) > 5 * 1024 * 1024) throw new Error('书签文件超过 5 MB');
  const source = html.replace(/<!--[\s\S]*?(?:-->|$)/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const tokens = source.match(/<\/?[a-z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>|[^<]+/gi) || [];
  const folders = [], bookmarks = [], stack = [null]; let capture = null, pendingFolder = null, skipped = 0;
  for (const token of tokens) {
    if (/^<h3\b/i.test(token)) { capture = { type: 'folder', text: '' }; }
    else if (/^<a\b/i.test(token)) {
      const attr = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(token);
      capture = { type: 'bookmark', url: attr ? bookmarkURL(entities(attr[1] ?? attr[2] ?? attr[3])) : null, text: '' };
    } else if (/^<\/h3\s*>/i.test(token) && capture?.type === 'folder') {
      if (folders.length >= MAX_FOLDERS) throw new Error('文件夹超过 1000 个');
      pendingFolder = randomUUID(); folders.push({ id: pendingFolder, title: entities(capture.text).trim().slice(0, 300) || '文件夹', parentId: stack.at(-1) }); capture = null;
    } else if (/^<\/a\s*>/i.test(token) && capture?.type === 'bookmark') {
      if (capture.url) { if (bookmarks.length >= MAX_BOOKMARKS) throw new Error('收藏超过 5000 条'); bookmarks.push({ id: randomUUID(), url: capture.url, title: entities(capture.text).trim().slice(0, 300) || capture.url, folderId: stack.at(-1), time: Date.now() }); } else skipped++;
      capture = null;
    } else if (/^<dl\b/i.test(token)) { if (stack.length > MAX_DEPTH) throw new Error('文件夹层级超过 32 层'); stack.push(pendingFolder || stack.at(-1)); pendingFolder = null; }
    else if (/^<\/dl\s*>/i.test(token)) { if (stack.length > 1) stack.pop(); pendingFolder = null; }
    else if (capture && !token.startsWith('<')) capture.text += token.slice(0, 600);
  }
  return { ...sanitizeBookmarks(bookmarks, folders), skipped };
}
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function exportBookmarkHTML(data) {
  const { bookmarks, bookmarkFolders } = sanitizeBookmarks(data.bookmarks, data.bookmarkFolders);
  const lines = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>luna 收藏</TITLE>', '<H1>luna 收藏</H1>'];
  function children(parentId, depth) {
    if (depth > MAX_DEPTH) throw new Error('文件夹层级过深'); lines.push('<DL><p>');
    for (const folder of bookmarkFolders.filter(folder => folder.parentId === parentId)) { lines.push('<DT><H3>' + escapeHTML(folder.title) + '</H3>'); children(folder.id, depth + 1); }
    for (const entry of bookmarks.filter(entry => entry.folderId === parentId)) lines.push('<DT><A HREF="' + escapeHTML(entry.url) + '" ADD_DATE="' + Math.floor(entry.time / 1000) + '">' + escapeHTML(entry.title) + '</A>');
    lines.push('</DL><p>');
  }
  children(null, 0); return lines.join('\n');
}
module.exports = { sanitizeBookmarks, parseBookmarkHTML, exportBookmarkHTML, bookmarkURL, MAX_BOOKMARKS, MAX_FOLDERS };
