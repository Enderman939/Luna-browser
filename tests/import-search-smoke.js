const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createImportFixture } = require('./import-fixture');
const { dialogPage, dialogClosed } = require('./dialog-helpers');
const { popupPage } = require('./popover-helpers');
const { closeApp } = require('./app-helpers');
const root = path.resolve(__dirname, '..'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-import-ui-')), profile = path.join(directory, 'luna'), artifacts = path.join(root, 'artifacts');
const checks = [], errors = []; let application, page;
const command = (action, payload, target = page) => target.evaluate(({ action, payload }) => window.browser.command(action, payload), { action, payload });
const state = (target = page) => command('state', undefined, target);
async function wait(fn, name, timeout = 15000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 40)); } throw new Error('Timed out: ' + name); }
async function confirm(kind, accepted = true, parent = page) { const layer = await dialogPage(parent, '#confirmation-dialog[open][data-kind="' + kind + '"]'); await layer.locator(accepted ? '#confirmation-accept' : '#confirmation-cancel').click(); await wait(async () => !(await state(parent)).prompt, 'confirmation closed'); }
async function run() {
  fs.mkdirSync(artifacts, { recursive: true }); const windows = process.platform === 'win32', fixture = createImportFixture(directory, windows);
  const env = { ...process.env, LUNA_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ executablePath: process.env.LUNA_EXECUTABLE || require('electron'), args: process.env.LUNA_EXECUTABLE ? ['--no-proxy-server'] : [root, '--no-proxy-server'], env });
  application.on('window', window => window.on('pageerror', error => errors.push(error.message))); page = await application.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.waitForSelector('.tab.selected');
  await application.evaluate(({ app, session }, roots) => {
    const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    const { BrowserImporter } = require('./src/browser-import'); const original = BrowserImporter.prototype.list;
    BrowserImporter.prototype.list = function() { this.roots = roots; return original.call(this); };
    globalThis.__suggestionRequests = [];
    session.fromPartition('luna-search-suggestions', { cache: false }).fetch = async (url, options) => {
      globalThis.__suggestionRequests.push(url); const query = new URL(url).searchParams.get('query');
      await new Promise((resolve, reject) => { const timer = setTimeout(resolve, query === 'slow' ? 400 : 15); options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }); });
      return new Response(JSON.stringify([query, query === 'electron' ? ['electron chrome extension', 'electron-builder'] : [query + ' result']]));
    };
    session.fromPartition('persist:luma-web').protocol.handle('https', () => new Response('<!doctype html><title>Controlled search result</title><h1>Local test result</h1>', { headers: { 'Content-Type': 'text/html' } }));
  }, fixture.roots);
  await command('update-settings', { searchEngine: 'bing', searchSuggestions: true });
  await page.locator('#import-welcome-open').click(); let layer = await dialogPage(page, '#browser-import-dialog[open]');
  assert.match(await layer.locator('#browser-import-profile').textContent(), /Edge.*Synthetic Edge/);
  await layer.locator('#browser-import-submit').click(); await confirm('browser-import');
  await layer.waitForSelector('#browser-import-result:not([hidden])'); assert.match(await layer.locator('#browser-import-result').textContent(), /650/);
  if (windows) assert.match(await layer.locator('#browser-import-result').textContent(), /1 条密码受应用绑定/);
  else assert.match(await layer.locator('#browser-import-profile-note').textContent(), /macOS.*CSV/);
  assert.equal((await state()).bookmarks.length, 1); assert.equal((await state()).bookmarkFolders.length, 2); assert.equal((await state()).history.length, 650); assert.equal((await state()).downloads.length, 1);
  const passwords = (await command('password-list')).entries; assert.equal(passwords.length, windows ? 2 : 0);
  if (windows) {
  const detail = command('password-detail', passwords.find(entry => entry.username === 'aes').id); await confirm('password-reveal'); assert.equal((await detail).password, 'Synthetic-AES!');
  const legacy = command('password-detail', passwords.find(entry => entry.username === 'legacy').id); await confirm('password-reveal'); assert.equal((await legacy).password, 'Synthetic-legacy!');
  const disk = fs.readFileSync(path.join(profile, 'password-vault.json'), 'utf8'); assert.equal(disk.includes('Synthetic-AES!'), false); assert.equal(disk.includes('Synthetic-legacy!'), false);
  }
  await layer.locator('#browser-import-submit').click(); await confirm('browser-import'); await layer.waitForSelector('#browser-import-result:not([hidden])'); await wait(async () => await layer.locator('#browser-import-submit').isEnabled(), 'duplicate import finished');
  assert.equal((await state()).bookmarkFolders.length, 2); assert.equal((await state()).history.length, 650); assert.equal((await command('password-list')).entries.length, windows ? 2 : 0);
  await layer.screenshot({ path: path.join(artifacts, 'browser-import-preview.png') }); await layer.locator('#browser-import-close').click(); await wait(() => dialogClosed(layer), 'import closed');
  checks.push('actual detected-profile UI; read-only bookmark hierarchy, 650 history URLs and completed download metadata; ' + (windows ? 'DPAPI and AES-GCM passwords re-encrypted; application-bound password explicitly reported' : 'macOS password CSV path explained') + '; duplicate import preserves data');
  console.log('PASS browser import and Windows password encryption');
  await page.locator('#address').fill('electron'); await wait(async () => (await state()).addressSuggestions.phrases.length === 2, 'online suggestions');
  let popup = await popupPage(application, 'address'); await popup.waitForSelector('.search-candidate');
  assert.deepEqual((await state()).addressSuggestions.items.slice(0, 3).map(item => item.type), ['search', 'search', 'search']);
  assert.equal(await popup.locator('.address-candidate').first().getAttribute('data-type'), 'search'); assert.ok(await popup.locator('.candidate-title strong').count());
  await popup.waitForFunction(() => document.querySelector('.address-candidate-list').clientHeight >= 150, undefined, { timeout: 5000 });
  await popup.screenshot({ path: path.join(artifacts, 'search-candidates-preview.png') });
  await popup.locator('[data-filter="bookmark"]').click(); await wait(async () => (await state()).addressSuggestions.filter === 'bookmark', 'bookmark filter'); assert.equal((await state()).addressSuggestions.items[0].type, 'bookmark');
  await popup.locator('[data-filter="all"]').click(); await wait(async () => (await state()).addressSuggestions.filter === 'all', 'all filter');
  await page.locator('#address').press('ArrowDown'); await wait(async () => (await state()).addressSuggestions.selected === 0, 'first search selected'); await page.locator('#address').press('ArrowDown'); await wait(async () => (await state()).addressSuggestions.selected === 1, 'online result selected'); await page.locator('#address').press('Enter');
  await wait(async () => { const current = await state(); return current.tabs.find(tab => tab.id === current.activeId).url === 'https://www.bing.com/search?q=electron%20chrome%20extension'; }, 'keyboard search URL');
  await page.locator('#address').fill('slow'); await wait(() => application.evaluate(() => globalThis.__suggestionRequests.some(url => url.includes('query=slow'))), 'slow request started'); await page.locator('#address').fill('fast');
  await wait(async () => (await state()).addressSuggestions.items.some(item => item.title === 'fast result'), 'latest query won'); await new Promise(resolve => setTimeout(resolve, 450)); assert.equal((await state()).addressSuggestions.items.some(item => item.title === 'slow result'), false);
  await page.locator('#address').press('Escape'); const count = await application.evaluate(() => globalThis.__suggestionRequests.length);
  await command('update-settings', { searchSuggestions: false }); await page.locator('#address').fill('offlinekeyword'); await wait(async () => (await state()).addressSuggestions.query === 'offlinekeyword', 'offline candidate'); assert.equal((await state()).addressSuggestions.items[0].type, 'search'); assert.equal(await application.evaluate(() => globalThis.__suggestionRequests.length), count);
  await page.locator('#address').press('Escape'); await command('update-settings', { searchSuggestions: true });
  await command('private-window'); let privatePage; await wait(() => { privatePage = application.windows().find(window => window !== page && !window.isClosed() && window.url().endsWith('/index.html')); return !!privatePage; }, 'private window'); await privatePage.waitForSelector('.tab.selected');
  await assert.rejects(command('browser-import-list', undefined, privatePage)); await privatePage.locator('#address').fill('privatekeyword'); await wait(async () => (await state(privatePage)).addressSuggestions.query === 'privatekeyword', 'private local suggestions'); assert.equal(await application.evaluate(() => globalThis.__suggestionRequests.length), count);
  await command('close-window', undefined, privatePage); await wait(() => privatePage.isClosed(), 'private close');
  checks.push('real search-first popup, highlighted match, filters and keyboard navigation; controlled search-provider responses; stale results cancelled; suggestions setting and private session prevent network requests'); console.log('PASS search candidates and request isolation');
  await application.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).focus(), (await state()).windowId);
  await page.locator('#downloads-button').click(); popup = await popupPage(application, 'downloads'); await popup.locator('[data-action="remove"]').click(); await wait(async () => (await state()).downloads.length === 0, 'remove record'); assert.equal(fs.existsSync(fixture.file), true);
  const profiles = await command('browser-import-list'); const importing = command('browser-import-run', { id: profiles[0].id, types: ['downloads'] }); await confirm('browser-import'); await importing;
  await page.locator('#downloads-button').click(); popup = await popupPage(application, 'downloads'); await popup.locator('[data-action="delete-file"]').click(); await confirm('download-delete-file', false); assert.equal(fs.existsSync(fixture.file), true); assert.equal((await state()).downloads.length, 1);
  await page.locator('#downloads-button').click(); popup = await popupPage(application, 'downloads'); await popup.locator('[data-action="delete-file"]').click(); await confirm('download-delete-file'); await wait(async () => (await state()).downloads.length === 0, 'delete file and record'); assert.equal(fs.existsSync(fixture.file), false);
  checks.push('actual download buttons remove history without touching the file; cancelling file deletion preserves both; confirmed deletion moves the synthetic file to Windows recycle bin and removes its record'); console.log('PASS download record and file deletion');
  assert.deepEqual(errors, []); const version = (await state()).version; await closeApp(application, page, false); application = null;
  const persisted = JSON.parse(fs.readFileSync(path.join(profile, 'download-history.json'), 'utf8')); assert.equal(persisted.length, 0);
  fs.writeFileSync(path.join(artifacts, 'import-search-result.json'), JSON.stringify({ passed: true, version, checks, testedAt: new Date().toISOString() }, null, 2));
  console.log('PASS: ' + checks.join('; '));
}
run().catch(async error => { console.error(error); if (application) { const target = application.windows().find(window => !window.isClosed() && window.url().endsWith('/modal-layer.html')) || page; await target?.screenshot({ path: path.join(artifacts, 'import-search-failure.png') }).catch(() => {}); } process.exitCode = 1; }).finally(async () => { if (application) { await application.evaluate(({ app }) => app.exit(0)).catch(() => {}); await application.close().catch(() => {}); } fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
