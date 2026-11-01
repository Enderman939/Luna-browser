const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeManifest, sanitizeInstalledApps, withinScope, appId } = require('../src/pwa-apps');

test('PWA manifests stay on the current origin and within their declared scope', () => {
  const record = sanitizeManifest({ name: 'Fixture App', short_name: 'Fixture', start_url: '/app/start?mode=1', scope: '/app/', display: 'standalone', theme_color: '#abc', icons: [{ src: '/icon.png' }, { src: 'https://cdn.example/icon.png' }] }, 'https://example.com/page', 'https://example.com/manifest.webmanifest');
  assert.equal(record.name, 'Fixture App'); assert.equal(record.startUrl, 'https://example.com/app/start?mode=1');
  assert.deepEqual(record.icons, ['https://example.com/icon.png']); assert.equal(record.display, 'standalone');
  assert.equal(withinScope('https://example.com/app/', record.scope), true);
  assert.equal(withinScope('https://example.com/application/', record.scope), false);
  assert.equal(withinScope('https://outside.example/app/', record.scope), false);
  assert.equal(appId(record.startUrl), record.id);
});

test('PWA manifest and persisted records reject insecure or cross-origin URLs', () => {
  for (const page of ['http://outside.example/app', 'file:///tmp/page.html']) assert.throws(() => sanitizeManifest({ name: 'Unsafe' }, page), /安全网页/);
  assert.throws(() => sanitizeManifest({ name: 'Cross origin', start_url: 'https://attacker.example/' }, 'https://example.com/'), /当前网站/);
  assert.throws(() => sanitizeManifest({ name: 'Bad scope', start_url: '/app/start', scope: '/other/' }, 'https://example.com/'), /范围无效/);
  assert.deepEqual(sanitizeInstalledApps([{ id: 'a'.repeat(32), name: 'bad', origin: 'https://example.com', startUrl: 'https://example.com/app', scope: 'https://example.com/app/', icons: [] }]), []);
});

test('PWA app records are bounded and sanitized before persistence', () => {
  const record = sanitizeManifest({ name: 'App', start_url: '/app/', scope: '/app/' }, 'https://example.com/', 'https://example.com/manifest.json');
  const clean = sanitizeInstalledApps([record, { ...record, origin: 'https://other.example/' }]);
  assert.equal(clean.length, 1); assert.equal(clean[0].origin, 'https://example.com');
});
