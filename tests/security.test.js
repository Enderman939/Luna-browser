const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { matchPattern, patternContains, extensionURL, extensionResource } = require('../src/extension-security');
const { originMarker } = require('../src/download-origin');

test('website permissions enforce schemes and hostname boundaries', () => {
  assert.equal(matchPattern('https://*.example.com/*', 'https://example.com/page'), true);
  assert.equal(matchPattern('https://*.example.com/*', 'https://sub.example.com:8443/page'), true);
  for (const url of ['http://example.com/', 'https://badexample.com/', 'https://example.com.evil.test/']) assert.equal(matchPattern('https://*.example.com/*', url), false);
  for (const url of ['file:///C:/secret', 'data:text/plain,test', 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/']) assert.equal(matchPattern('<all_urls>', url), false);
  assert.equal(matchPattern('https://example.com/allowed/*', 'https://example.com/forbidden/page'), false);
});
test('optional website permissions cannot exceed declared scope', () => {
  assert.equal(patternContains('*://*.example.com/*', 'https://sub.example.com/*'), true);
  assert.equal(patternContains('https://*.example.com/*', '*://*.example.com/*'), false);
  assert.equal(patternContains('https://*.example.com/*', 'https://*.evil.example/*'), false);
  assert.equal(patternContains('https://example.com/*', '<all_urls>'), false);
  assert.equal(patternContains('<all_urls>', 'file:///*'), false);
});
test('extensions can open web and their own resources but cannot navigate to local files or other extensions', () => {
  const extension = { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
  assert.equal(extensionURL('options.html', extension), 'chrome-extension://' + extension.id + '/options.html');
  assert.equal(extensionURL('https://example.com/', extension), 'https://example.com/');
  for (const input of ['file:///C:/secret', 'javascript:alert(1)', 'data:text/html,test', 'chrome://settings', 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/options.html']) assert.throws(() => extensionURL(input, extension));
});
test('extension resource resolution rejects sibling-prefix traversal and filesystem links outside the package', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-resource-security-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'extension'), sibling = path.join(directory, 'extension-private');
  fs.mkdirSync(root); fs.mkdirSync(sibling); fs.writeFileSync(path.join(root, 'icon.png'), 'fixture'); fs.writeFileSync(path.join(sibling, 'private.png'), 'fixture');
  assert.equal(extensionResource(root, 'icon.png'), fs.realpathSync(path.join(root, 'icon.png')));
  assert.throws(() => extensionResource(root, '../extension-private/private.png'));
  const link = path.join(root, 'linked'); fs.symlinkSync(sibling, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => extensionResource(root, 'linked/private.png'));
});
test('Windows download origin markers omit credentials and token-bearing URL components', () => {
  const marker = originMarker('https://user:pass@example.com/file.exe?token=secret#private');
  assert.equal(marker, '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://example.com/file.exe\r\n');
  assert.throws(() => originMarker('file:///C:/secret'));
});
