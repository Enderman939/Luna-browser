const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Prompts } = require('../src/prompts');
const { BrowsingData, rangeStart, cookieKey, nativeCookieTimes } = require('../src/browsing-data');
const { sanitizeData, HOME, SETTINGS } = require('../src/core');
const { Store } = require('../src/store');

test('prompts queue, validate response IDs, and cancel without approval', async () => {
  const messages = [], prompts = new Prompts((channel, payload) => messages.push({ channel, payload }), () => {});
  const first = prompts.ask({ title: 'First' }), second = prompts.ask({ title: 'Second' });
  assert.equal(messages.length, 0); prompts.setReady(); assert.equal(messages[0].payload.title, 'First');
  assert.equal(prompts.reply('wrong-id', { accepted: true }), false);
  prompts.reply(prompts.active.view.id, { accepted: true, restore: false });
  assert.deepEqual(await first, { accepted: true, restore: false });
  assert.equal(prompts.active.view.title, 'Second'); prompts.cancelAll(); assert.equal((await second).accepted, false);
});
test('session storage keeps internal pages, repeated tabs, and selected position', () => {
  const data = sanitizeData({ session: [HOME, 'https://example.com/', SETTINGS, 'https://example.com/', 'javascript:bad'], sessionActive: 3, restoreOnce: false });
  assert.deepEqual(data.session, [HOME, 'https://example.com/', SETTINGS, 'https://example.com/']);
  assert.equal(data.sessionActive, 3); assert.equal(data.restoreOnce, false);
  assert.equal(sanitizeData({}).restoreOnce, null);
});
test('time ranges use the exact requested cutoff', () => {
  assert.equal(rangeStart('quarter', 10000000), 10000000 - 900000);
  assert.equal(rangeStart('hour', 10000000), 6400000); assert.equal(rangeStart('all'), 0);
  assert.throws(() => rangeStart('invalid'));
});
test('cookie creation times are read without accessing encrypted cookie values', t => {
  const { DatabaseSync } = require('node:sqlite');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-cookie-times-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'Network'));
  const database = new DatabaseSync(path.join(directory, 'Network', 'Cookies'));
  database.exec('CREATE TABLE cookies(host_key TEXT,name TEXT,path TEXT,is_secure INTEGER,creation_utc INTEGER)');
  const time = Date.now() - 7200000;
  database.prepare('INSERT INTO cookies VALUES(?,?,?,?,?)').run('.example.com', 'session', '/', 1, BigInt(time + 11644473600000) * 1000n);
  database.close();
  assert.ok(Math.abs(nativeCookieTimes(directory)['.example.com|/|session|1'] - time) < 1);
});
test('selected categories and time ranges preserve other data and download files', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-privacy-test-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory), now = Date.now(), old = now - 7200000;
  store.data.history = [{ url: 'https://recent.example/', time: now - 1000 }, { url: 'https://old.example/', time: old }];
  store.data.bookmarks = [{ url: 'https://keep.example/', title: 'Keep', time: old }];
  const file = path.join(directory, 'download.txt'); fs.writeFileSync(file, 'Keep file');
  const jobs = new Map([['new', { status: 'completed', createdAt: now - 1000, file }], ['old', { status: 'completed', createdAt: old }], ['running', { status: 'paused', createdAt: now - 1000 }]]);
  const cookies = new EventEmitter(); const cookieList = [{ domain: 'recent.example', name: 'new', path: '/', secure: false, hostOnly: true }, { domain: 'old.example', name: 'old', path: '/', secure: false, hostOnly: true }];
  cookies.get = async () => [...cookieList]; cookies.flushStore = async () => {};
  cookies.set = async details => { const index = cookieList.findIndex(cookie => cookie.name === details.name); if (index >= 0) cookieList.splice(index, 1); };
  store.data.cookieTimes[cookieKey(cookieList[0])] = now - 1000; store.data.cookieTimes[cookieKey(cookieList[1])] = old;
  let cacheCleared = false;
  const session = { cookies, getStoragePath: () => directory, getCacheSize: async () => 128, clearStorageData: async () => {}, clearCache: async () => { cacheCleared = true; }, clearCodeCaches: async () => {}, extensions: { getAllExtensions: () => [] } };
  const manager = { jobs, persist: () => {}, changed: () => {} };
  const data = new BrowsingData({ session, store, downloadManager: manager, nativeDownloads: new Map(), tabs: new Map() });
  const stats = await data.stats('hour'); assert.equal(stats.history, 1); assert.equal(stats.cookies, 1); assert.equal(stats.downloads, 1);
  await data.clear({ range: 'hour', types: ['history', 'cookies', 'downloads'] });
  assert.equal(store.data.history.length, 1); assert.equal(store.data.history[0].url, 'https://old.example/');
  assert.equal(store.data.bookmarks.length, 1); assert.equal(cookieList[0].name, 'old'); assert.equal(cacheCleared, false);
  assert.equal(jobs.has('new'), false); assert.equal(jobs.has('old'), true); assert.equal(jobs.has('running'), true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'Keep file');
  await assert.rejects(() => data.clear({ range: 'all', types: ['not-real'] }));
});
