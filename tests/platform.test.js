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
test('macOS smoke-test shutdown quits the resident application after its last window closes', async () => {
  const { EventEmitter } = require('node:events');
  const { createRequire } = require('node:module');
  const fs = require('node:fs'), vm = require('node:vm');
  const helper = require.resolve('./app-helpers');
  const context = { module: { exports: {} }, require: createRequire(helper), process: { platform: 'darwin' }, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(helper, 'utf8'), context, { filename: helper });
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
  let windowClosed = false, quitCalls = 0, automationClosed = false;
  const page = {
    isClosed: () => windowClosed,
    locator: () => ({ count: async () => 0 }),
    evaluate: async () => { windowClosed = true; },
    waitForSelector: async () => { throw new Error('Window closed'); },
  };
  const application = {
    process: () => child,
    evaluate: async callback => callback({
      BrowserWindow: { getAllWindows: () => windowClosed ? [] : [{}] },
      app: { quit() { quitCalls++; child.exitCode = 0; child.emit('exit', 0); } },
    }),
    close: async () => { automationClosed = true; },
  };
  await context.module.exports.closeApp(application, page, false);
  assert.equal(windowClosed, true); assert.equal(quitCalls, 1);
  assert.equal(child.exitCode, 0); assert.equal(automationClosed, true);
});
