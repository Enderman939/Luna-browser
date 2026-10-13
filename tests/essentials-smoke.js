const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { closeApp } = require('./app-helpers');
const { dialogPage } = require('./dialog-helpers');
const { popupPage } = require('./popover-helpers');
const { createExtension } = require('./extension-fixture');
const { registerBrowser, runRegistry } = require('../src/default-browser');
const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-essentials-')), artifacts = path.join(root, 'artifacts');
const checks = [], errors = []; let application, page, base, launchOptions;
const server = http.createServer((request, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end('<!doctype html><title>Local ' + request.url + '</title><h1>Browser essentials</h1><a href="/next" id="next">Next</a><input id="field">' + (request.url === '/frame' ? '' : '<iframe id="cross" src="http://localhost:' + server.address().port + '/frame"></iframe>')); });
const command = (target, action, payload) => target.evaluate(({ action, payload }) => window.browser.command(action, payload), { action, payload });
const state = target => command(target, 'state');
async function wait(fn, label, timeout = 15000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 40)); } throw new Error('Timed out: ' + label); }
const active = async target => { const s = await state(target); return s.tabs.find(tab => tab.id === s.activeId); };
const remote = (id, code) => application.evaluate(({ webContents }, { id, code }) => webContents.fromId(id).executeJavaScript(code, true), { id, code });
function mainWindows() { return application.windows().filter(page => !page.isClosed() && /\/index\.html$/.test(page.url())); }
async function navigate(target, url) { await command(target, 'navigate', url); await wait(async () => { const tab = await active(target); return tab.url === url && !tab.loading && !tab.error; }, 'navigate ' + url); }
async function dismiss(target, selector) { await target.locator(selector).evaluate(node => node.close()); await command(target, 'modal-state', false); await command(target, 'overlay', false); }
async function prompt(target, accept, kind) { await target.waitForSelector('#confirmation-dialog[open][data-kind="' + kind + '"]', { timeout: 12000 }); const layer = await dialogPage(target, '#confirmation-dialog[open][data-kind="' + kind + '"]'); await layer.locator(accept ? '#confirmation-accept' : '#confirmation-cancel').click(); await target.waitForSelector('#confirmation-dialog[open]', { state: 'hidden', timeout: 12000 }); await wait(async () => !(await state(target)).prompt, 'prompt cleared'); }
async function closeWindow(target) { await command(target, 'close-window').catch(() => {}); await wait(async () => target.isClosed() || await target.locator('#confirmation-dialog[open]').count().catch(() => 0), 'close prompt'); if (!target.isClosed()) { await (await dialogPage(target, '#confirmation-dialog[open]')).locator('#confirmation-accept').click(); } await wait(() => target.isClosed(), 'window closed'); }
async function launch() {
  const env = { ...process.env, LUNA_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const args = ['--no-proxy-server', '--disable-gpu', '--use-fake-device-for-media-stream', '--host-resolver-rules=MAP localhost 127.0.0.1'];
  launchOptions = { executablePath: process.env.LUNA_EXECUTABLE || require('electron'), args: process.env.LUNA_EXECUTABLE ? args : [root, ...args], env, timeout: 30000 };
  application = await electron.launch(launchOptions); application.on('window', win => win.on('pageerror', error => errors.push(error.message)));
  page = await application.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.waitForSelector('.tab.selected');
  await application.evaluate(() => { globalThis.__essentialsErrors = []; process.on('uncaughtException', error => globalThis.__essentialsErrors.push(error.stack)); });
}
async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = 'http://127.0.0.1:' + server.address().port;
  createExtension(path.join(profile, 'fixture-extension'));
  await launch(); await navigate(page, base + '/first'); let first = await active(page);
  // Exercise the actual browser permission callback, without --use-fake-ui-for-media-stream.
  await remote(first.webContentsId, 'window.permissionResult="pending";navigator.mediaDevices.getUserMedia({video:true,audio:true}).then(stream=>{window.permissionResult="granted:"+stream.getTracks().length;stream.getTracks().forEach(track=>track.stop())},error=>window.permissionResult=error.name);void 0');
  await prompt(page, true, 'site-permission'); await wait(async () => (await remote(first.webContentsId, 'window.permissionResult')).startsWith('granted:'), 'real camera and microphone grant');
  await page.locator('#address-symbol').click(); await page.waitForSelector('#site-info-dialog[open]');
  let dialog = await dialogPage(page, '#site-info-dialog[open]');
  assert.equal(await dialog.locator('[data-permission="camera"]').inputValue(), 'allow'); assert.equal(await dialog.locator('[data-permission="microphone"]').inputValue(), 'allow');
  await dialog.locator('[data-permission="camera"]').selectOption('block'); await dialog.screenshot({ path: path.join(artifacts, 'essentials-site-info.png') });
  await dismiss(page, '#site-info-dialog'); await navigate(page, base + '/second'); first = await active(page);
  assert.equal(await remote(first.webContentsId, 'navigator.mediaDevices.getUserMedia({video:true}).then(stream=>{stream.getTracks().forEach(track=>track.stop());return "granted"},error=>error.name)'), 'NotAllowedError');
  await remote(first.webContentsId, 'window.notificationResult="pending";Notification.requestPermission().then(value=>window.notificationResult=value);void 0'); await prompt(page, false, 'site-permission');
  await wait(async () => await remote(first.webContentsId, 'window.notificationResult') === 'denied', 'notification denial');
  await assert.rejects(command(page, 'site-permission-set', { tabId: first.id, origin: 'https://forged.example', key: 'camera', value: 'allow' }));
  const cross = await application.evaluate(async ({ webContents }, id) => { const web = webContents.fromId(id); const frame = web.mainFrame.frames.find(frame => frame.url.startsWith('http://localhost:')); return frame.executeJavaScript('navigator.mediaDevices.getUserMedia({audio:true}).then(stream=>{stream.getTracks().forEach(track=>track.stop());return "granted"},error=>error.name)', true); }, first.webContentsId);
  assert.equal(cross, 'NotAllowedError'); checks.push('real media authorization, persisted per-origin allow/block, notifications denial, site panel and cross-origin rejection'); console.log('PASS permissions');
  await command(page, 'bookmark'); await command(page, 'new-tab', base + '/third'); await wait(async () => !(await active(page)).loading, 'third'); const third = await active(page);
  await page.locator('#address').fill('second'); await wait(async () => (await state(page)).popover === 'address', 'address suggestions');
  let popup = await popupPage(application, 'address'); await popup.waitForSelector('.address-candidate'); assert.equal(await page.locator('#address').evaluate(node => node === document.activeElement), true);
  await page.locator('#address').press('ArrowDown'); await wait(async () => (await state(page)).addressSuggestions.selected === 0, 'keyboard highlight'); await page.locator('#address').press('Enter');
  await wait(async () => (await state(page)).activeId === first.id, 'candidate switches existing tab');
  await page.locator('#address').fill('third'); await wait(async () => (await state(page)).popover === 'address', 'mouse suggestions'); popup = await popupPage(application, 'address'); await popup.locator('.address-candidate').first().click();
  await wait(async () => (await state(page)).activeId === third.id, 'mouse candidate'); checks.push('address candidates keep input focus; keyboard and real popup mouse selection switch existing tabs'); console.log('PASS address');
  await page.locator('.tab[data-id="' + third.id + '"]').click({ button: 'right' }); await page.waitForSelector('#tab-group-dialog[open]'); dialog = await dialogPage(page, '#tab-group-dialog[open]'); await dialog.getByRole('button', { name: '固定标签页', exact: true }).click();
  await wait(async () => (await state(page)).tabs[0].id === third.id && (await state(page)).tabs[0].pinned, 'pin order');
  await command(page, 'tab-action', { id: third.id, action: 'mute' }); assert.equal(await application.evaluate(({ webContents }, id) => webContents.fromId(id).isAudioMuted(), third.webContentsId), true);
  // Real HTML drag/drop dispatch exercises the UI serialization and main-process validation.
  await command(page, 'new-tab', base + '/fourth'); await wait(async () => !(await active(page)).loading, 'fourth'); const fourth = await active(page);
  await command(page, 'tab-action', { id: fourth.id, action: 'pin' }); await command(page, 'tab-action', { id: fourth.id, action: 'pin' });
  assert.equal((await state(page)).tabs[0].id, third.id); assert.equal((await state(page)).tabs[0].pinned, true);
  await wait(async () => await page.locator('.tab').evaluateAll(nodes => nodes.map(node => Number(node.dataset.id)).join(',')) === [third.id, first.id, fourth.id].join(','), 'pin/unpin reflected in actual tab DOM');
  await page.locator('.tab[data-id="' + fourth.id + '"]').dragTo(page.locator('.tab[data-id="' + first.id + '"]'));
  await wait(async () => (await state(page)).tabs.map(tab => tab.id).join(',') === [third.id, fourth.id, first.id].join(','), 'drag reorder');
  await remote(first.webContentsId, 'window.liveMarker={value:123};document.getElementById("field").value="unsaved"');
  await command(page, 'tab-action', { id: first.id, action: 'move' }); let other;
  await wait(() => { other = mainWindows().find(win => win !== page); return !!other; }, 'new window'); await other.waitForSelector('.tab.selected');
  assert.equal((await active(other)).webContentsId, first.webContentsId); assert.deepEqual(await remote(first.webContentsId, '({marker:window.liveMarker.value,input:document.getElementById("field").value})'), { marker: 123, input: 'unsaved' });
  await remote(first.webContentsId, 'document.getElementById("next").click()'); await wait(async () => (await active(other)).url === base + '/next', 'moved navigation updates target');
  await command(other, 'back'); await wait(async () => (await active(other)).url === base + '/second', 'moved history');
  await command(other, 'new-tab', base + '/target'); await wait(async () => !(await active(other)).loading, 'target ready');
  await command(page, 'tab-action', { id: fourth.id, action: 'move', windowId: (await state(other)).windowId }); assert.equal((await active(other)).webContentsId, fourth.webContentsId);
  // Confirm extension tab/window bookkeeping follows the real moved tab.
  await application.evaluate(({ dialog }, file) => { globalThis.__originalOpen = dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, path.join(profile, 'fixture-extension'));
  await application.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).focus(), (await state(page)).windowId);
  const loading = command(page, 'extension-load-directory'); await prompt(page, true, 'permissions'); await loading;
  await application.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.__originalOpen; });
  await wait(async () => (await state(page)).extensions.length === 1, 'fixture extension');
  const extension = (await state(page)).extensions[0]; await command(page, 'new-tab', 'chrome-extension://' + extension.id + '/options.html'); await wait(async () => !(await active(page)).loading, 'extension options');
  const optionTab = await active(page), extensionTabs = await remote(optionTab.webContentsId, 'chrome.tabs.query({})');
  assert.equal(extensionTabs.find(tab => tab.id === fourth.webContentsId).windowId, (await state(other)).windowId);
  assert.equal(extensionTabs.find(tab => tab.id === third.webContentsId).pinned, true);
  checks.push('actual drag sorting, pin/mute, transfer keeps WebContents and unsaved JS/DOM/history; extensions see new owner'); console.log('PASS tabs');
  await command(page, 'activate', third.id); await command(page, 'bookmark');
  // After native cross-window transfers, bring the tested owner forward before
  // sending real mouse input; another browser window can still cover its toolbar.
  await wait(async () => await page.locator('.tab.selected').getAttribute('data-id') === String(third.id), 'selected tab rendered before bookmarks');
  const bookmarkOwner = (await state(page)).windowId;
  await application.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).focus(), bookmarkOwner);
  await wait(() => application.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isFocused(), bookmarkOwner), 'bookmark owner foreground');
  await page.locator('#bookmarks-button').click(); popup = await popupPage(application, 'bookmarks'); await popup.locator('#bookmark-manage').click(); await page.waitForSelector('#bookmark-manager-dialog[open]');
  dialog = await dialogPage(page, '#bookmark-manager-dialog[open]');
  await dialog.locator('#bookmark-folder-new').click(); await dialog.locator('#bookmark-edit-title').fill('Research & notes'); await dialog.locator('#bookmark-editor-form button[type="submit"]').click();
  await wait(async () => (await state(page)).bookmarkFolders.length === 1, 'create folder'); const folder = (await state(page)).bookmarkFolders[0];
  await dialog.waitForSelector('#bookmark-editor-dialog', { state: 'hidden' });
  await dialog.locator('.bookmark-manager-row[data-id="' + folder.id + '"]').waitFor();
  const saved = (await state(page)).bookmarks.find(entry => entry.url === base + '/third'); await dialog.locator('.bookmark-manager-row[data-id="' + saved.id + '"]').getByRole('button', { name: '编辑', exact: true }).click();
  await dialog.waitForSelector('#bookmark-editor-dialog[open]');
  await dialog.locator('#bookmark-edit-title').fill('Renamed saved page'); await dialog.locator('#bookmark-edit-folder').selectOption(folder.id); await dialog.locator('#bookmark-editor-form button[type="submit"]').click();
  await wait(async () => (await state(page)).bookmarks.find(entry => entry.id === saved.id).folderId === folder.id, 'move bookmark');
  await dialog.locator('#bookmark-location').selectOption(folder.id); await dialog.getByRole('button', { name: 'Renamed saved page', exact: false }).waitFor(); await dialog.screenshot({ path: path.join(artifacts, 'essentials-bookmark-manager.png') });
  const exported = path.join(profile, 'exported.html'), importedFile = path.join(profile, 'imported.html'); fs.writeFileSync(importedFile, '<DL><H3>Imported</H3><DL><A HREF="https://safe.example/a?x=1&amp;y=2">Safe &amp; new</A><A HREF="javascript:alert(1)">Dangerous</A></DL></DL>');
  await application.evaluate(({ dialog }, files) => { globalThis.__savedDialogs = [dialog.showOpenDialog, dialog.showSaveDialog]; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [files.imported] }); dialog.showSaveDialog = async () => ({ canceled: false, filePath: files.exported }); }, { imported: importedFile, exported });
  await dialog.locator('#bookmark-export').click(); await wait(() => fs.existsSync(exported), 'export file'); assert.ok(fs.readFileSync(exported, 'utf8').includes('Research &amp; notes'));
  await dialog.locator('#bookmark-import').click(); await prompt(page, true, 'bookmark-import'); await wait(async () => (await state(page)).bookmarks.some(entry => entry.url === 'https://safe.example/a?x=1&y=2'), 'HTML import');
  assert.equal((await state(page)).bookmarks.some(entry => entry.url.startsWith('javascript:')), false);
  await application.evaluate(({ dialog }) => { [dialog.showOpenDialog, dialog.showSaveDialog] = globalThis.__savedDialogs; }); await dismiss(page, '#bookmark-manager-dialog');
  checks.push('real folder/edit/move UI, native file chooser HTML export/import, escaped titles and unsafe URL rejection'); console.log('PASS bookmarks');
  const before = (await state(page)).tabs.length;
  const secondary = spawn(launchOptions.executablePath, [...launchOptions.args, '--', base + '/external'], { env: launchOptions.env, windowsHide: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => { secondary.once('error', reject); secondary.once('exit', code => code === 0 ? resolve() : reject(new Error('Secondary exited ' + code))); });
  await wait(async () => mainWindows().some(win => false) || (await Promise.all(mainWindows().map(state))).some(value => value.tabs.some(tab => tab.url === base + '/external')), 'second-instance external URL');
  assert.ok((await Promise.all(mainWindows().map(state))).reduce((sum, s) => sum + s.tabs.length, 0) >= before);
  const registryRoot = 'HKCU\\Software\\luna\\RegistryTests\\' + randomUUID();
  try { await registerBrowser('E:\\Test Folder\\luna.exe', runRegistry, registryRoot); const result = await runRegistry(['query', registryRoot + '\\Software\\Classes\\LunaURL\\shell\\open\\command', '/ve']); assert.ok(result.includes('"E:\\Test Folder\\luna.exe" -- "%1"')); }
  finally { await runRegistry(['delete', registryRoot, '/f']); }
  await assert.rejects(command(page, 'default-browser-register')); checks.push('Windows registry writes validated under isolated test key; production UserChoice unchanged; external URL delivered to existing process'); console.log('PASS system');
  await command(page, 'private-window'); let privatePage; await wait(() => { privatePage = mainWindows().find(win => win !== page && win !== other); return !!privatePage; }, 'private'); await privatePage.waitForSelector('.tab.selected'); await navigate(privatePage, base + '/private');
  assert.equal((await state(privatePage)).siteInfo.permissions.find(entry => entry.key === 'camera').value, 'ask');
  await assert.rejects(command(page, 'tab-action', { id: third.id, action: 'move', windowId: (await state(privatePage)).windowId }));
  await closeWindow(privatePage);
  if (!privatePage.isClosed()) throw new Error('Private window did not close');
  assert.deepEqual(await application.evaluate(() => globalThis.__essentialsErrors), []); assert.deepEqual(errors, []);
  for (const win of mainWindows()) if (win !== page) await closeWindow(win);
  await closeApp(application, page, true); application = null; await launch();
  const restoredStates = await Promise.all(mainWindows().map(async win => { await win.waitForSelector('.tab.selected'); return state(win); }));
  assert.ok(restoredStates.some(s => s.tabs.some(tab => tab.pinned && tab.muted && tab.url === base + '/third')));
  assert.ok(restoredStates[0].bookmarks.some(entry => entry.title === 'Renamed saved page' && entry.folderId === folder.id));
  await navigate(page, base + '/restored'); assert.equal((await state(page)).siteInfo.permissions.find(entry => entry.key === 'camera').value, 'block');
  checks.push('private grants isolated and cross-session moves rejected; pinned/muted tabs, bookmark hierarchy and website permission survive restart');
  assert.deepEqual(errors, []);
  for (const win of mainWindows()) if (win !== page) await closeWindow(win);
  await closeApp(application, page, false); application = null;
  fs.writeFileSync(path.join(artifacts, 'essentials-result.json'), JSON.stringify({ passed: true, version: require('../package.json').version, checks, testedAt: new Date().toISOString() }, null, 2)); console.log('PASS: ' + checks.join('; '));
}
run().catch(async error => { console.error(error); if (page && !page.isClosed()) { console.error('State', JSON.stringify(await state(page).catch(() => ({})))); await page.screenshot({ path: path.join(artifacts, 'essentials-failure.png') }).catch(() => {}); } process.exitCode = 1; }).finally(async () => { if (application) { await application.evaluate(({ app }) => app.exit(0)).catch(() => {}); await application.close().catch(() => {}); } await new Promise(resolve => server.close(resolve)); fs.rmSync(profile, { recursive: true, force: true }); });
