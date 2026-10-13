const test = require('node:test');
const assert = require('node:assert/strict');
const { highlightLink, contextMenuItems } = require('../src/context-menu-model');
const { resolveAddress, sanitizeData } = require('../src/core');

test('highlight links preserve the page query and anchor, escape text-fragment delimiters, and replace an existing directive', () => {
  const link = highlightLink('https://example.com/article?language=zh#chapter:~:text=old', '  A-B, C & D\nE  ');
  assert.equal(link, 'https://example.com/article?language=zh#chapter:~:text=A%2DB%2C%20C%20%26%20D%20E');
  assert.throws(() => highlightLink('https://example.com/', '  '));
});
test('only HTTP and HTTPS source pages may be resolved and restored', () => {
  assert.equal(resolveAddress('view-source:https://example.com/article'), 'view-source:https://example.com/article');
  for (const url of ['view-source:file:///C:/secret', 'view-source:javascript:alert(1)', 'view-source:view-source:https://example.com/']) assert.equal(resolveAddress(url), 'luna://newtab');
  assert.deepEqual(sanitizeData({ session: ['view-source:https://example.com/', 'view-source:file:///C:/secret'] }).session, ['view-source:https://example.com/']);
});
test('password fields offer editing without exposing their selection to search, reading or translation services', () => {
  const items = contextMenuItems({ isEditable: true, selectionText: 'private', formControlType: 'input-password', mediaType: 'none', editFlags: { canPaste: true } }, { pageURL: 'https://example.com/' });
  assert.equal(items.some(item => ['search-selection', 'translate-selection', 'reading-selection', 'highlight-link'].includes(item.id)), false);
  assert.ok(items.some(item => item.id === 'paste' && item.enabled));
});
