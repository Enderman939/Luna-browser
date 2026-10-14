const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { HOME, SETTINGS, DEFAULT_SETTINGS, resolveAddress, resolveWebsite, isWebUrl, sanitizeData, sanitizeSettings, recentSites } = require('../src/core');
const { Store } = require('../src/store');

test('addresses resolve to web URLs, search queries, or the home page', () => {
  assert.equal(resolveAddress(''), HOME);
  assert.equal(resolveAddress('github.com'), 'https://github.com/');
  assert.equal(resolveAddress('example.com:8080/path'), 'https://example.com:8080/path');
  assert.equal(resolveAddress('https://example.com/a?q=x'), 'https://example.com/a?q=x');
  assert.equal(resolveAddress('localhost:3000/test'), 'http://localhost:3000/test');
  assert.equal(resolveAddress('127.0.0.1:8080'), 'http://127.0.0.1:8080/');
  assert.equal(resolveAddress('天气怎么样'), 'https://www.baidu.com/s?wd=' + encodeURIComponent('天气怎么样'));
  assert.equal(resolveAddress('how to build'), 'https://www.baidu.com/s?wd=how%20to%20build');
  assert.equal(resolveAddress('例子.中国'), 'https://xn--fsqu00a.xn--fiqs8s/');
});
test('non-web protocols cannot be entered or stored', () => {
  for (const url of ['javascript:alert(1)', 'file:///C:/Windows', 'data:text/html,test', 'ftp://example.com', 'vbscript:test']) {
    assert.equal(resolveAddress(url), HOME); assert.equal(isWebUrl(url), false);
  }
  const data = sanitizeData({ bookmarks: [{ url: 'file:///test' }], history: [null], session: ['javascript:test'] });
  assert.deepEqual(data.bookmarks, []); assert.deepEqual(data.history, []); assert.deepEqual(data.session, []);
});
test('internal pages and chosen search engine resolve correctly', () => {
  assert.equal(resolveAddress(SETTINGS), SETTINGS);
  assert.equal(resolveAddress('luna browser', 'google'), 'https://www.google.com/search?q=luna%20browser');
  assert.equal(resolveAddress('luna browser', 'bing'), 'https://www.bing.com/search?q=luna%20browser');
  assert.equal(resolveAddress('luna browser', 'duckduckgo'), 'https://duckduckgo.com/?q=luna%20browser');
  assert.equal(resolveAddress('test', '__proto__'), 'https://www.baidu.com/s?wd=test');
  assert.equal(resolveWebsite('example.com:8080/path'), 'https://example.com:8080/path');
  assert.equal(resolveWebsite('localhost:5000'), 'http://localhost:5000/');
  for (const input of ['not a site', 'example.com bad input', 'javascript:alert(1)', 'luna://settings', '']) assert.equal(resolveWebsite(input), null);
});
test('settings reject invalid values and support existing profiles', () => {
  assert.deepEqual(sanitizeData({ bookmarks: [] }).settings, DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings({ theme: 'green', startup: 'other', searchEngine: '__proto__', showHome: 'false', homePage: 'javascript:bad' }), DEFAULT_SETTINGS);
  const settings = sanitizeSettings({ theme: 'dark', searchEngine: 'google', showBookmarks: false, homePage: 'https://example.com/' });
  assert.equal(settings.theme, 'dark'); assert.equal(settings.showBookmarks, false); assert.equal(settings.homePage, 'https://example.com/');
});
test('recent websites deduplicate origins and put manual shortcuts first', () => {
  const history = [{ url: 'https://one.example/a', title: 'Latest' }, { url: 'https://one.example/b', title: 'Older' }, { url: 'https://two.example', title: 'Second' }, { url: 'file:///bad' }];
  const sites = recentSites(history);
  assert.equal(sites.length, 2); assert.equal(sites[0].title, 'Latest');
  const manual = [{ url: 'https://one.example/home', title: 'Pinned' }];
  assert.equal(recentSites(history, manual)[0].title, 'Pinned'); assert.equal(recentSites(history, manual, 1).length, 1);
});
test('stored data is deduplicated and bounded', () => {
  const data = sanitizeData({ bookmarks: [{ url: 'https://example.com', title: 'First' }, { url: 'https://example.com', title: 'Second' }], history: Array.from({ length: 10500 }, (_, index) => ({ url: 'https://example.com/' + index })) });
  assert.equal(data.bookmarks.length, 1); assert.equal(data.bookmarks[0].title, 'Second'); assert.equal(data.history.length, 10000);
});
test('bookmarks and history survive restart; corrupt data can recover', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-store-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  store.data.settings.theme = 'dark'; store.data.settings.searchEngine = 'bing';
  store.addShortcut('https://example.org/a', 'Shortcut'); store.addShortcut('https://example.org/b', 'New shortcut');
  store.toggleBookmark('https://example.com', 'Example'); store.visit('https://example.com', 'Example'); store.visit('https://example.com', 'New title');
  const restored = new Store(directory);
  assert.equal(restored.data.bookmarks.length, 1); assert.equal(restored.data.history.length, 1); assert.equal(restored.data.history[0].title, 'New title');
  assert.equal(restored.data.settings.theme, 'dark'); assert.equal(restored.data.settings.searchEngine, 'bing');
  assert.equal(restored.data.shortcuts.length, 1); assert.equal(restored.data.shortcuts[0].title, 'New shortcut');
  restored.toggleBookmark('https://example.com', 'Example'); assert.equal(restored.data.bookmarks.length, 0);
  fs.writeFileSync(restored.file, 'not json'); const recovered = new Store(directory); assert.equal(recovered.data.history.length, 0); recovered.save();
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(recovered.file, 'utf8')));
});
