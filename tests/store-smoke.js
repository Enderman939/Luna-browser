const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCrx } = require('./extension-fixture');
const { unpackContainer } = require('../src/extension-package');
const { extensionIdFromKey } = require('../src/webstore-download');
const { closeApp } = require('./app-helpers');
const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-store-test-'));
const buffer = createCrx(3), id = extensionIdFromKey(unpackContainer(buffer).key);
const edgeBuffer = createCrx(3), edgeId = extensionIdFromKey(unpackContainer(edgeBuffer).key);
let application, page;
const waitFor = async (fn, label) => { const start = Date.now(); while (Date.now() - start < 15000) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error('Timed out: ' + label); };
(async () => {
  const env = { ...process.env, LUNA_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ executablePath: process.env.LUNA_EXECUTABLE || require('electron'), args: process.env.LUNA_EXECUTABLE ? ['--disable-gpu'] : [root, '--disable-gpu'], env });
  page = await application.firstWindow(); await page.waitForSelector('.tab.selected');
  const command = (action, payload) => page.evaluate(({ action, payload }) => window.browser.command(action, payload), { action, payload });
  const state = () => command('state');
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await application.evaluate(({ session }, { payload, edgePayload, id }) => {
    globalThis.storeTestFail = true;
    const browser = session.fromPartition('persist:luma-web');
    browser.protocol.handle('https', request => {
      const url = new URL(request.url);
      if (url.hostname === 'chromewebstore.google.com') return new Response('<!doctype html><title>Store fixture</title><h1>Chrome store integration</h1>', { headers: { 'Content-Type': 'text/html' } });
      if (url.hostname === 'microsoftedge.microsoft.com') return new Response('<!doctype html><title>Edge store fixture</title><h1>Edge store integration</h1>', { headers: { 'Content-Type': 'text/html' } });
      if (url.hostname === 'edge.microsoft.com') return new Response(Buffer.from(edgePayload, 'base64'), { headers: { 'Content-Type': 'application/x-chrome-extension' } });
      if (url.hostname === 'update.googleapis.com' || url.hostname === 'clients2.google.com') {
        if (globalThis.storeTestFail) return new Response('Temporary upstream failure', { status: 503 });
        return Response.redirect('https://clients2.googleusercontent.com/test.crx', 302);
      }
      if (url.hostname === 'clients2.googleusercontent.com') return new Response(Buffer.from(payload, 'base64'), { headers: { 'Content-Type': 'application/x-chrome-extension', 'Content-Length': String(Buffer.from(payload, 'base64').length) } });
      return new Response('', { status: 404 });
    });
  }, { payload: buffer.toString('base64'), edgePayload: edgeBuffer.toString('base64'), id });
  await command('navigate', 'https://chromewebstore.google.com/detail/test/' + id);
  await waitFor(async () => application.evaluate(({ webContents }) => webContents.getAllWebContents().some(web => web.getURL().startsWith('https://chromewebstore.google.com') && web.getTitle() === 'Store fixture')), 'store page');
  const remote = code => application.evaluate(({ webContents }, code) => webContents.getAllWebContents().find(web => web.getURL().startsWith('https://chromewebstore.google.com')).executeJavaScript(code, true), code);
  await waitFor(async () => await remote('typeof chrome.webstorePrivate?.beginInstallWithManifest3') === 'function', 'store API installed');
  const details = JSON.stringify({ id, manifest: '{}', localizedName: 'Store test', iconUrl: 'https://invalid.example/never-needed.png' });
  const failed = await remote('new Promise(resolve => chrome.webstorePrivate.beginInstallWithManifest3(' + details + ', code => resolve({code, message: chrome.extension.lastError?.message, runtime: chrome.runtime.lastError?.message})))');
  assert.equal(failed.code, 'install_error'); assert.match(failed.message, /HTTP 503/); assert.equal(failed.runtime, failed.message); assert.equal(failed.message.includes('undefined'), false);
  assert.equal((await state()).extensions.length, 0);
  await application.evaluate(() => { globalThis.storeTestFail = false; });
  const installing = remote('chrome.webstorePrivate.beginInstallWithManifest3(' + details + ')');
  await page.waitForSelector('#confirmation-dialog[open]');
  assert.equal(await page.locator('#confirmation-dialog').getAttribute('data-kind'), 'permissions');
  await page.locator('#confirmation-accept').click(); assert.equal(await installing, 'success');
  await waitFor(async () => (await state()).extensions.some(extension => extension.id === id && extension.enabled), 'signed store extension installed');
  assert.equal((await state()).extensions[0].source, 'webstore');
  assert.equal(await remote('chrome.extension.lastError'), null);
  assert.equal(await remote('chrome.webstorePrivate.getExtensionStatus(' + JSON.stringify(id) + ', "{}")'), 'enabled');
  assert.equal(await remote('chrome.webstorePrivate.completeInstall(' + JSON.stringify(id) + ')'), 'success');
  await command('extensions');
  await waitFor(async () => await page.locator('.extension-card').count() === 1, 'management card');
  await page.screenshot({ path: path.join(root, 'artifacts', 'store-install-success.png') });
  // The direct input path uses the same installer and reuses an installed extension.
  await command('extension-install-store', id); assert.equal((await state()).extensions.length, 1);
  await command('new-tab', 'https://microsoftedge.microsoft.com/addons/detail/test/' + edgeId);
  const edgeRemote = code => application.evaluate(({ webContents }, code) => webContents.getAllWebContents().find(web => web.getURL().startsWith('https://microsoftedge.microsoft.com')).executeJavaScript(code, true), code);
  await waitFor(async () => { try { return await edgeRemote('!!document.querySelector("#luna-edge-panel button")'); } catch { return false; } }, 'Edge installation button');
  await edgeRemote('document.querySelector("#luna-edge-panel button").click()');
  await page.waitForSelector('#confirmation-dialog[open]'); await page.locator('#confirmation-accept').click();
  await waitFor(async () => (await state()).extensions.some(extension => extension.id === edgeId && extension.market === 'edge'), 'Edge extension installed');
  await waitFor(async () => await edgeRemote('document.querySelector("#luna-edge-panel button").textContent') === '已安装到 luna', 'Edge success UI');
  await edgeRemote('history.pushState({}, "", "/addons/")');
  await waitFor(async () => await edgeRemote('getComputedStyle(document.getElementById("luna-edge-panel")).display') === 'none', 'detail button hidden on home page');
  assert.deepEqual(errors, []);
  await closeApp(application, page); application = null;
  console.log('PASS: Chrome and Edge store integration, Chromium transport, redirect/streaming, actionable errors, CRX validation, browser-only authorization, Edge install button, install success/status, direct input, safe SPA navigation.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (application) await closeApp(application, page, false).catch(() => application.process().kill());
  fs.rmSync(profile, { recursive: true, force: true });
});
