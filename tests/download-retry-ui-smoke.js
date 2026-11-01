const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { closeApp } = require('./app-helpers');

const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-retry-settings-'));
const data = Buffer.alloc(96 * 1024, 0x4c);
let retryRequests = 0, blockedRequests = 0, application, page, server, base;
const command = (name, payload) => page.evaluate(({ name, payload }) => window.browser.command(name, payload), { name, payload });
const state = () => command('state');
async function waitFor(predicate, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await page.waitForTimeout(50); }
  throw new Error('Timed out: ' + label);
}
function handler(request, response) {
  const name = request.url.split('?')[0];
  if (name === '/page') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Download fixture</title><body><h1>Downloads</h1></body>');
    return;
  }
  const isRetry = name === '/retry.bin';
  if (isRetry) retryRequests++; else if (name === '/blocked.bin') blockedRequests++;
  response.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': data.length,
    'Content-Disposition': `attachment; filename="${isRetry ? 'retry.bin' : 'blocked.bin'}"`,
  });
  if ((isRetry && retryRequests === 1) || !isRetry) {
    response.write(data.subarray(0, 8192));
    setTimeout(() => response.destroy(), 40);
  } else response.end(data);
}
async function run() {
  server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  const env = { ...process.env, LUNA_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ executablePath: process.env.LUNA_EXECUTABLE || require('electron'), args: process.env.LUNA_EXECUTABLE ? ['--disable-gpu'] : [root, '--disable-gpu'], env, timeout: 30000 });
  page = await application.firstWindow(); await page.waitForSelector('.tab.selected');

  await command('settings'); await page.waitForSelector('#settings-page:not([hidden])');
  await page.locator('[data-settings-section="downloads"]').click();
  await page.locator('#setting-downloadRetryAttempts').selectOption('1');
  await page.locator('#setting-downloadRetryDelay').selectOption('1');
  await waitFor(async () => { const settings = (await state()).settings; return settings.downloadRetryAttempts === 1 && settings.downloadRetryDelay === 1; }, 'retry controls persist');
  assert.equal(await page.locator('#setting-downloadRetryAttempts').inputValue(), '1');
  assert.equal(await page.locator('#setting-downloadRetryDelay').inputValue(), '1');

  await command('new-tab', base + '/page');
  await waitFor(async () => { const current = await state(); const tab = current.tabs.find(item => item.id === current.activeId); return tab.url === base + '/page' && !tab.loading && !tab.error; }, 'download fixture loaded');
  const current = await state(), webTab = current.tabs.find(tab => tab.id === current.activeId);
  const remote = code => application.evaluate(({ webContents }, args) => webContents.fromId(args.id).executeJavaScript(args.code, true), { id: webTab.webContentsId, code });

  await remote(`document.body.insertAdjacentHTML('beforeend','<a id="retry" download href="${base}/retry.bin">retry</a><a id="blocked" download href="${base}/blocked.bin">blocked</a>');true`);
  await remote("document.getElementById('retry').click();true");
  await waitFor(async () => (await state()).downloads.some(entry => entry.name === 'retry.bin' && entry.status === 'completed'), 'interrupted native GET retries and completes');
  assert.ok(retryRequests >= 2, 'the failed transfer was requested again');

  await command('update-settings', { downloadRetryAttempts: 0 });
  await waitFor(async () => (await state()).settings.downloadRetryAttempts === 0, 'retry disabled');

  console.log('PASS packaged download retry: settings persist, interrupted native GET automatically retries and completes, retries can be disabled');
  await closeApp(application, page, false); application = null;
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (application) await closeApp(application, page, false).catch(() => application.close());
  if (server) await new Promise(resolve => server.close(resolve));
  fs.rmSync(profile, { recursive: true, force: true });
});
