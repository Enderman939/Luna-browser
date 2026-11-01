const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { SitePermissions } = require('../src/site-permissions');

function setup() {
  const handlers = {}, store = { data: { siteSettings: {} }, saveCount: 0, save() { this.saveCount++; } };
  const session = { setPermissionCheckHandler(handler) { handlers.check = handler; }, setPermissionRequestHandler(handler) { handlers.request = handler; } };
  let changes = 0;
  const manager = new SitePermissions({ session, store, owner: () => ({ isPrivate: false, window: { isDestroyed: () => false }, prompts: { ask: async () => ({ accepted: true }) } }), changed: () => changes++ });
  return { manager, store, handlers, changes: () => changes };
}

test('permission center lists only explicit secure-origin grants and revokes without clearing zoom', () => {
  const { manager, store } = setup();
  manager.set('https://example.com', 'camera', 'allow'); manager.set('https://example.com', 'notifications', 'block');
  store.data.siteSettings['http://remote.example'] = { time: Date.now(), permissions: { camera: 'allow' } };
  store.data.siteSettings['https://example.com'].zoomFactor = 1.25;
  const rows = manager.list(); assert.equal(rows.length, 1); assert.equal(rows[0].permissions.length, 2);
  manager.clear('https://example.com');
  assert.equal(manager.decision('https://example.com', 'camera'), 'ask');
  assert.equal(store.data.siteSettings['https://example.com'].zoomFactor, 1.25);
  assert.throws(() => manager.clear('http://remote.example'), /无效/);
});

test('permission center rejects invalid keys and decisions', () => {
  const { manager } = setup();
  assert.throws(() => manager.set('https://example.com', '__proto__', 'allow'), /无效/);
  assert.throws(() => manager.set('https://example.com', 'camera', 'prompt'), /无效/);
  assert.throws(() => manager.set('http://example.com', 'camera', 'allow'), /无效/);
});
