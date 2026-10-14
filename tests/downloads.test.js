const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { DownloadManager, splitRanges, contentRange } = require('../src/downloads');

async function waitFor(predicate, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('Download did not reach expected state');
}
async function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-download-test-'));
  const data = crypto.randomBytes(options.size || 4 * 1024 * 1024);
  const requests = [], behavior = { interrupt: false, version: 'one' };
  const server = http.createServer((request, response) => {
    let start = 0, end = data.length - 1;
    const requested = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range || '');
    const ranged = request.url !== '/single' && requested;
    if (ranged) { start = Number(requested[1]); end = Number(requested[2]); }
    requests.push({ range: request.headers.range, start, end, ifRange: request.headers['if-range'] });
    const headers = { 'Content-Length': end - start + 1, ETag: '"' + behavior.version + '"' };
    if (ranged) headers['Content-Range'] = `bytes ${start}-${request.url === '/bad' && end > 0 ? end - 1 : end}/${data.length}`;
    response.writeHead(ranged ? 206 : 200, headers);
    if (end === 0) { response.end(data.subarray(0, 1)); return; }
    let offset = start;
    const timer = setInterval(() => {
      if (behavior.interrupt && offset - start >= 32 * 1024) { response.destroy(); return; }
      const next = Math.min(offset + 16 * 1024, end + 1);
      response.write(data.subarray(offset, next)); offset = next;
      if (offset > end) response.end();
    }, options.delay || 8);
    response.on('close', () => clearInterval(timer));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const managers = [];
  const manager = () => { const value = new DownloadManager({ directory, fetch }); managers.push(value); return value; };
  t.after(async () => {
    await Promise.all(managers.map(value => value.shutdown()));
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, data, requests, behavior, base, manager };
}
test('segments cover a file exactly, and malformed ranges are rejected', () => {
  const ranges = splitRanges(101, 8);
  assert.equal(ranges[0].start, 0); assert.equal(ranges.at(-1).end, 100);
  assert.equal(ranges.reduce((total, range) => total + range.end - range.start + 1, 0), 101);
  ranges.slice(1).forEach((range, index) => assert.equal(range.start, ranges[index].end + 1));
  assert.deepEqual(contentRange('bytes 0-0/123'), { start: 0, end: 0, total: 123 });
  for (const input of ['bytes 0-123/123', 'bytes 10-5/100', 'bytes 0-0/*', 'bad']) assert.equal(contentRange(input), null);
});
test('removing a live transfer cancels its requests, drops checkpoints and leaves no file or resurrected job', async t => {
  const f = await fixture(t), manager = f.manager(), file = path.join(f.directory, 'removed.bin');
  const id = manager.create({ url: f.base + '/ranged', file, threads: 2 });
  await waitFor(() => manager.jobs.get(id).received > 32768); await manager.remove(id);
  assert.equal(manager.jobs.has(id), false); assert.equal(fs.existsSync(file), false); assert.equal(fs.existsSync(path.join(f.directory, 'download-parts', id)), false);
  assert.equal(JSON.parse(fs.readFileSync(manager.file)).some(entry => entry.id === id), false);
});
test('parallel downloads preserve every byte with multiple real connections', async t => {
  const f = await fixture(t), manager = f.manager(), file = path.join(f.directory, 'output.bin');
  const id = manager.create({ url: f.base + '/ranged', file, threads: 8 });
  await waitFor(() => manager.jobs.get(id).status === 'completed');
  assert.deepEqual(fs.readFileSync(file), f.data);
  assert.equal(manager.jobs.get(id).threads.length, 8);
  assert.equal(f.requests.filter(request => request.end > 0).length, 8);
  assert.ok(f.requests.filter(request => request.end > 0).every(request => request.ifRange === '"one"'));
});
test('Windows managed downloads retain an Internet-zone origin marker', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t, { size: 64 * 1024 }), manager = f.manager(), file = path.join(f.directory, 'downloaded.exe');
  const id = manager.create({ url: f.base + '/ranged?token=private', file, threads: 2 });
  await waitFor(() => manager.jobs.get(id).status === 'completed');
  const marker = fs.readFileSync(file + ':Zone.Identifier', 'utf8');
  assert.match(marker, /ZoneId=3/); assert.ok(marker.includes(f.base + '/ranged'));
  assert.equal(marker.includes('token=private'), false, 'origin markers do not persist signed URL query tokens');
});
test('pause retains partial bytes and resume requests only remaining ranges', async t => {
  const f = await fixture(t), manager = f.manager(), file = path.join(f.directory, 'resume.bin');
  const id = manager.create({ url: f.base + '/ranged', file, threads: 4 });
  await waitFor(() => manager.jobs.get(id).received >= 64 * 1024);
  await manager.action(id, 'pause');
  const received = manager.jobs.get(id).received;
  assert.ok(received > 0 && received < f.data.length);
  await new Promise(resolve => setTimeout(resolve, 70)); assert.equal(manager.jobs.get(id).received, received);
  const before = f.requests.length;
  await manager.action(id, 'resume'); await waitFor(() => manager.jobs.get(id).status === 'completed');
  assert.deepEqual(fs.readFileSync(file), f.data);
  assert.ok(f.requests.slice(before).some(request => request.start > 0 && request.start % (f.data.length / 4) !== 0));
});
test('saved checkpoints restore partial data after application restart', async t => {
  const f = await fixture(t), first = f.manager(), file = path.join(f.directory, 'restart.bin');
  const id = first.create({ url: f.base + '/ranged', file, threads: 4 });
  await waitFor(() => first.jobs.get(id).received >= 64 * 1024); await first.shutdown();
  const second = f.manager(); assert.equal(second.jobs.get(id).status, 'paused'); assert.ok(second.jobs.get(id).received > 0);
  await second.action(id, 'resume'); await waitFor(() => second.jobs.get(id).status === 'completed');
  assert.deepEqual(fs.readFileSync(file), f.data);
});
test('servers without Range support safely use a single connection', async t => {
  const f = await fixture(t, { size: 256 * 1024 }), manager = f.manager(), file = path.join(f.directory, 'single.bin');
  const id = manager.create({ url: f.base + '/single', file, threads: 8 });
  await waitFor(() => manager.jobs.get(id).status === 'completed');
  assert.equal(manager.jobs.get(id).mode, 'single'); assert.equal(manager.jobs.get(id).threads.length, 1);
  assert.deepEqual(fs.readFileSync(file), f.data); assert.equal(f.requests.length, 1);
});
test('bad range responses never produce a completed corrupt file', async t => {
  const f = await fixture(t), manager = f.manager(), file = path.join(f.directory, 'invalid.bin');
  const id = manager.create({ url: f.base + '/bad', file, threads: 4 });
  await waitFor(() => manager.jobs.get(id).status === 'interrupted');
  assert.equal(fs.existsSync(file), false); assert.match(manager.jobs.get(id).error, /分段响应/);
});
test('network interruption resumes without losing or duplicating bytes', async t => {
  const f = await fixture(t), manager = f.manager(), file = path.join(f.directory, 'retry.bin'); f.behavior.interrupt = true;
  const id = manager.create({ url: f.base + '/ranged', file, threads: 4 });
  await waitFor(() => manager.jobs.get(id).status === 'interrupted');
  assert.ok(manager.jobs.get(id).received > 0);
  f.behavior.interrupt = false;
  await manager.action(id, 'resume'); await waitFor(() => manager.jobs.get(id).status === 'completed');
  assert.deepEqual(fs.readFileSync(file), f.data);
});
test('changed file validators force a complete restart of the cached segments', async t => {
  const f = await fixture(t), manager = f.manager(), file = path.join(f.directory, 'changed.bin');
  const id = manager.create({ url: f.base + '/ranged', file, threads: 4 });
  await waitFor(() => manager.jobs.get(id).received > 0); await manager.action(id, 'pause');
  f.behavior.version = 'two'; const before = f.requests.length;
  await manager.action(id, 'resume'); await waitFor(() => manager.jobs.get(id).status === 'completed');
  assert.deepEqual(fs.readFileSync(file), f.data);
  const requests = f.requests.slice(before).filter(request => request.end > 0);
  assert.equal(requests.length, 4); assert.ok(requests.every(request => request.start % (f.data.length / 4) === 0));
});
test('cancel removes cached segments and prevents a final file', async t => {
  const f = await fixture(t), manager = f.manager(), file = path.join(f.directory, 'cancel.bin');
  const id = manager.create({ url: f.base + '/ranged', file, threads: 4 });
  await waitFor(() => manager.jobs.get(id).received > 0); await manager.action(id, 'cancel');
  assert.equal(manager.jobs.get(id).status, 'cancelled'); assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(manager.partDirectory(manager.jobs.get(id))), false);
});
