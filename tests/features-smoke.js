const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { createExtension, createCrx } = require('./extension-fixture');
const { closeApp, acceptPrompt } = require('./app-helpers');
const { popupPage } = require('./popover-helpers');

const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-features-'));
const artifacts = path.join(root, 'artifacts'); fs.mkdirSync(artifacts, { recursive: true });
const icon = fs.readFileSync(path.join(root, 'src', 'ui', 'assets', 'app.png'));
const payload = crypto.randomBytes(16 * 1024 * 1024);
let application, currentPage, diagnostics, activeRanges = 0, maxRanges = 0;
const errors = [], requests = [];
const server = http.createServer((request, response) => {
  if (request.url === '/favicon.png') { response.writeHead(200, { 'Content-Type': 'image/png' }); response.end(icon); return; }
  if (['/large.exe', '/single.exe', '/post.exe'].includes(request.url)) {
    if (request.url === '/large.exe' && !request.headers.cookie?.includes('luna_session=fixture')) { response.writeHead(401); response.end('Cookie required'); return; }
    const fullSize = request.url === '/single.exe' ? 1024 * 1024 : payload.length;
    const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range || '');
    let start = 0, end = fullSize - 1;
    const segmented = range && request.url !== '/single.exe';
    if (segmented) { start = Number(range[1]); end = Number(range[2]); }
    requests.push({ path: request.url, method: request.method, start, end, range: request.headers.range });
    const headers = { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="LunaTest.exe"', 'Content-Length': end - start + 1, ETag: '"luna-fixture"', 'Accept-Ranges': 'bytes' };
    if (segmented) headers['Content-Range'] = `bytes ${start}-${end}/${fullSize}`;
    response.writeHead(segmented ? 206 : 200, headers);
    if (segmented && end === 0) { response.end(payload.subarray(0, 1)); return; }
    if (segmented) { activeRanges++; maxRanges = Math.max(maxRanges, activeRanges); }
    let offset = start;
    const timer = setInterval(() => { const next = Math.min(offset + 32 * 1024, end + 1); response.write(payload.subarray(offset, next)); offset = next; if (offset > end) response.end(); }, request.url === '/single.exe' ? 2 : 25);
    response.on('close', () => { clearInterval(timer); if (segmented) activeRanges--; }); return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': 'luna_session=fixture; Path=/; SameSite=Lax' });
  response.end('<!doctype html><html><head><title>' + (request.url === '/next' ? 'Extension Next Page' : 'Luna Feature Test') + '</title><link rel="icon" href="/favicon.png" type="image/png"></head><body><h1>Browser integration fixture</h1><a id="download" href="/large.exe">Download application</a><a id="single" href="/single.exe">Download single connection</a><form method="post" action="/post.exe"><button id="post" type="submit">POST download</button></form></body></html>');
});
async function waitFor(predicate, label, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  if (diagnostics) console.error('State:', JSON.stringify(await diagnostics()));
  throw new Error('Timed out: ' + label);
}
async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port, downloadDirectory = path.join(profile, 'files');
  const env = { ...process.env, LUNA_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const options = { executablePath: process.env.LUNA_EXECUTABLE || require('electron'), args: process.env.LUNA_EXECUTABLE ? ['--disable-gpu'] : [root, '--disable-gpu'], env, timeout: 30000 };
  async function launch() {
    application = await electron.launch(options); currentPage = await application.firstWindow(); currentPage.on('pageerror', error => errors.push(error.message));
    await currentPage.waitForSelector('.tab.selected');
    diagnostics = () => currentPage.evaluate(() => window.browser.command('state'));
  }
  const command = (action, payload) => currentPage.evaluate(({ action, payload }) => window.browser.command(action, payload), { action, payload });
  const state = () => diagnostics();
  const remote = code => application.evaluate(({ webContents }, { base, code }) => webContents.getAllWebContents().find(web => web.getURL().startsWith(base)).executeJavaScript(code, true), { base, code });
  const screenshot = async name => { await currentPage.waitForTimeout(300); await currentPage.screenshot({ path: path.join(artifacts, name) }); };
  await launch();
  await application.evaluate(({ dialog }, downloadDirectory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [downloadDirectory] }); }, downloadDirectory);
  await command('choose-download-path'); await command('update-settings', { askDownload: false, theme: 'dark', downloadThreads: 8 });
  await command('navigate', base);
  await waitFor(async () => (await state()).tabs[0].title === 'Luna Feature Test' && (await state()).tabs[0].favicon.startsWith('data:image/'), 'real favicon');
  await waitFor(async () => await currentPage.locator('.tab-symbol img').count() === 1, 'favicon rendered');
  assert.ok(await currentPage.locator('.tab-symbol img').evaluate(image => image.complete && image.naturalWidth > 0));
  await screenshot('real-favicon.png');
  const mainTab = (await state()).activeId;
  await remote('document.getElementById("download").click()');
  await waitFor(async () => (await state()).downloads.some(job => job.managed && job.threads.length === 8 && job.received > 256 * 1024), 'eight-thread browser download');
  const id = (await state()).downloads.find(job => job.managed).id;
  await currentPage.locator('#downloads-button').click(); let panel = await popupPage(application, 'downloads'); await panel.waitForSelector('#panel[data-kind="downloads"]:not([hidden])');
  assert.equal(await panel.locator('.panel-tabs,[data-panel]').count(), 0);
  await panel.locator(`[data-id="${id}"] .download-details > summary`).click();
  assert.equal(await panel.locator(`[data-id="${id}"] .thread-table tbody tr`).count(), 8);
  await panel.screenshot({ path: path.join(artifacts, 'download-details.png') });
  await command('download-action', { id, action: 'pause' });
  const paused = (await state()).downloads.find(job => job.id === id); assert.equal(paused.status, 'paused'); assert.ok(paused.received > 0 && paused.received < payload.length);
  await new Promise(resolve => setTimeout(resolve, 100)); assert.equal((await state()).downloads.find(job => job.id === id).received, paused.received);
  await panel.locator(`[data-id="${id}"] .download-options > summary`).click();
  await panel.locator(`[data-id="${id}"] input[aria-label="下载限速 KB/s"]`).fill('128');
  await panel.locator(`[data-id="${id}"] input[aria-label="下载限速 KB/s"]`).press('Tab');
  await waitFor(async () => (await state()).downloads.find(job => job.id === id).speedLimit === 128, 'per-download speed setting');
  await command('download-action', { id, action: 'resume' }); await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await state()).downloads.find(job => job.id === id).speedLimit, 128);
  await command('download-action', { id, action: 'speed-limit', value: 0 });
  await waitFor(async () => (await state()).downloads.find(job => job.id === id).status === 'completed', 'segmented download completion');
  assert.deepEqual(fs.readFileSync(path.join(downloadDirectory, 'LunaTest.exe')), payload); assert.ok(maxRanges >= 4);
  await waitFor(async () => (await state()).downloads.find(job => job.id === id).icon.startsWith('data:image/'), 'downloaded file icon');
  assert.equal(await panel.locator(`[data-id="${id}"] .file-preview img`).count(), 1);
  await panel.screenshot({ path: path.join(artifacts, 'download-file-icon.png') });
  await panel.locator('#panel-close').click();
  await currentPage.locator('#history-button').click(); panel = await popupPage(application, 'history'); assert.equal(await panel.locator('#panel').getAttribute('data-kind'), 'history');
  assert.equal(await panel.locator('.download-tools').isHidden(), true); assert.equal(await panel.locator('.panel-tabs').count(), 0);
  await panel.locator('#panel-close').click();
  await remote('document.getElementById("single").click()');
  await waitFor(async () => (await state()).downloads.some(job => job.url.endsWith('/single.exe') && job.status === 'completed'), 'single connection fallback');
  const single = (await state()).downloads.find(job => job.url.endsWith('/single.exe')); assert.equal(single.mode, 'single'); assert.equal(single.threads.length, 1);
  await remote('document.getElementById("post").click()');
  await waitFor(async () => (await state()).downloads.some(job => job.url.endsWith('/post.exe') && !job.managed), 'POST download stays native');
  await command('download-action', { id: (await state()).downloads.find(job => job.url.endsWith('/post.exe')).id, action: 'cancel' });

  const extensionDirectory = path.join(profile, 'fixture-extension'); createExtension(extensionDirectory, icon);
  await application.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  }, extensionDirectory);
  await command('extensions'); await currentPage.waitForSelector('#extensions-page:not([hidden])');
  const extensionsTab = (await state()).activeId;
  await currentPage.locator('#extension-load-directory').click();
  await acceptPrompt(currentPage, 'permissions');
  await waitFor(async () => (await state()).extensions.some(extension => extension.enabled), 'unpacked extension loaded');
  const extension = (await state()).extensions[0]; assert.equal(extension.name, 'Luna Test Extension');
  await screenshot('extensions.png');
  await command('activate', mainTab); await command('reload');
  await waitFor(async () => await remote('document.documentElement.dataset.lunaExtension') === extension.id, 'extension content script runs');
  await currentPage.locator('#extensions-button').click();
  const extensionMenu = await popupPage(application, 'extensions'); await extensionMenu.waitForSelector('#extensions-menu:not([hidden])');
  await extensionMenu.locator(`.extensions-menu-row[data-id="${extension.id}"] .extension-pin`).click();
  await waitFor(async () => (await state()).extensions.find(value => value.id === extension.id).pinned, 'extension pinned');
  await currentPage.locator('#extensions-button').click();
  await waitFor(async () => await currentPage.locator('#extension-actions button').count() >= 1, 'extension action toolbar');
  await currentPage.locator('#extension-actions button').first().click();
  let popup;
  await waitFor(async () => {
    popup = await application.evaluate(({ webContents }, id) => webContents.getAllWebContents().find(web => web.getURL() === 'chrome-extension://' + id + '/popup.html')?.id, extension.id);
    return !!popup;
  }, 'extension action popup');
  const popupEval = code => application.evaluate(({ webContents }, { id, code }) => webContents.fromId(id).executeJavaScript(code, true), { id: popup, code });
  await waitFor(async () => await popupEval('document.getElementById("result").textContent') === 'Luna Feature Test', 'chrome.tabs.query in popup');
  assert.equal(await popupEval('typeof window.browser?.command'), 'undefined', 'extensions cannot access the local browser bridge');
  const stored = await popupEval('chrome.storage.local.get(["contentWorks", "backgroundWorks"])'); assert.equal(stored.contentWorks, true);
  const worker = await popupEval('chrome.runtime.sendMessage({kind:"luna-test"})');
  assert.equal(worker.backgroundWorks, true); assert.ok(worker.count >= 2, 'MV3 background service worker can query browser tabs');
  await waitFor(async () => application.evaluate(({ BrowserWindow, webContents }, id) => {
    const window = BrowserWindow.fromWebContents(webContents.fromId(id));
    const [width, height] = window.getContentSize(); return width >= 250 && height >= 150 && window.isVisible();
  }, popup), 'extension popup is visible at its preferred size');
  const popupImage = await application.evaluate(async ({ webContents }, id) => (await webContents.fromId(id).capturePage()).toPNG().toString('base64'), popup);
  fs.writeFileSync(path.join(artifacts, 'extension-popup.png'), Buffer.from(popupImage, 'base64'));
  const created = await popupEval('chrome.tabs.create({ url: ' + JSON.stringify(base + '/next') + ', active: false })');
  await waitFor(async () => (await state()).tabs.some(tab => tab.webContentsId === created.id && tab.title === 'Extension Next Page'), 'chrome.tabs.create');
  await popupEval('chrome.tabs.remove(' + created.id + ')');
  assert.equal((await state()).tabs.length, 2, 'chrome.tabs.remove updates browser tabs');
  // Close the popup through the actual toolbar toggle before changing tabs.
  await currentPage.locator('#address').click();
  await command('extensions');
  await command('extension-enable', { id: extension.id, enabled: false });
  assert.equal((await state()).extensions.find(value => value.id === extension.id).enabled, false);
  await command('activate', mainTab); await command('reload');
  await waitFor(async () => (await state()).tabs.find(tab => tab.id === mainTab).loading === false, 'page reload without extension');
  assert.equal(await remote('document.documentElement.dataset.lunaExtension'), undefined);
  await command('extension-enable', { id: extension.id, enabled: true }); await command('reload');
  await waitFor(async () => await remote('document.documentElement.dataset.lunaExtension') === extension.id, 'extension re-enabled');
  await command('extension-options', extension.id);
  await waitFor(async () => (await state()).tabs.some(tab => tab.title === 'Extension Options'), 'extension options page');
  await command('close-tab', (await state()).activeId);
  await command('extensions');
  assert.equal((await state()).activeId, extensionsTab, 'extension manager tab is reused');
  const packageFile = path.join(profile, 'fixture.crx'); fs.writeFileSync(packageFile, createCrx(3));
  await application.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, packageFile);
  await currentPage.locator('#extension-install-package').click();
  await acceptPrompt(currentPage, 'permissions');
  await waitFor(async () => (await state()).extensions.length === 2, 'signed CRX3 installed');
  const packagedExtension = (await state()).extensions.find(value => value.source === 'package');
  assert.ok(packagedExtension.enabled);
  const removing = command('extension-remove', packagedExtension.id); await acceptPrompt(currentPage, 'remove-extension'); await removing;
  await waitFor(async () => (await state()).extensions.length === 1, 'extension removed');
  assert.equal(fs.existsSync(extensionDirectory), true, 'developer source directory is preserved');

  // Leave a partially downloaded job and verify process restart preserves it.
  await command('activate', mainTab); await command('navigate', base);
  await waitFor(async () => (await state()).tabs.find(tab => tab.id === mainTab).title === 'Luna Feature Test', 'restart test page');
  await remote('document.getElementById("download").click()');
  await waitFor(async () => (await state()).downloads.some(job => job.managed && job.status === 'progressing' && job.received > 128 * 1024), 'partial download before restart');
  const partial = (await state()).downloads.find(job => job.managed && job.status === 'progressing');
  await closeApp(application, currentPage); application = null;
  await launch();
  await waitFor(async () => (await state()).extensions.length === 1 && (await state()).extensions[0].enabled, 'extension restore');
  const restored = (await state()).downloads.find(job => job.id === partial.id); assert.equal(restored.status, 'paused'); assert.ok(restored.received > 0);
  await command('download-action', { id: restored.id, action: 'resume' });
  await waitFor(async () => (await state()).downloads.find(job => job.id === restored.id).status === 'completed', 'download resume after restart');
  const record = JSON.parse(fs.readFileSync(path.join(profile, 'download-jobs.json'), 'utf8')).find(job => job.id === restored.id);
  assert.deepEqual(fs.readFileSync(record.file), payload);
  assert.deepEqual(errors, []);
  await closeApp(application, currentPage); application = null;
  fs.writeFileSync(path.join(artifacts, 'features-result.json'), JSON.stringify({ passed: true, maxParallelConnections: maxRanges, checks: ['independent panels', 'real favicon', 'parallel transfers', 'pause/resume', 'speed limit', 'file icon', 'single-connection fallback', 'POST preservation', 'unpacked extension', 'content scripts', 'storage', 'action popup', 'tabs query/create/remove', 'enable/disable', 'options page', 'signed CRX3', 'extension restore', 'download restart recovery'], testedAt: new Date().toISOString() }, null, 2));
  console.log('PASS: independent panels, real favicon, concurrent Range downloads (' + maxRanges + ' peak connections), pause/resume, speed limits, file icons, single-connection fallback, POST preservation, Chrome MV3 content scripts, storage, toolbar popup, tabs API, extension enable/disable/options/CRX installation, extension persistence, download recovery after restart.');
}
run().catch(async error => { console.error(error); if (currentPage) await currentPage.screenshot({ path: path.join(artifacts, 'features-failure.png') }).catch(() => {}); process.exitCode = 1; }).finally(async () => {
  if (application) await application.close().catch(() => {});
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(profile, { recursive: true, force: true });
});
