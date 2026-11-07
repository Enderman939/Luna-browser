const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage } = require('../src/page-navigation');

function fixture(outcomes, options = {}) {
  const calls = [], failures = [];
  const flags = { current: true, stopped: false, committed: false };
  const web = { getURL: () => options.document || '', loadURL: async url => {
    calls.push(url); const outcome = outcomes.shift();
    if (typeof outcome === 'function') return outcome(flags);
    if (outcome) throw outcome;
  } };
  return { calls, failures, flags, run: settings => loadPage({ web, url: 'https://restore.example/page', restoring: true, ready: Promise.resolve(), current: () => flags.current, stopped: () => flags.stopped, committed: () => flags.committed, failed: error => failures.push(error), ...settings }) };
}
const cancelled = () => Object.assign(new Error('ERR_ABORTED'), { code: 'ERR_ABORTED', errno: -3 });

test('restored document is loaded once when navigation succeeds', async () => {
  const f = fixture([]); await f.run(); assert.equal(f.calls.length, 1); assert.deepEqual(f.failures, []);
});
test('uncommitted startup cancellation retries once and then succeeds', async () => {
  const f = fixture([cancelled()]); await f.run(); assert.equal(f.calls.length, 2); assert.deepEqual(f.failures, []);
});
test('second startup cancellation becomes a visible failure instead of an endless retry', async () => {
  const f = fixture([cancelled(), cancelled(), cancelled()]); await f.run(); assert.equal(f.calls.length, 2); assert.equal(f.failures.length, 1);
});
test('network failure is reported without automatic page replay', async () => {
  const error = Object.assign(new Error('ERR_CONNECTION_REFUSED'), { errno: -102 });
  const f = fixture([error]); await f.run(); assert.equal(f.calls.length, 1); assert.deepEqual(f.failures, [error]);
});
test('user stop and newer navigation cancel recovery without overwriting their state', async () => {
  for (const key of ['stopped', 'current']) {
    const f = fixture([flags => { flags[key] = key === 'stopped'; throw cancelled(); }]);
    await f.run(); assert.equal(f.calls.length, 1); assert.deepEqual(f.failures, []);
  }
});
test('committed documents and normal browsing are not retried on cancellation', async () => {
  const committed = fixture([cancelled()], { document: 'https://restore.example/page' });
  await committed.run(); assert.equal(committed.calls.length, 1); assert.equal(committed.failures.length, 1);
  const normal = fixture([cancelled()]); await normal.run({ restoring: false });
  assert.equal(normal.calls.length, 1); assert.equal(normal.failures.length, 1);
});
test('readiness failures surface without starting a page navigation', async () => {
  const error = new Error('initialization failed'), f = fixture([]);
  await f.run({ ready: Promise.reject(error) }); assert.equal(f.calls.length, 0); assert.deepEqual(f.failures, [error]);
});
