const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const { spawn } = require('node:child_process');
const { createExtension } = require('./extension-fixture');
const { closeApp, acceptPrompt } = require('./app-helpers');
const { dialogPage } = require('./dialog-helpers');
const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-private-security-'));
let application, page, base, privatePage;
const requests = [], errors = [], checks = [];
const server = http.createServer((request, response) => {
  requests.push({ host: request.headers.host, url: request.url, dnt: request.headers.dnt, gpc: request.headers['sec-gpc'] });
  response.setHeader('Content-Type', request.url.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8');
  if (request.url === '/ad.js') return response.end('window.adRan=true;');
  if (request.url === '/tracker.js') return response.end('window.trackerRan=true;');
  if (request.url === '/safe.js') return response.end('window.safeRan=true;');
  if (request.url === '/worker.js') {
    const port = server.address().port;
    return response.end(`Promise.all([fetch('http://doubleclick.net:${port}/worker-ad').then(()=>true,()=>false),fetch('/worker-safe').then(()=>true)]).then(result=>postMessage(result));`);
  }
  if (request.url === '/frame') return response.end(`<script src="http://doubleclick.net:${server.address().port}/frame-ad.js"></script><h1>Safe frame</h1>`);
  if (request.url === '/cookie-frame') { response.setHeader('Set-Cookie', 'thirdparty=blocked; SameSite=None; Secure; Path=/'); return response.end('Third party'); }
  const port = server.address().port;
  response.end(`<!doctype html><title>Private protection fixture</title><h1>Protected page</h1><script src="http://doubleclick.net:${port}/ad.js"></script><script src="http://test.cnzz.com:${port}/tracker.js"></script><script src="/safe.js"></script>`);
});
const command = (target, action, payload) => target.evaluate(({ action, payload }) => window.browser.command(action, payload), { action, payload });
const state = target => command(target, 'state');
const active = async target => { const s = await state(target); return s.tabs.find(tab => tab.id === s.activeId); };
const remote = (id, code) => application.evaluate(({ webContents }, { id, code }) => webContents.fromId(id).executeJavaScript(code, true), { id, code });
async function wait(fn, label) { const deadline = Date.now() + 15000; while (Date.now() < deadline) { if (await fn()) return; await new Promise(r => setTimeout(r, 50)); } throw new Error('Timed out: ' + label); }
function windows() { return application.windows().filter(win => !win.isClosed() && win.url().endsWith('/index.html')); }
async function openPrivate() { await page.locator('#confirmation-dialog').waitFor({ state: 'hidden' }); await command(page, 'modal-state', false); await command(page, 'overlay', false); const old = windows(); await command(page, 'private-window'); let fresh; await wait(() => { fresh = windows().find(win => !old.includes(win)); return !!fresh; }, 'private window'); await fresh.waitForSelector('.tab.selected'); return fresh; }
async function navigate(target, url = target === page ? base : base + 'private') { await command(target, 'navigate', url); await wait(async () => { const tab = await active(target); if (tab.error) throw new Error(JSON.stringify(tab.error)); return !tab.loading && tab.url === url; }, 'page load').catch(async error => { console.error('Navigation diagnostics:', await state(target), requests); throw error; }); }
async function closeWindow(target) {
  await command(target, 'close-window').catch(() => {});
  await wait(async () => target.isClosed() || await target.locator('#confirmation-dialog[open]').count().catch(() => 0), 'close prompt').catch(async error => { console.error('Close states:', await state(target).catch(() => null), await state(page).catch(() => null)); throw error; });
  if (!target.isClosed()) await (await dialogPage(target, '#confirmation-dialog[open]')).locator('#confirmation-accept').click();
  await wait(() => target.isClosed(), 'closed');
}
async function popup(target, id) {
  await application.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).focus(), (await state(target)).windowId);
  await command(target, 'extension-launch', { id, rect: { x: 1050, y: 50, width: 30, height: 30 } });
  let result;
  await wait(() => { result = application.windows().find(win => !win.isClosed() && win.url() === 'chrome-extension://' + id + '/popup.html'); return !!result; }, 'extension popup');
  await result.waitForSelector('#result'); return result;
}
async function run() {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); base = 'http://luna.test:' + server.address().port + '/';
  const stale = path.join(profile, 'private-sessions', '99999999-11111111-1111-1111-1111-111111111111'); fs.mkdirSync(stale, { recursive: true }); fs.writeFileSync(path.join(stale, 'abandoned'), 'stale');
  const env = { ...process.env, LUNA_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const args = ['--no-proxy-server', '--host-resolver-rules=MAP luna.test 127.0.0.1, MAP frame.luna.test 127.0.0.1, MAP doubleclick.net 127.0.0.1, MAP test.cnzz.com 127.0.0.1'];
  application = await electron.launch({ executablePath: process.env.LUNA_EXECUTABLE || require('electron'), args: process.env.LUNA_EXECUTABLE ? args : [root, ...args], env, timeout: 30000 });
  application.process().on('exit', (code, signal) => { if (process.env.LUNA_PRIVATE_DIAGNOSTICS) console.error('Private test process exit', { code, signal }); });
  if (process.env.LUNA_PRIVATE_DIAGNOSTICS) { application.process().stderr.on('data', data => console.error(String(data))); await application.evaluate(({ app, BrowserWindow }) => { process.on('uncaughtExceptionMonitor', error => console.error('PRIVATE UNCAUGHT', error.stack)); app.on('before-quit', () => console.error('PRIVATE BEFORE QUIT', new Error().stack, BrowserWindow.getAllWindows().map(win => win.id))); }); }
  application.on('window', win => win.on('pageerror', error => errors.push(error.message)));
  page = await application.firstWindow(); await page.waitForSelector('.tab.selected'); assert.equal(fs.existsSync(stale), false, 'crashed-session residue is removed at startup');
  await navigate(page); const normalTab = await active(page);
  assert.equal(await remote(normalTab.webContentsId, 'window.adRan && window.trackerRan && window.safeRan'), true, 'normal session is unaffected');
  await remote(normalTab.webContentsId, 'localStorage.setItem("normal-secret","normal");document.cookie="normal=secret;path=/"');
  const directory = path.join(profile, 'extension'); createExtension(directory);
  const manifestFile = path.join(directory, 'manifest.json'), manifest = JSON.parse(fs.readFileSync(manifestFile)); manifest.permissions.push('cookies'); manifest.host_permissions.push('http://luna.test/*'); manifest.content_scripts[0].matches.push('http://luna.test/*'); fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  await application.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, directory);
  const installing = command(page, 'extension-load-directory'); await acceptPrompt(page, 'permissions'); await installing;
  const extension = (await state(page)).extensions[0]; assert.equal(extension.allowIncognito, false);
  privatePage = await openPrivate(); requests.length = 0; await navigate(privatePage); const memoryTab = await active(privatePage);
  assert.equal((await state(privatePage)).privateProtection.extensionStorage, false);
  assert.equal(await application.evaluate(({ webContents }, id) => webContents.fromId(id).session.isPersistent(), memoryTab.webContentsId), false);
  assert.equal(await remote(memoryTab.webContentsId, 'typeof window.adRan'), 'undefined'); assert.equal(await remote(memoryTab.webContentsId, 'typeof window.trackerRan'), 'undefined'); assert.equal(await remote(memoryTab.webContentsId, 'window.safeRan'), true);
  assert.ok(!requests.some(request => request.host.startsWith('doubleclick.net') || request.host.startsWith('test.cnzz.com')), 'blocked requests never reached the server');
  assert.ok(requests.some(request => request.url === '/private' && request.dnt === '1' && request.gpc === '1'), 'privacy preference headers reach the server');
  await wait(async () => (await state(privatePage)).privateProtection.blocked === 2, 'actual blocked count');
  const workerFetch = await remote(memoryTab.webContentsId, 'new Promise(resolve=>{const worker=new Worker("/worker.js");worker.onmessage=event=>{worker.terminate();resolve(event.data)}})');
  assert.deepEqual(workerFetch, [false, true], 'worker advertising fetch is intercepted while its ordinary request works');
  assert.ok(!requests.some(request => request.url === '/worker-ad'), 'worker ad request never reaches server');
  await remote(memoryTab.webContentsId, `new Promise(resolve=>{const iframe=document.createElement('iframe');iframe.src='http://frame.luna.test:${server.address().port}/frame';iframe.onload=()=>resolve(true);document.body.append(iframe)})`);
  assert.ok(requests.some(request => request.url === '/frame'), 'ordinary cross-origin iframe loads');
  assert.ok(!requests.some(request => request.url === '/frame-ad.js'), 'advertising inside a cross-origin iframe is blocked');
  assert.equal(await remote(memoryTab.webContentsId, 'localStorage.getItem("normal-secret")'), null);
  assert.equal(await remote(memoryTab.webContentsId, 'document.documentElement.dataset.lunaExtension'), undefined);
  await privatePage.screenshot({ path: path.join(root, 'artifacts/private-protection.png') });
  await privatePage.locator('#private-protection-button').click(); await wait(async () => await remote(memoryTab.webContentsId, 'window.adRan && window.trackerRan') === true, 'pause unblocks current page');
  await privatePage.locator('#private-protection-button[aria-pressed="false"]').waitFor();
  await privatePage.locator('#private-protection-button').click(); await wait(async () => await remote(memoryTab.webContentsId, 'typeof window.adRan') === 'undefined' && (await state(privatePage)).privateProtection.blocked === 2, 'resume reblocks page');
  await application.evaluate(({ webContents }, id) => webContents.fromId(id).openDevTools({ mode: 'detach' }), memoryTab.webContentsId);
  await wait(() => application.evaluate(({ webContents }, id) => webContents.fromId(id).isDevToolsOpened(), memoryTab.webContentsId), 'devtools opens');
  const stillAttached = await application.evaluate(({ webContents }, id) => webContents.fromId(id).debugger.isAttached(), memoryTab.webContentsId);
  if (process.env.LUNA_PRIVATE_DIAGNOSTICS) console.error('Private test before DevTools close', await application.evaluate(({ BrowserWindow, webContents }, id) => ({ pid: process.pid, windows: BrowserWindow.getAllWindows().map(win => ({ id: win.id, parent: win.getParentWindow()?.id })), target: webContents.fromId(id).getURL() }), memoryTab.webContentsId));
  await wait(async () => (await state(privatePage)).privateProtection.enabled === stillAttached, 'protection state matches the actual debugger connection');
  await application.evaluate(({ webContents }, id) => webContents.fromId(id).closeDevTools(), memoryTab.webContentsId);
  await wait(async () => (await state(privatePage)).privateProtection.enabled && (await state(privatePage)).privateProtection.blocked === 2 && await remote(memoryTab.webContentsId, 'typeof window.adRan') === 'undefined', 'closing devtools restores real interception');
  checks.push('default memory-only private session; real ad/tracker requests blocked, including worker and cross-origin iframe; ordinary requests untouched; DNT/GPC; per-tab pause/resume');
  await command(page, 'extensions'); await page.waitForSelector('#extensions-page:not([hidden])');
  const privateSwitch = page.getByRole('checkbox', { name: '允许 ' + extension.name + ' 在无痕中运行', exact: true });
  await privateSwitch.check(); await page.waitForSelector('#confirmation-dialog[open][data-kind="incognito-extension"]'); await (await dialogPage(page, '#confirmation-dialog[open]')).locator('#confirmation-cancel').click(); await wait(async () => !await privateSwitch.isChecked(), 'cancel authorization');
  await privateSwitch.check(); await acceptPrompt(page, 'incognito-extension'); await wait(async () => (await state(page)).extensions[0].allowIncognito, 'authorization saved');
  assert.equal((await state(privatePage)).extensions.length, 0, 'existing memory session remains memory-only');
  await page.screenshot({ path: path.join(root, 'artifacts/extension-incognito-settings.png') });
  await closeWindow(privatePage); privatePage = null;
  await command(page, 'activate', normalTab.id);
  const ordinaryPopup = await popup(page, extension.id); await ordinaryPopup.evaluate(() => chrome.storage.local.set({ normalSecret: 'must-not-cross' })); await ordinaryPopup.close();
  privatePage = await openPrivate(); await navigate(privatePage); const privateTab = await active(privatePage);
  await wait(async () => (await state(privatePage)).extensions.length === 1 && (await state(privatePage)).extensions[0].enabled, 'authorized private extension loaded');
  assert.equal((await state(privatePage)).privateProtection.extensionStorage, true);
  assert.equal(await remote(privateTab.webContentsId, 'document.documentElement.dataset.lunaExtension'), extension.id);
  assert.equal(await remote(privateTab.webContentsId, 'document.cookie.includes("normal=secret")'), false);
  const privateSessionDirectory = await application.evaluate(({ webContents }, id) => webContents.fromId(id).session.getStoragePath(), privateTab.webContentsId);
  const privatePopup = await popup(privatePage, extension.id);
  assert.equal(await privatePopup.evaluate(() => chrome.extension.inIncognitoContext), true, 'extension popup reports private context');
  assert.equal((await privatePopup.evaluate(() => chrome.storage.local.get('normalSecret'))).normalSecret, undefined);
  await privatePopup.evaluate(() => chrome.storage.local.set({ privateSecret: 'discard-me' }));
  const privateTabs = await privatePopup.evaluate(() => browser.tabs.query({})); assert.ok(privateTabs.every(tab => tab.incognito)); assert.ok(!privateTabs.some(tab => tab.id === normalTab.webContentsId));
  const privateWindows = await privatePopup.evaluate(() => browser.windows.getAll({ populate: true })); assert.ok(privateWindows.every(win => win.incognito));
  const cookies = await privatePopup.evaluate(() => browser.cookies.getAll({})); assert.ok(!cookies.some(cookie => cookie.name === 'normal'));
  const worker = await privatePopup.evaluate(() => chrome.runtime.sendMessage({ kind: 'luna-test' })); assert.equal(worker.count, 1, 'private worker only sees private tabs');
  const missing = await privatePopup.evaluate(id => browser.tabs.get(id), normalTab.webContentsId); assert.ok(!missing || !missing.url, 'private extension cannot fetch a normal tab');
  await privatePopup.close();
  await remote(privateTab.webContentsId, 'localStorage.setItem("private-secret","discard-me");document.cookie="private=discard-me;path=/"');
  const oldPrivateWindows = windows(); await command(privatePage, 'new-window'); let otherPrivate;
  await wait(() => { otherPrivate = windows().find(win => !oldPrivateWindows.includes(win)); return !!otherPrivate; }, 'second authorized private window');
  await otherPrivate.waitForSelector('.tab.selected'); await navigate(otherPrivate);
  assert.equal(await remote((await active(otherPrivate)).webContentsId, 'localStorage.getItem("private-secret")'), 'discard-me');
  assert.equal(await remote((await active(otherPrivate)).webContentsId, 'document.documentElement.dataset.lunaExtension'), extension.id);
  await closeWindow(otherPrivate);
  assert.equal((await state(privatePage)).extensions[0].enabled, true, 'closing one private window preserves the shared private extension runtime');
  checks.push('explicit authorization and cancel; isolated native content script/popup/worker; Cookie, storage, tabs/windows separated');
  await command(page, 'extension-incognito', { id: extension.id, allowed: false }); await wait(async () => (await state(privatePage)).extensions.length === 0, 'revocation unloads immediately');
  await command(privatePage, 'reload'); await wait(async () => !(await active(privatePage)).loading, 'reload after revoke'); assert.equal(await remote(privateTab.webContentsId, 'document.documentElement.dataset.lunaExtension'), undefined);
  await assert.rejects(command(privatePage, 'extension-incognito', { id: extension.id, allowed: true }), /普通窗口/);
  await closeWindow(privatePage); privatePage = null;
  const enabling = command(page, 'extension-incognito', { id: extension.id, allowed: true }); await page.waitForSelector('#confirmation-dialog[open][data-kind="incognito-extension"]'); await (await dialogPage(page, '#confirmation-dialog[open]')).locator('#confirmation-accept').click(); await enabling;
  await page.locator('#confirmation-dialog').waitFor({ state: 'hidden' }); await command(page, 'modal-state', false); await command(page, 'overlay', false);
  privatePage = await openPrivate(); await navigate(privatePage); const fresh = await active(privatePage);
  assert.notEqual(await application.evaluate(({ webContents }, id) => webContents.fromId(id).session.getStoragePath(), fresh.webContentsId), privateSessionDirectory);
  assert.equal(await remote(fresh.webContentsId, 'localStorage.getItem("private-secret")'), null);
  const freshPopup = await popup(privatePage, extension.id); assert.equal((await freshPopup.evaluate(() => chrome.storage.local.get('privateSecret'))).privateSecret, undefined); await freshPopup.close();
  await closeWindow(privatePage); privatePage = null;
  const persisted = fs.readFileSync(path.join(profile, 'browser-data.json'), 'utf8'); assert.ok(!persisted.includes('discard-me')); assert.ok(!persisted.includes(base + 'private')); assert.ok(!(await state(page)).history.some(entry => entry.url.startsWith(base + 'private')));
  const afterPopup = await popup(page, extension.id); assert.equal((await afterPopup.evaluate(() => chrome.storage.local.get('normalSecret'))).normalSecret, 'must-not-cross'); await afterPopup.close();
  checks.push('live revoke; private management rejected; final close resets website and extension data; normal storage preserved');
  const version = (await state(page)).version;
  await closeApp(application, page, false); application = null;
  await wait(() => !fs.readdirSync(path.join(profile, 'private-sessions')).length, 'temporary browser directories removed by native process-exit watcher');
  // Also verify next-start recovery and the independent Windows exit watcher.
  application = await electron.launch({ executablePath: process.env.LUNA_EXECUTABLE || require('electron'), args: process.env.LUNA_EXECUTABLE ? args : [root, ...args], env, timeout: 30000 });
  page = await application.firstWindow(); await page.waitForSelector('.tab.selected');
  assert.equal(fs.readdirSync(path.join(profile, 'private-sessions')).length, 0, 'startup removes previous process session directories');
  await closeApp(application, page, false); application = null;
  const probeRoot = path.join(profile, 'watcher-probe', 'private-sessions');
  await new Promise((resolve, reject) => {
    const probe = spawn(process.execPath, [path.join(root, 'tests/private-cleanup-probe.js'), probeRoot], { stdio: 'ignore' });
    probe.on('error', reject); probe.on('exit', code => code === 0 ? resolve() : reject(new Error('Cleanup watcher probe failed: ' + code)));
  });
  await wait(() => !fs.readdirSync(probeRoot).length, 'Windows cleanup helper removes its owner directories after process exit');
  checks.push('crash residue and previous browser temporary directories cleaned at startup; independent Windows process-exit cleanup watcher');
  fs.writeFileSync(path.join(root, 'artifacts/private-security-result.json'), JSON.stringify({ passed: true, version, checks, testedAt: new Date().toISOString() }, null, 2));
  assert.deepEqual(errors, []); console.log('PASS: ' + checks.join('; '));
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (application) await closeApp(application, page, false).catch(() => application.close().catch(() => {}));
  await new Promise(resolve => server.close(resolve)); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
