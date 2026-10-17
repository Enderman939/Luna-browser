const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { dialogPage } = require('./dialog-helpers');
const { popupPage } = require('./popover-helpers');
const root = path.resolve(__dirname, '..'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-mac-smoke-'));
let application, page;
const checks = [], errors = [];
const command = (action, payload) => page.evaluate(({ action, payload }) => window.browser.command(action, payload), { action, payload });
const server = http.createServer((request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Mac browser fixture</title><h1>Apple Silicon browser</h1><input id="draft" value="unsaved">'); });
async function wait(predicate, label) { const start = Date.now(); while (Date.now() - start < 15000) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error('Timed out: ' + label); }
async function run() {
  assert.equal(process.platform, 'darwin'); assert.equal(process.arch, 'arm64');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = 'http://127.0.0.1:' + server.address().port;
  const env = { ...process.env, LUNA_USER_DATA: path.join(directory, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ executablePath: process.env.LUNA_EXECUTABLE || require('electron'), args: process.env.LUNA_EXECUTABLE ? ['--no-proxy-server'] : [root, '--no-proxy-server'], env });
  page = await application.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.waitForSelector('.tab.selected');
  const runtime = await application.evaluate(({ app, Menu, safeStorage }) => ({ version: app.getVersion(), platform: process.platform, arch: process.arch, electron: process.versions.electron, chrome: process.versions.chrome, encryption: safeStorage.isEncryptionAvailable(), nativeMenu: !!Menu.getApplicationMenu() }));
  assert.equal(runtime.platform, 'darwin'); assert.equal(runtime.arch, 'arm64'); assert.equal(runtime.electron, '44.7.2'); assert.equal(runtime.nativeMenu, true); assert.equal(runtime.encryption, true);
  assert.equal(await page.locator('body').getAttribute('data-platform'), 'darwin'); assert.equal(await page.locator('.window-controls').isVisible(), false);
  assert.match(await page.locator('#new-tab').getAttribute('title'), /Cmd/);
  await page.locator('#address').press('Meta+t'); await wait(async () => (await command('state')).tabs.length === 2, 'Command T');
  await page.locator('#address').press('Meta+w'); await wait(async () => (await command('state')).tabs.length === 1, 'Command W');
  await command('navigate', base); await wait(async () => !(await command('state')).tabs[0].loading, 'local page');
  await page.locator('#address').press('Meta+l'); assert.equal(await page.locator('#address').evaluate(node => node === document.activeElement), true);
  checks.push('native arm64 runtime, macOS menu and window controls, Command shortcuts, live local webpage');
  const csv = path.join(directory, 'passwords.csv'); fs.writeFileSync(csv, 'name,url,username,password\nSynthetic,https://mac-login.example/,mac-user,Synthetic-Mac-Keychain!\n');
  await application.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, csv);
  const importing = command('password-import'); const layer = await dialogPage(page, '#confirmation-dialog[open]'); await layer.locator('#confirmation-accept').click(); const result = await importing;
  assert.equal(result.added, 1); assert.equal((await command('password-list')).entries[0].username, 'mac-user');
  const disk = fs.readFileSync(path.join(directory, 'profile/password-vault.json'), 'utf8'); assert.equal(disk.includes('Synthetic-Mac-Keychain!'), false); assert.equal(disk.includes('mac-user'), false);
  checks.push('CSV password import with real macOS Keychain encryption and no plaintext vault');
  await page.locator('#menu-button').click(); const popup = await popupPage(application, 'browser');
  assert.equal(await popup.locator('#menu-ie-mode').isVisible(), false);
  await command('popover-close'); await command('close-window'); await wait(() => page.isClosed(), 'last window closed');
  assert.equal(application.process().exitCode, null); await application.evaluate(({ app }) => app.emit('activate'));
  await wait(() => { page = application.windows().find(window => !window.isClosed() && window.url().endsWith('/index.html')); return !!page; }, 'Dock activation recreates window'); await page.waitForSelector('.tab.selected');
  checks.push('last window close retains macOS application; Dock activation reopens a usable browser');
  await application.evaluate(({ app }, url) => app.emit('open-url', { preventDefault() {} }, url), base + '/external');
  await wait(async () => (await command('state')).tabs.some(tab => tab.url === base + '/external'), 'macOS external URL');
  await command('new-tab'); const exiting = application.evaluate(({ app }) => app.quit()).catch(() => {});
  const confirmation = await dialogPage(page, '#confirmation-dialog[open]'); await confirmation.locator('#confirmation-cancel').click(); await exiting; assert.equal(application.process().exitCode, null);
  checks.push('macOS open-url delivers web links and cancelling Quit preserves the application');
  assert.deepEqual(errors, []); await application.evaluate(({ app }) => app.exit(0)); await application.close(); application = null;
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true }); fs.writeFileSync(path.join(root, 'artifacts/macos-smoke-result.json'), JSON.stringify({ passed: true, version: runtime.version, runtime, checks, testedAt: new Date().toISOString() }, null, 2));
  console.log('PASS macOS: ' + checks.join('; '));
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (application) { await page?.screenshot({ path: path.join(root, 'artifacts/macos-failure.png') }).catch(() => {}); await application.evaluate(({ app }) => app.exit(1)).catch(() => {}); await application.close().catch(() => {}); }
  await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true });
});
