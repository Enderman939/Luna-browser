const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const AdmZip = require('adm-zip');
const { AppUpdates, newerVersion, selectRelease, LATEST } = require('../src/app-updates');
const { validateArchive, windowsScript, macScript } = require('../src/update-installer');
const { notifyDownload } = require('../src/download-notifications');
const bytes = Buffer.from('Synthetic update package for controlled download tests');
const digest = createHash('sha256').update(bytes).digest('hex');
function fixture(platform = 'win32', arch = 'x64', version = '1.2.0') {
  const name = `luna-${version}-${platform}-${arch}.zip`;
  return { tag_name: 'v' + version, draft: false, prerelease: false, assets: [{ name, state: 'uploaded', size: bytes.length, digest: 'sha256:' + digest,
    browser_download_url: `https://github.com/Enderman939/Luna-browser/releases/download/v${version}/${name}` }] };
}
function service(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-update-unit-')), calls = [];
  const update = new AppUpdates({ directory, version: '1.1.0', platform: 'win32', arch: 'x64', supported: true,
    fetch: async (url, options) => { calls.push({ url, options }); return url === LATEST ? Response.json(fixture()) : new Response(bytes); }, prepareInstall: async () => ({}), ...overrides });
  t.after(async () => { update.dispose(); if (update.pending) await update.pending; fs.rmSync(directory, { recursive: true, force: true }); });
  return { update, calls, directory };
}
test('stable update selection compares numeric versions, excludes previews and matches OS, architecture and repository', () => {
  assert.equal(newerVersion('1.10.0', '1.9.9'), true); assert.equal(newerVersion('1.1.0', '1.1.0-beta.1'), true);
  for (const version of ['1.0.9', '1.1.0', '1.2.0-beta.1', '../bad', '01.2.0']) assert.equal(newerVersion(version, '1.1.0'), false);
  assert.equal(selectRelease({ ...fixture(), prerelease: true }, '1.1.0', 'win32', 'x64'), null);
  assert.equal(selectRelease({ ...fixture(), draft: true }, '1.1.0', 'win32', 'x64'), null);
  assert.equal(selectRelease(fixture(), '1.2.0', 'win32', 'x64'), null);
  assert.throws(() => selectRelease(fixture(), '1.1.0', 'darwin', 'arm64'), /本机/);
  assert.equal(selectRelease(fixture('darwin', 'arm64'), '1.1.0', 'darwin', 'arm64').version, '1.2.0');
  for (const url of ['https://evil.example/package.zip', 'http://github.com/file.zip', 'https://github.com/other/repo/releases/download/v1.2.0/test.zip']) {
    const release = fixture(); release.assets[0].browser_download_url = url;
    assert.throws(() => selectRelease(release, '1.1.0', 'win32', 'x64'), /无效/);
  }
});
test('automatic check downloads, reports progress, verifies hash and reuses the cache after restart', async t => {
  const { update, calls, directory } = service(t); const phases = [];
  update.on('change', state => phases.push(state.phase)); update.configure(true);
  await update.check();
  assert.equal(update.snapshot().phase, 'ready'); assert.equal(update.snapshot().received, bytes.length);
  assert.deepEqual(fs.readFileSync(update.readyFile), bytes);
  for (const phase of ['checking', 'downloading', 'verifying', 'ready']) assert.ok(phases.includes(phase));
  assert.ok(calls.every(call => call.options.credentials === 'omit'));
  update.dispose();
  const next = new AppUpdates({ directory, version: '1.1.0', platform: 'win32', arch: 'x64', supported: true,
    fetch: async url => { assert.equal(url, LATEST, 'verified cached package avoids downloading it again'); return Response.json(fixture()); } });
  t.after(() => next.dispose()); next.configure(true); await next.check(); assert.equal(next.snapshot().phase, 'ready');
});
test('disabling automatic updates permits manual checks and download without background requests', async t => {
  const { update, calls } = service(t); update.configure(false); assert.equal(calls.length, 0);
  await update.check(); assert.equal(update.snapshot().phase, 'available'); assert.equal(calls.length, 1);
  await update.download(); assert.equal(update.snapshot().phase, 'ready'); assert.equal(calls.length, 2);
  const unsupported = service(t, { supported: false }); unsupported.update.configure(true); await unsupported.update.check(); assert.equal(unsupported.calls.length, 0);
});
test('corrupt and truncated downloads are never installable and retry recovers', async t => {
  let bad = true, prepared = 0;
  const { update, directory } = service(t, { fetch: async url => url === LATEST ? Response.json(fixture()) : new Response(bad ? Buffer.alloc(bytes.length) : bytes),
    prepareInstall: async () => { prepared++; return {}; } });
  update.configure(true); await update.check();
  assert.equal(update.snapshot().phase, 'error'); assert.match(update.snapshot().error, /校验失败/);
  assert.deepEqual(fs.readdirSync(directory), []); await assert.rejects(update.prepare()); assert.equal(prepared, 0);
  bad = false; await update.download(); assert.equal(update.snapshot().phase, 'ready');
  fs.writeFileSync(update.readyFile, 'changed'); await assert.rejects(update.prepare(), /已变化/);
  assert.equal(update.snapshot().phase, 'error'); assert.equal(prepared, 0);
  await update.download(); await update.prepare(); assert.equal(prepared, 1);
});
test('release checksum file fallback, network failure, rate limits and concurrent checks are handled', async t => {
  const release = fixture(); delete release.assets[0].digest;
  assert.throws(() => selectRelease(release, '1.1.0', 'win32', 'x64'), /校验值/);
  release.assets.push({ name: 'SHA256SUMS.txt', state: 'uploaded', browser_download_url: 'https://github.com/Enderman939/Luna-browser/releases/download/v1.2.0/SHA256SUMS.txt' });
  let requests = 0;
  const { update } = service(t, { fetch: async url => { requests++; await new Promise(resolve => setTimeout(resolve, 5));
    return url === LATEST ? Response.json(release) : url.endsWith('.txt') ? new Response(digest + '  ' + release.assets[0].name + '\n') : new Response(bytes); } });
  update.configure(true); await Promise.all([update.check(), update.check()]); assert.equal(requests, 3); assert.equal(update.snapshot().phase, 'ready');
  for (const response of [new Response('', { status: 429 }), new Response(bytes.subarray(0, 10))]) {
    const broken = service(t, { fetch: async url => url === LATEST ? Response.json(fixture()) : response }).update;
    broken.configure(true); await broken.check(); assert.equal(broken.snapshot().phase, 'error'); assert.equal(broken.readyFile, null);
  }
  const offline = service(t, { fetch: async () => { throw new Error('offline'); } }).update;
  await offline.check(); assert.equal(offline.snapshot().phase, 'error'); assert.match(offline.snapshot().error, /offline/);
});
test('turning off automatic download cancels its in-flight request and removes partial files', async t => {
  let started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  const { update, directory } = service(t, { fetch: async (url, options) => {
    if (url === LATEST) return Response.json(fixture());
    return new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }); started(); });
  } });
  update.configure(true); const checking = update.check(true); await startedPromise; update.configure(false); await checking;
  assert.equal(update.snapshot().phase, 'error'); assert.deepEqual(fs.readdirSync(directory), []);
});
function windowsArchive() {
  const zip = new AdmZip();
  for (const file of ['luna.exe', 'resources/app.asar', 'icudtl.dat', 'resources.pak']) zip.addFile('luna-win32-x64/' + file, Buffer.from('fixture'));
  return zip;
}
test('installer rejects traversal, Windows links, alternate streams, duplicate paths and incomplete packages', () => {
  assert.equal(validateArchive(windowsArchive(), 'win32'), 'luna-win32-x64');
  for (const name of ['../outside', 'luna-win32-x64/../outside', 'luna-win32-x64/luna.exe:stream', 'luna-win32-x64/NUL.txt']) {
    const zip = windowsArchive(), entry = zip.getEntries()[0];
    // Override the name directly because archive libraries sanitize paths when adding them.
    Object.defineProperty(entry, 'entryName', { get: () => name });
    assert.throws(() => validateArchive(zip, 'win32'), /路径/);
  }
  const link = windowsArchive(); link.getEntries()[0].attr = (0xa1ff << 16) >>> 0; assert.throws(() => validateArchive(link, 'win32'), /链接/);
  const duplicate = windowsArchive(); duplicate.addFile('luna-win32-x64/LUNA.exe', Buffer.from('fixture')); assert.throws(() => validateArchive(duplicate, 'win32'), /重复/);
  const incomplete = windowsArchive(); incomplete.deleteFile('luna-win32-x64/luna.exe'); assert.throws(() => validateArchive(incomplete, 'win32'), /运行文件/);
});
test('Mac archives preserve internal framework links and ditto metadata while rejecting escaped links', () => {
  const zip = new AdmZip();
  for (const file of ['Contents/MacOS/luna', 'Contents/Resources/app.asar', 'Contents/Info.plist']) zip.addFile('luna.app/' + file, Buffer.from('fixture'));
  zip.addFile('__MACOSX/._luna.app', Buffer.from('metadata'));
  zip.addFile('luna.app/Contents/Frameworks/Example.framework/Versions/Current', Buffer.from('A'));
  const link = zip.getEntry('luna.app/Contents/Frameworks/Example.framework/Versions/Current'); link.attr = (0xa1ff << 16) >>> 0;
  assert.equal(validateArchive(zip, 'darwin'), 'luna.app');
  zip.updateFile(link, Buffer.from('../../../../../../outside')); assert.throws(() => validateArchive(zip, 'darwin'), /链接/);
});
test('Mac installer shell script parses with spaces, quotes and Unicode in paths', t => {
  const { execFileSync } = require('node:child_process');
  const shell = process.platform === 'darwin' ? '/bin/sh' : 'C:/Program Files/Git/bin/bash.exe';
  if (!fs.existsSync(shell)) { t.skip('POSIX shell is unavailable'); return; }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-mac-shell-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const script = path.join(directory, 'install.sh');
  fs.writeFileSync(script, macScript({ destination: "/Applications/Luna ' test.app", staged: '/Applications/.update/luna.app', backup: '/Applications/.backup', staging: '/Applications/.update', log: '/Users/test/更新日志', started: '/Users/test/ready', pid: 1234 }));
  execFileSync(shell, ['-n', script.replaceAll('\\', '/')], { timeout: 10000 });
});
test('download reminders obey settings, keep private filenames out of system notifications, and reveal on click', () => {
  const notices = [], system = [], reveals = [];
  class Notification extends EventEmitter { static isSupported() { return true; } constructor(options) { super(); this.options = options; } show() { system.push(this); } }
  const options = { enabled: true, browser: { notice: text => notices.push(text), window: { isFocused: () => false } }, name: 'file.zip', file: '/download/file.zip', Notification, reveal: file => reveals.push(file) };
  notifyDownload({ ...options, enabled: false }); assert.equal(notices.length, 0); assert.equal(system.length, 0);
  notifyDownload(options); assert.equal(notices.length, 1); assert.equal(system.length, 1); system[0].emit('click'); assert.deepEqual(reveals, [options.file]);
  notifyDownload({ ...options, isPrivate: true }); assert.equal(notices.length, 2); assert.equal(system.length, 1);
  notifyDownload({ ...options, browser: { ...options.browser, window: { isFocused: () => true } } }); assert.equal(system.length, 1);
  const cards = [];
  notifyDownload({ ...options, entry: { id: 'completed-download', name: options.name, file: options.file }, browser: { ...options.browser,
    downloadNotice: entry => cards.push(entry), downloadForeground: () => true } });
  assert.equal(cards[0].id, 'completed-download'); assert.equal(system.length, 1, 'a focused browser-owned window counts as foreground');
});
test('Windows installer replaces the application and restores it when launching the replacement fails', { skip: process.platform !== 'win32' }, t => {
  const { execFileSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "luna-update ' install-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  for (const invalid of [false, true]) {
    const directory = path.join(root, invalid ? 'rollback' : 'success'), destination = path.join(directory, 'installed app'), staging = path.join(directory, 'staging'), staged = path.join(staging, 'new app'), backup = path.join(directory, 'backup');
    fs.mkdirSync(destination, { recursive: true }); fs.mkdirSync(staged, { recursive: true });
    fs.copyFileSync(path.join(process.env.SystemRoot, 'System32/where.exe'), path.join(destination, 'luna.exe'));
    fs.writeFileSync(path.join(destination, 'old-marker'), 'old'); fs.writeFileSync(path.join(staged, 'new-marker'), 'new');
    if (invalid) fs.writeFileSync(path.join(staged, 'luna.exe'), 'not an executable');
    else fs.copyFileSync(path.join(process.env.SystemRoot, 'System32/where.exe'), path.join(staged, 'luna.exe'));
    const log = path.join(directory, 'result.log'), script = path.join(directory, 'install.ps1');
    fs.writeFileSync(script, '\ufeff' + windowsScript({ destination, staged, backup, staging, pid: 99999999, log }));
    execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { timeout: 15000, stdio: 'pipe' });
    assert.equal(fs.existsSync(staging), false);
    if (invalid) { assert.equal(fs.readFileSync(path.join(destination, 'old-marker'), 'utf8'), 'old'); assert.equal(fs.existsSync(path.join(destination, 'new-marker')), false); }
    else { assert.equal(fs.readFileSync(path.join(destination, 'new-marker'), 'utf8'), 'new'); assert.equal(fs.readFileSync(path.join(backup, 'old-marker'), 'utf8'), 'old'); assert.match(fs.readFileSync(log, 'utf8'), /Updated successfully/); }
  }
});
