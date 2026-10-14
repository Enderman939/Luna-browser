const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { BrowserImporter } = require('../src/browser-import');
const { Store } = require('../src/store');
const { DownloadHistory, downloadRecord, fileIdentity } = require('../src/download-history');
const { SearchSuggestions, searchCandidates, suggestionPhrases } = require('../src/search-suggestions');
const { createImportFixture } = require('./import-fixture');
const { DatabaseSync } = require('node:sqlite');
test('browser discovery and read-only SQLite import preserve folders, 650 history URLs and download locations; merge is repeatable', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-import-unit-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const f = createImportFixture(directory), importer = new BrowserImporter({ roots: f.roots });
  const profiles = importer.list(); assert.equal(profiles.length, 1); assert.equal(profiles[0].browser, 'Edge'); assert.equal(Object.hasOwn(profiles[0], 'directory'), false);
  const files = ['Bookmarks', 'History', 'Preferences'].map(name => path.join(f.profile, name)), before = files.map(file => fs.readFileSync(file));
  const read = await importer.read(profiles[0].id, ['bookmarks', 'history', 'downloads']);
  assert.equal(read.bookmarks.bookmarks.length, 1); assert.equal(read.bookmarks.bookmarkFolders.length, 2); assert.equal(read.history.length, 650); assert.equal(read.downloads[0].file, f.file);
  const store = new Store(path.join(directory, 'target')); store.data.settings.theme = 'dark';
  assert.equal(store.importBookmarks(read.bookmarks).added, 1); assert.equal(store.importHistory(read.history).added, 650);
  assert.equal(store.importBookmarks(read.bookmarks).folders, 0); assert.equal(store.importHistory(read.history).added, 0);
  const restored = new Store(path.join(directory, 'target')); assert.equal(restored.data.bookmarkFolders.length, 2); assert.equal(restored.data.history.length, 650); assert.equal(restored.data.settings.theme, 'dark');
  const history = new DownloadHistory(path.join(directory, 'target')); assert.equal(history.import(read.downloads).added, 1); assert.equal(history.import(read.downloads).added, 0);
  const reloaded = new DownloadHistory(path.join(directory, 'target')); const entry = [...reloaded.records.values()][0]; assert.equal(entry.historical, true); assert.equal(entry.status, 'completed'); reloaded.remove(entry.id); assert.equal(fs.existsSync(f.file), true);
  for (const [index, file] of files.entries()) assert.deepEqual(fs.readFileSync(file), before[index]);
  await assert.rejects(importer.read('../forged', ['passwords'])); await assert.rejects(importer.read(profiles[0].id, ['cookies']));
});
test('download records reject remote paths and invalid sources; file deletion identity rejects directories and links', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-delete-unit-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.equal(downloadRecord({ url: 'javascript:bad', createdAt: Date.now() }), null);
  assert.equal(downloadRecord({ url: 'https://example.com/', createdAt: Date.now(), file: '\\\\remote\\share\\file' }).file, '');
  await assert.rejects(fileIdentity(directory)); const file = path.join(directory, 'file.txt'); fs.writeFileSync(file, 'first'); const before = await fileIdentity(file); fs.writeFileSync(file, 'changed file'); assert.notDeepEqual(await fileIdentity(file), before);
});
test('a locked source reports a category error without losing independently imported bookmarks', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-import-lock-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const f = createImportFixture(directory), importer = new BrowserImporter({ roots: f.roots }), source = importer.list()[0];
  const locked = new DatabaseSync(path.join(f.profile, 'History')); locked.exec('BEGIN EXCLUSIVE');
  try { const result = await importer.read(source.id, ['history', 'bookmarks']); assert.equal(result.history, undefined); assert.equal(result.bookmarks.bookmarks.length, 1); assert.equal(result.warnings[0].type, 'history'); }
  finally { locked.exec('ROLLBACK'); locked.close(); }
});
test('Firefox imports places bookmarks and visits and explains its CSV password path', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-import-firefox-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const profile = path.join(directory, 'Profiles', 'default-release'); fs.mkdirSync(profile, { recursive: true });
  const db = new DatabaseSync(path.join(profile, 'places.sqlite'));
  db.exec('CREATE TABLE moz_places(id INTEGER,url TEXT,title TEXT,last_visit_date INTEGER); CREATE TABLE moz_bookmarks(id INTEGER,type INTEGER,parent INTEGER,title TEXT,dateAdded INTEGER,fk INTEGER); CREATE TABLE moz_annos(place_id INTEGER,anno_attribute_id INTEGER,content TEXT); CREATE TABLE moz_anno_attributes(id INTEGER,name TEXT)');
  db.prepare('INSERT INTO moz_places VALUES(?,?,?,?)').run(1, 'https://firefox.example/', 'Firefox visit', Date.now() * 1000);
  db.prepare('INSERT INTO moz_bookmarks VALUES(?,?,?,?,?,?)').run(2, 2, 1, 'Toolbar', Date.now() * 1000, null); db.prepare('INSERT INTO moz_bookmarks VALUES(?,?,?,?,?,?)').run(3, 1, 2, 'Firefox saved', Date.now() * 1000, 1); db.close();
  fs.writeFileSync(path.join(profile, 'logins.json'), JSON.stringify({ logins: [{ encryptedPassword: 'protected' }] }));
  fs.writeFileSync(path.join(profile, 'downloads.json'), JSON.stringify({ list: [{ source: { url: 'https://firefox.example/file.zip' }, target: { path: path.join(directory, 'file.zip') }, startTime: new Date().toISOString(), succeeded: true, totalBytes: 123 }] }));
  const importer = new BrowserImporter({ roots: [{ root: path.dirname(profile), browser: 'Firefox', kind: 'firefox' }] }), source = importer.list()[0];
  const result = await importer.read(source.id, ['bookmarks', 'history', 'downloads', 'passwords']); assert.equal(result.bookmarks.bookmarks.length, 1); assert.equal(result.history.length, 1); assert.equal(result.downloads.length, 1); assert.equal(result.downloads[0].status, 'completed'); assert.equal(result.passwords.protectedCount, 1); assert.match(result.warnings[0].message, /CSV/);
});
test('keyword candidates prioritize searches; URLs retain direct navigation or switch-tab and filtering isolates local data', () => {
  const local = { tabs: [{ id: 4, title: 'Electron reference', url: 'https://electron.example/' }], history: [{ title: 'Electron past', url: 'https://past.example/' }], bookmarks: [] };
  const items = searchCandidates('electron', local, 'bing', ['electron chrome extension', 'electron-builder']);
  assert.deepEqual(items.slice(0, 3).map(item => item.type), ['search', 'search', 'search']); assert.equal(items[0].url, 'https://www.bing.com/search?q=electron'); assert.equal(items[3].tabId, 4);
  assert.equal(searchCandidates('electron.example', local, 'bing')[0].tabId, 4);
  assert.equal(searchCandidates('electron', local, 'bing', [], 'history')[0].type, 'history'); assert.equal(searchCandidates('', local, 'bing').length, 0);
  assert.deepEqual(suggestionPhrases({ g: [{ q: 'electron-builder' }, { q: 'electron-builder' }, { q: 'bad\nvalue' }] }), ['electron-builder']);
});
test('suggestion requests omit cookies, validate sizes, suppress sensitive inputs and cancel superseded requests', async () => {
  const calls = []; const service = new SearchSuggestions((url, options) => { calls.push({ url, options }); return new Promise((resolve, reject) => { const timer = setTimeout(() => resolve(new Response(JSON.stringify(['q', [new URL(url).searchParams.get('query') + ' result']]))), url.includes('slow') ? 100 : 5); options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }); }); });
  const slow = service.get('slow', 'bing'); const fast = service.get('fast', 'bing'); assert.deepEqual(await slow, []); assert.deepEqual(await fast, ['fast result']); assert.equal(calls[0].options.credentials, 'omit');
  await service.get('person@example.com', 'bing'); await service.get('https://example.com/?token=private', 'bing'); assert.equal(calls.length, 2);
  assert.deepEqual(await new SearchSuggestions(async () => new Response('x'.repeat(102401))).get('large', 'bing'), []);
  assert.deepEqual(await new SearchSuggestions(async () => { throw new Error('offline'); }).get('offline', 'bing'), []);
});
