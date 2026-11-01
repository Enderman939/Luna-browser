const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { closeApp } = require('./app-helpers');
const { dialogPage } = require('./dialog-helpers');

const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-backup-pwa-'));
const backupFile = path.join(profile, 'fixture.luna-backup'), errors = [], checks = [];
let application, page, pwaPage;
const server = http.createServer((request, response) => {
  if (request.url === '/manifest.json') { response.writeHead(200, { 'Content-Type': 'application/manifest+json' }); response.end(JSON.stringify({ name: 'Fixture PWA', short_name: 'Fixture', start_url: '/app/', scope: '/app/', display: 'standalone' })); return; }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><html><head><title>Fixture</title><link rel="manifest" href="/manifest.json"></head><body><h1>Fixture</h1><a id="outside" href="/outside">Outside app scope</a></body></html>');
});
const command = (action, payload) => page.evaluate(({ action, payload }) => window.browser.command(action, payload), { action, payload });
const state = () => command('state');
async function wait(predicate, label, timeout = 15000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 40)); } throw new Error('Timed out: ' + label); }
async function accept(kind) {
  await page.waitForSelector('#confirmation-dialog[open][data-kind="' + kind + '"]');
  const layer = await dialogPage(page, '#confirmation-dialog[open][data-kind="' + kind + '"]');
  await layer.locator('#confirmation-accept').click();
  await wait(async () => !(await state()).prompt, kind + ' prompt dismissed');
}

async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const env = { ...process.env, LUNA_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const args = ['--no-proxy-server', '--disable-gpu'];
  application = await electron.launch({ executablePath: process.env.LUNA_EXECUTABLE || require('electron'), args: process.env.LUNA_EXECUTABLE ? args : [root, ...args], env });
  application.on('window', target => target.on('pageerror', error => errors.push(error.message)));
  page = await application.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.waitForSelector('.tab.selected');
  await command('update-settings', { searchSuggestions: false });
  await application.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, backupFile);
  await application.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, backupFile);

  await command('bookmark-action', { action: 'save', url: base + '/saved', title: 'Backup bookmark' });
  assert.equal((await state()).bookmarks.some(item => item.title === 'Backup bookmark'), true);
  await command('navigate', base + '/'); await wait(async () => (await state()).tabs[0].url === base + '/' && !(await state()).tabs[0].loading, 'fixture page');
  const tab = (await state()).tabs[0];
  await command('site-permission-set', { tabId: tab.id, origin: new URL(base).origin, key: 'camera', value: 'allow' });
  assert.equal((await state()).sitePermissions[0].permissions[0].value, 'allow');
  await command('site-permission-clear', new URL(base).origin);
  assert.equal((await state()).sitePermissions.length, 0); checks.push('central website-permission grant list and revoke');

  await command('settings'); await page.locator('[data-settings-section="privacy"]').click();
  await page.locator('#backup-export').click();
  let exported;
  await wait(() => { try { exported = JSON.parse(fs.readFileSync(backupFile, 'utf8')); return true; } catch { return false; } }, 'backup exported');
  assert.equal(exported.data.bookmarks.some(item => item.title === 'Backup bookmark'), true); assert.equal(Object.hasOwn(exported, 'passwords'), false);
  await command('bookmark-action', { action: 'save', url: base + '/new-after-backup', title: 'Extra bookmark' });
  await page.locator('#backup-import').click(); await page.waitForSelector('#backup-restore-dialog[open]');
  assert.match(await page.locator('#backup-restore-summary').textContent(), /收藏 1 条/);
  await page.locator('#backup-restore-mode').selectOption('replace'); await page.locator('#backup-restore-submit').click();
  await accept('browser-backup-restore');
  await wait(() => page.locator('#backup-restore-dialog:not([open])').count().then(Boolean), 'restore dialog closes');
  let restored = await state();
  assert.equal(restored.bookmarks.some(item => item.url === base + '/saved'), true);
  assert.equal(restored.bookmarks.some(item => item.url === base + '/new-after-backup'), false);
  assert.equal(restored.settings.searchSuggestions, false);
  assert.equal(restored.sitePermissions.length, 0); checks.push('local backup export, preview, replace restore, and saved settings');

  await command('navigate', base + '/');
  await wait(async () => (await state()).pwa?.canInstall === true, 'PWA manifest discovered');
  await page.locator('#address-symbol').click(); await page.waitForSelector('#site-info-dialog[open]');
  await page.locator('#site-app-install').click(); await accept('pwa-install');
  await page.locator('#site-info-close').click();
  await wait(async () => { pwaPage = application.windows().find(target => !target.isClosed() && target.url() === base + '/app/'); return !!pwaPage; }, 'standalone app window');
  const restoredState = await state(), current = restoredState.tabs.find(item => item.id === restoredState.activeId);
  await application.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScript("localStorage.setItem('profile-marker','browser')"), current.webContentsId);
  assert.equal(await pwaPage.evaluate(() => localStorage.getItem('profile-marker')), null, 'PWA has isolated website storage');
  assert.equal(await pwaPage.evaluate(() => Notification.requestPermission()), 'denied');
  await pwaPage.locator('#outside').evaluate(element => element.click());
  await wait(async () => (await state()).tabs.some(item => item.url === base + '/outside'), 'out-of-scope navigation returns to browser');
  checks.push('same-origin manifest install, standalone window, isolated storage, denied sensitive permissions, and external navigation routing');

  const appRecord = (await state()).installedApps[0];
  const removing = command('pwa-remove', appRecord.id); await accept('pwa-remove'); await removing;
  await wait(() => application.windows().every(target => target.isClosed() || target.url() !== base + '/app/'), 'PWA window removed');
  assert.equal((await state()).installedApps.length, 0);
  assert.deepEqual(errors, []);
  await application.evaluate(({ app }) => app.exit(0)); await application.close(); application = null;
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts/backup-pwa-result.json'), JSON.stringify({ passed: true, checks, testedAt: new Date().toISOString() }, null, 2));
  console.log('PASS backup and PWA: ' + checks.join('; '));
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (pwaPage && !pwaPage.isClosed()) await pwaPage.close().catch(() => {});
  if (application) { await application.evaluate(({ app }) => app.exit(1)).catch(() => {}); await application.close().catch(() => {}); }
  await new Promise(resolve => server.close(resolve)); fs.rmSync(profile, { recursive: true, force: true });
});
