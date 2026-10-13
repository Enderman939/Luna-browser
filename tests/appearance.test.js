const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_APPEARANCE, sanitizeAppearance, patchAppearance, appearanceTokens, contrast } = require('../src/ui/appearance-model');
const { sanitizeSettings } = require('../src/core');

test('old settings receive an independent default appearance', () => {
  const first = sanitizeSettings({ theme: 'dark' }), second = sanitizeSettings({});
  assert.deepEqual(first.appearance, DEFAULT_APPEARANCE);
  first.appearance.regions.chrome.color = '#123456';
  assert.equal(second.appearance.regions.chrome.color, ''); assert.equal(DEFAULT_APPEARANCE.regions.chrome.color, '');
});
test('appearance rejects CSS and URL injection and limits icon configuration', () => {
  const input = { regions: { chrome: { color: 'red; background:url(https://evil.test)', image: '../../private.png', imageOpacity: 400 }, home: { color: '#AABBCC', image: 'a'.repeat(64) + '.png' } }, icons: { color: 'url(file:///secret)', size: 999, weight: 99, shape: 'injected', custom: { reload: 'file:///secret', __proto__: { menu: 'b'.repeat(64) + '.png' } } } };
  const appearance = sanitizeAppearance(input);
  assert.equal(appearance.regions.chrome.color, ''); assert.equal(appearance.regions.chrome.image, ''); assert.equal(appearance.regions.chrome.imageOpacity, 100);
  assert.equal(appearance.regions.home.color, '#aabbcc'); assert.equal(appearance.icons.color, ''); assert.equal(appearance.icons.size, 18); assert.equal(appearance.icons.weight, 1.6);
  assert.deepEqual(appearance.icons.custom, {}, 'inherited icon names must not become trusted assets');
});
test('region edits preserve other areas and icon patches cannot inject resource identifiers', () => {
  let appearance = patchAppearance(DEFAULT_APPEARANCE, { section: 'regions', key: 'settings', values: { color: '#102030' } });
  appearance = patchAppearance(appearance, { section: 'icons', values: { size: 24, custom: { reload: 'a'.repeat(64) + '.png' } } });
  assert.equal(appearance.regions.settings.color, '#102030'); assert.equal(appearance.regions.chrome.color, ''); assert.equal(appearance.icons.size, 24); assert.deepEqual(appearance.icons.custom, {});
  assert.throws(() => patchAppearance(appearance, { section: 'regions', key: '__proto__', values: { color: '#ffffff' } }));
});
test('custom backgrounds keep readable text while automatic regions follow theme changes', () => {
  const appearance = patchAppearance(DEFAULT_APPEARANCE, { section: 'regions', key: 'settings', values: { color: '#183e33' } });
  const light = appearanceTokens(appearance, false), dark = appearanceTokens(appearance, true);
  assert.equal(light.regions.settings.bg, dark.regions.settings.bg);
  assert.notEqual(light.regions.chrome.bg, dark.regions.chrome.bg);
  for (const color of ['#ffffff', '#111111', '#183e33', '#d9b681', '#777777']) {
    const tokens = appearanceTokens(patchAppearance(appearance, { section: 'regions', key: 'settings', values: { color } }), false);
    assert.ok(contrast(tokens.regions.settings.bg, tokens.regions.settings.ink) >= 4.5);
  }
});
