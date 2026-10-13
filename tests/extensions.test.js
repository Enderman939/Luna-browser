const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { extractExtension, unpackContainer } = require('../src/extension-package');
const { createCrx, zipExtension, extensionFiles } = require('./extension-fixture');

for (const version of [2, 3]) test('signed CRX' + version + ' verifies and extracts into a loadable extension', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-crx-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const buffer = createCrx(version), manifest = extractExtension(buffer, directory);
  assert.equal(manifest.manifest_version, 3); assert.equal(manifest.name, 'Luna Test Extension'); assert.ok(manifest.key);
  assert.equal(fs.existsSync(path.join(directory, 'popup.js')), true);
  const corrupt = Buffer.from(buffer); corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => unpackContainer(corrupt), /签名/);
});
test('ZIP import accepts a manifest and rejects traversal paths', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-zip-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.equal(extractExtension(zipExtension(), directory).name, 'Luna Test Extension');
  const files = extensionFiles(); files['unsafe:outside.txt'] = 'bad';
  assert.throws(() => extractExtension(zipExtension(files), path.join(directory, 'bad')), /无效路径/);
});
test('invalid CRX headers and invalid manifests fail before extension execution', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-invalid-ext-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => unpackContainer(Buffer.from('not a crx')), /无效/);
  assert.throws(() => extractExtension(zipExtension({ 'manifest.json': JSON.stringify({ name: 'Bad', manifest_version: 99 }) }), directory), /manifest/);
});
