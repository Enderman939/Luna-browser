const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createBackup, parseBackup, decryptPasswords, mergeData } = require('../src/browser-backup');
const { sanitizeData } = require('../src/core');

const sample = () => sanitizeData({
  bookmarks: [{ id: 'first', url: 'https://example.com/', title: 'Example', time: 10 }],
  bookmarkFolders: [{ id: 'folder-a', title: 'Saved', parentId: null }],
  history: [{ url: 'https://example.com/page', title: 'Page', time: 20 }],
  shortcuts: [{ url: 'https://example.org/', title: 'Shortcut', time: 30 }],
  session: ['https://session.example/'], settings: { theme: 'dark' },
});

test('backup excludes passwords by default and omits live session state', () => {
  const buffer = createBackup({ data: sample(), downloads: [{ id: 'past-a', url: 'https://example.com/file?secret=token', file: 'C:\\Downloads\\file.zip', createdAt: 40, status: 'completed' }] });
  const backup = parseBackup(buffer);
  assert.equal(backup.passwords, null); assert.deepEqual(backup.data.session, []); assert.equal(backup.data.sessionWindows.length, 0);
  assert.equal(backup.downloads[0].url, 'https://example.com/file');
  assert.equal(buffer.toString().includes('secret=token'), false);
});

test('password backup uses independent authenticated encryption and rejects a wrong passphrase', () => {
  const passwords = { entries: [{ id: crypto.randomUUID(), origin: 'https://login.example', username: 'alice', password: 'Fixture-Secret-Password', createdAt: 1, updatedAt: 2 }], blocked: ['https://blocked.example'] };
  const buffer = createBackup({ data: sample(), passwords, includePasswords: true, passphrase: 'correct horse battery staple' });
  assert.equal(buffer.toString().includes('Fixture-Secret-Password'), false);
  const parsed = parseBackup(buffer), restored = decryptPasswords(parsed.passwords, 'correct horse battery staple');
  assert.equal(restored.entries[0].password, 'Fixture-Secret-Password'); assert.deepEqual(restored.blocked, ['https://blocked.example']);
  assert.throws(() => decryptPasswords(parsed.passwords, 'incorrect passphrase'), /口令错误/);
  assert.throws(() => createBackup({ data: sample(), includePasswords: true, passwords, passphrase: 'short' }), /至少需要 12/);
});

test('merge keeps current duplicates, imports new folders and sorts unique history', () => {
  const current = sample(); current.bookmarks[0].title = 'Keep current';
  const incoming = sample(); incoming.bookmarks[0].title = 'Backup copy';
  incoming.bookmarks.push({ id: 'second', url: 'https://new.example/', title: 'New', time: 25, folderId: 'folder-a' });
  incoming.history.push({ url: 'https://example.com/page', title: 'Newer page', time: 50 }, { url: 'https://new.example/', title: 'New site', time: 40 });
  const merged = mergeData(current, incoming, 'merge');
  assert.equal(merged.bookmarks.length, 2); assert.equal(merged.bookmarks[0].title, 'Keep current');
  assert.equal(merged.bookmarkFolders.length, 1); assert.equal(merged.bookmarks.find(item => item.url === 'https://new.example/').folderId, 'folder-a');
  assert.equal(merged.history.find(item => item.url === 'https://example.com/page').title, 'Newer page');
  assert.equal(merged.history[0].url, 'https://example.com/page');
  assert.throws(() => mergeData(current, incoming, 'invalid'), /恢复方式/);
});

test('backup parser rejects unsupported, oversized and malformed encrypted files', () => {
  assert.throws(() => parseBackup(Buffer.from('{bad')), /有效的 JSON/);
  assert.throws(() => parseBackup(Buffer.from(JSON.stringify({ format: 'luna-browser-backup', version: 99 }))), /不支持/);
  const raw = JSON.parse(createBackup({ data: sample(), includePasswords: true, passwords: { entries: [], blocked: [] }, passphrase: 'good enough backup phrase' }));
  raw.passwords.tag = '***';
  assert.throws(() => parseBackup(Buffer.from(JSON.stringify(raw))), /格式无效/);
});
