const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseExtensionId, parseStoreRequest, edgeCrxURL, extensionIdFromKey, crxURL, fetchCrx, downloadStoreCrx, friendlyError } = require('../src/webstore-download');
const { createCrx } = require('./extension-fixture');
const { unpackContainer } = require('../src/extension-package');
const id = 'bgnkhhnnamicmpeenaelnjfhikgbkllg';
test('store links are validated and the modern Google update endpoint is used', () => {
  assert.equal(parseExtensionId(id), id);
  assert.equal(parseExtensionId('https://chromewebstore.google.com/detail/adguard/' + id), id);
  assert.equal(new URL(crxURL(id, '152.0.0.0')).hostname, 'update.googleapis.com');
  for (const value of ['https://evil.example/' + id, 'https://chromewebstore.google.com.evil.example/' + id, 'bad', 'javascript:alert(1)']) assert.throws(() => parseExtensionId(value));
});
test('Edge links and the selected market resolve to Microsoft downloads', () => {
  const edge = 'pdffkfellgipmhklpdmokmckkkfcopbh';
  assert.deepEqual(parseStoreRequest('https://microsoftedge.microsoft.com/addons/detail/adguard/' + edge), { id: edge, market: 'edge' });
  assert.deepEqual(parseStoreRequest(id, 'chrome'), { id, market: 'chrome' });
  assert.deepEqual(parseStoreRequest(id), { id, market: 'edge' });
  assert.equal(new URL(edgeCrxURL(edge, '152')).hostname, 'edge.microsoft.com');
  assert.throws(() => parseStoreRequest('https://microsoftedge.microsoft.com.evil.example/addons/detail/' + edge));
});
test('CRX download streams and preserves a signed package', async () => {
  const buffer = createCrx(3), progress = [];
  const result = await fetchCrx(async () => new Response(buffer, { headers: { 'Content-Length': String(buffer.length) } }), crxURL(id, '152'), info => progress.push(info));
  assert.deepEqual(result, buffer); assert.equal(progress.at(-1).received, buffer.length);
  assert.match(extensionIdFromKey(unpackContainer(result).key), /^[a-p]{32}$/);
});
test('invalid responses and package sizes report actionable errors', async () => {
  await assert.rejects(() => fetchCrx(async () => new Response('HTML'), crxURL(id, '152')), /CRX/);
  await assert.rejects(() => fetchCrx(async () => new Response('', { status: 404 }), crxURL(id, '152')), /未提供/);
  await assert.rejects(() => fetchCrx(async () => new Response('bad', { headers: { 'Content-Length': '100' } }), crxURL(id, '152'), () => {}, { limit: 16 }), /超过/);
});
test('transport failure retries the official fallback, CDN failures identify the actual host', async () => {
  const buffer = createCrx(3), hosts = [];
  const result = await downloadStoreCrx(async url => {
    const host = new URL(url).hostname; hosts.push(host);
    if (host === 'update.googleapis.com') throw new Error('net::ERR_CONNECTION_RESET');
    return new Response(buffer);
  }, id, '152');
  assert.deepEqual(result, buffer); assert.deepEqual(hosts, ['update.googleapis.com', 'clients2.google.com']);
  const error = new Error('net::ERR_CONNECTION_RESET'); error.downloadHost = 'clients2.googleusercontent.com';
  await assert.rejects(() => downloadStoreCrx(async () => { throw error; }, id, '152'), /clients2.googleusercontent.com/);
  assert.match(friendlyError(new TypeError('fetch failed')), /无法连接/);
});
