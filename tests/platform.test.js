const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { localFile, localName } = require('../src/local-files');
const { browserRoots } = require('../src/browser-import');
test('macOS local files preserve absolute POSIX paths while rejecting remote, relative and control-character paths', () => {
  assert.equal(localFile('/Users/alice/Downloads/report.pdf', 'darwin'), '/Users/alice/Downloads/report.pdf');
  assert.equal(localName('/Users/alice/Downloads/report.pdf', 'darwin'), 'report.pdf');
  for (const file of ['report.pdf', '//server/share/report.pdf', '\\\\server\\share\\file', 'file:///Users/alice/file', '/Users/alice/\0file']) assert.equal(localFile(file, 'darwin'), '');
  assert.equal(localFile('C:\\Users\\alice\\file.txt', 'win32'), 'C:\\Users\\alice\\file.txt');
  assert.equal(localFile('/Users/alice/file', 'win32'), '');
});
test('macOS discovers Chromium and Firefox under the current home Application Support directory', () => {
  const roots = browserRoots({}, 'darwin', '/Users/alice');
  assert.deepEqual(roots.map(root => root.browser), ['Edge', 'Chrome', 'Brave', 'Vivaldi', 'Firefox']);
  assert.equal(roots[0].root, path.join('/Users/alice', 'Library/Application Support/Microsoft Edge'));
  assert.equal(roots.at(-1).root, path.join('/Users/alice', 'Library/Application Support/Firefox/Profiles'));
  assert.equal(roots.at(-1).kind, 'firefox');
});
