const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { parseBookmarkHTML, exportBookmarkHTML, sanitizeBookmarks } = require('../src/bookmarks');
const { Store } = require('../src/store');
const { addressCandidates } = require('../src/address-candidates');
const { SitePermissions, requestOrigin, secureOrigin } = require('../src/site-permissions');
const { registryEntries, externalURLs } = require('../src/default-browser');

test('bookmark HTML preserves folders and entities while rejecting scripts, credentials and dangerous URLs', () => {
  const html = '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3>A &amp; B</H3><DL><p><DT><H3>Nested</H3><DL><DT><A HREF="https://example.com/a?x=1&amp;y=2">&lt;Hello&gt;</A></DL><DT><A HREF="javascript:alert(1)">bad</A><A HREF="https://user:pass@example.com/">credentials</A><script><A HREF="https://in-script.example/">fake</A></script></DL><DT><A HREF="https://root.example/">Root</A></DL>';
  const parsed = parseBookmarkHTML(html); assert.equal(parsed.bookmarks.length, 2); assert.equal(parsed.skipped, 2); assert.equal(parsed.bookmarkFolders.length, 2);
  assert.equal(parsed.bookmarkFolders[0].title, 'A & B'); assert.equal(parsed.bookmarkFolders[1].parentId, parsed.bookmarkFolders[0].id);
  assert.equal(parsed.bookmarks[0].title, '<Hello>'); assert.equal(parsed.bookmarks[0].url, 'https://example.com/a?x=1&y=2'); assert.equal(parsed.bookmarks[1].folderId, null);
  const roundtrip = parseBookmarkHTML(exportBookmarkHTML(parsed)); assert.deepEqual(roundtrip.bookmarks.map(({ url, title }) => ({ url, title })), parsed.bookmarks.map(({ url, title }) => ({ url, title })));
  assert.equal(roundtrip.bookmarkFolders[1].parentId, roundtrip.bookmarkFolders[0].id);
  assert.throws(() => parseBookmarkHTML('a'.repeat(5 * 1024 * 1024 + 1)));
});
test('old bookmarks migrate stable IDs; folder cycles are removed and editing survives restart', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-bookmark-unit-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const migrated = sanitizeBookmarks([{ url: 'https://example.com', title: 'Old' }], [{ id: 'a', title: 'A', parentId: 'b' }, { id: 'b', title: 'B', parentId: 'a' }]);
  assert.equal(migrated.bookmarks[0].id, sanitizeBookmarks(migrated.bookmarks, []).bookmarks[0].id);
  assert.equal(migrated.bookmarkFolders[0].parentId, null);
  const store = new Store(directory); store.toggleBookmark('https://example.com', 'Old'); store.bookmarkAction({ action: 'folder-save', title: 'Folder' });
  const folder = store.data.bookmarkFolders[0], entry = store.data.bookmarks[0]; store.bookmarkAction({ action: 'save', id: entry.id, title: 'Updated', url: entry.url, folderId: folder.id });
  assert.throws(() => store.bookmarkAction({ action: 'folder-save', id: folder.id, title: 'Cycle', parentId: folder.id }));
  assert.throws(() => store.bookmarkAction({ action: 'save', title: 'Bad', url: 'javascript:alert(1)' }));
  const restored = new Store(directory); assert.equal(restored.data.bookmarks[0].folderId, folder.id); assert.equal(restored.data.bookmarks[0].title, 'Updated');
  restored.bookmarkAction({ action: 'folder-delete', id: folder.id }); assert.equal(restored.data.bookmarks.length, 0);
});
test('address candidates rank open tabs, deduplicate URLs, respect supplied history and reject nonweb sources', () => {
  const data = { tabs: [{ id: 2, title: 'Example tab', url: 'https://example.com/' }], bookmarks: [{ title: 'Example bookmark', url: 'https://example.com/' }, { title: 'Example other', url: 'https://other.example/' }], history: [{ title: 'Example past', url: 'https://past.example/' }, { title: 'Example bad', url: 'javascript:test' }] };
  const items = addressCandidates('example', data); assert.equal(items.length, 3); assert.equal(items[0].tabId, 2); assert.equal(items[1].type, 'bookmark');
  assert.equal(addressCandidates('past', { ...data, history: [] }).length, 0);
});
test('permissions reject cross-origin and insecure requests, check remembered grants, and deny a stale page after confirmation', async () => {
  const settings = {}, store = { data: { siteSettings: settings }, save() {} }; let current = 'https://example.com/', confirmation;
  const web = new EventEmitter(); web.id = 1; web.isDestroyed = () => false; web.getURL = () => current;
  const browser = { window: { isDestroyed: () => false }, prompts: { ask: () => new Promise(resolve => { confirmation = resolve; }) } };
  const session = { setPermissionCheckHandler(handler) { this.check = handler; }, setPermissionRequestHandler(handler) { this.request = handler; } };
  const manager = new SitePermissions({ session, store, owner: () => browser, changed() {} });
  assert.equal(secureOrigin('http://remote.example/'), null); assert.equal(requestOrigin(web, 'https://evil.example/'), null);
  manager.set('https://example.com', 'camera', 'allow'); assert.equal(session.check(web, 'media', current, { mediaType: 'video' }), true);
  assert.equal(session.check(web, 'media', 'https://evil.example/', { mediaType: 'video' }), false);
  const pending = manager.request(web, 'notifications', { requestingUrl: current, isMainFrame: true }); current = 'https://other.example/'; confirmation({ accepted: true });
  assert.equal(await pending, false); assert.equal(settings['https://example.com'].permissions.notifications, undefined);
  assert.equal(await manager.request(web, 'usb', { requestingUrl: current }), false);
});
test('Windows registration quotes executable and URL separately without changing UserChoice; external URL arguments are restricted', () => {
  const entries = registryEntries('E:\\Some Folder\\luna.exe'); assert.ok(entries.some(([key, , value]) => key.endsWith('shell\\open\\command') && value === '"E:\\Some Folder\\luna.exe" -- "%1"'));
  assert.equal(entries.some(([key]) => key.includes('UserChoice')), false);
  assert.throws(() => registryEntries('E:\\luna".exe')); assert.throws(() => registryEntries('relative.exe'));
  assert.deepEqual(externalURLs(['--', 'https://example.com/a', 'javascript:test', 'file:///x', 'https://u:p@example.com/', '--https://bad.example/']), ['https://example.com/a']);
});
