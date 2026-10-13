const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { closeApp, acceptPrompt } = require('./app-helpers');
const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-security-'));
const probe = process.argv.includes('--probe'), findings = {};
let application, page, base;
const server = http.createServer((request, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><title>Security fixture</title><p>Public webpage</p>'); });
async function wait(fn, label) { const started = Date.now(); while (Date.now() - started < 15000) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 40)); } throw new Error('Timed out: ' + label); }
const command = (action, payload) => page.evaluate(({ action, payload }) => window.browser.command(action, payload), { action, payload });
const state = () => command('state');
const evaluate = (id, code) => application.evaluate(({ webContents }, { id, code }) => webContents.fromId(id).executeJavaScript(code, true), { id, code });
async function install(name, permissions = [], hosts = []) {
  const directory = path.join(profile, name); fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ manifest_version: 3, name, version: '1.0.0', permissions, host_permissions: hosts, options_page: 'options.html', action: { default_popup: 'options.html' } }));
  fs.writeFileSync(path.join(directory, 'options.html'), '<!doctype html><title>' + name + '</title><p>Security fixture extension</p>');
  await application.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, directory);
  const importing = command('extension-load-directory'); await acceptPrompt(page, 'permissions'); await importing;
  const extension = (await state()).extensions.find(extension => extension.name === name);
  await command('extension-options', extension.id); await wait(async () => (await state()).tabs.some(tab => tab.url.endsWith(extension.id + '/options.html') && !tab.loading), 'extension page');
  const tab = (await state()).tabs.find(tab => tab.url.endsWith(extension.id + '/options.html'));
  return { ...extension, tabId: tab.id, webId: tab.webContentsId };
}
async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = 'http://127.0.0.1:' + server.address().port;
  const legacyFile = path.join(profile, 'legacy-download.txt'), legacyId = '11111111-1111-4111-8111-111111111111';
  fs.writeFileSync(legacyFile, 'Safe legacy download fixture');
  fs.writeFileSync(path.join(profile, 'download-jobs.json'), JSON.stringify([{ id: legacyId, url: base + '/legacy.txt', file: legacyFile, name: 'legacy-download.txt', mode: 'single', status: 'completed', threads: [], total: 28, received: 28, createdAt: Date.now(), speedLimit: 0, completion: 'none' }]));
  const env = { ...process.env, LUNA_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ executablePath: process.env.LUNA_EXECUTABLE || require('electron'), args: process.env.LUNA_EXECUTABLE ? ['--disable-gpu'] : [root, '--disable-gpu'], env, timeout: 30000 });
  page = await application.firstWindow(); await page.waitForSelector('.tab.selected');
  await command('navigate', base + '/?private=test-token'); await wait(async () => (await state()).tabs[0].title === 'Security fixture', 'web page');
  const original = (await state()).tabs[0];
  findings.webpageIsolation = await evaluate(original.webContentsId, '({node:typeof require,browser:typeof window.browser?.command,tools:typeof window.pageTool,menu:typeof window.contextMenu})');
  const preferences = await application.evaluate(({ webContents }, id) => { const p = webContents.fromId(id).getLastWebPreferences(); return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, webSecurity: p.webSecurity, allowRunningInsecureContent: p.allowRunningInsecureContent }; }, original.webContentsId);
  findings.webPreferences = preferences;
  if (!probe && process.platform === 'win32') {
    await application.evaluate(({ shell }) => { shell.openPath = async file => { globalThis.__auditOpenedFile = file; return ''; }; });
    await command('download-action', { id: legacyId, action: 'open' });
    assert.match(fs.readFileSync(legacyFile + ':Zone.Identifier', 'utf8'), /ZoneId=3/);
    assert.equal(await application.evaluate(() => globalThis.__auditOpenedFile), legacyFile, 'legacy downloads are marked before opening');
  }
  await application.evaluate(async ({ session }, base) => {
    await session.fromPartition('persist:luma-web').cookies.set({ url: base, name: 'security_allowed', value: 'fixture-only', httpOnly: true });
    await session.fromPartition('persist:luma-web').cookies.set({ url: 'http://localhost/', name: 'security_forbidden', value: 'fixture-only', httpOnly: true });
  }, base);
  await application.evaluate(({ session }) => { session.fromPartition('persist:luma-web').protocol.handle('https', request => new URL(request.url).hostname === 'chromewebstore.google.com' ? new Response('<!doctype html><title>Store security fixture</title><h1>Store</h1>', { headers: { 'Content-Type': 'text/html' } }) : new Response('<!doctype html><title>Other origin fixture</title><p>Other origin</p>', { headers: { 'Content-Type': 'text/html' } })); });
  const unprivileged = await install('No permissions extension');
  const cookies = await evaluate(unprivileged.webId, 'chrome.cookies.getAll({})');
  findings.unprivilegedCookies = Array.isArray(cookies) ? cookies.map(cookie => ({ name: cookie.name, httpOnly: cookie.httpOnly })) : [];
  const tabs = await evaluate(unprivileged.webId, 'chrome.tabs.query({})');
  findings.unprivilegedTabDetails = tabs.find(tab => tab.id === original.webContentsId);
  const sentinel = path.join(profile, 'private-local.txt'); fs.writeFileSync(sentinel, 'LUNA_PRIVATE_LOCAL_TEST');
  await evaluate(unprivileged.webId, 'chrome.tabs.update(' + original.webContentsId + ',{url:' + JSON.stringify(pathToFileURL(sentinel).href) + '})');
  findings.extensionFileNavigation = await application.evaluate(({ webContents }, id) => webContents.fromId(id).getURL().startsWith('file:'), original.webContentsId);
  await command('activate', original.id); await command('navigate', base + '/?private=test-token');
  await wait(async () => application.evaluate(({ webContents }, { id, base }) => webContents.fromId(id).getURL().startsWith(base), { id: original.webContentsId, base }), 'restore normal page');
  const scoped = await install('Scoped cookies extension', ['cookies'], ['http://127.0.0.1/*']);
  const scopedCookies = await evaluate(scoped.webId, 'chrome.cookies.getAll({})');
  findings.scopedCookies = (scopedCookies || []).map(cookie => cookie.name);
  if (!probe) {
    await evaluate(unprivileged.webId, 'window.auditCookies=[]; chrome.cookies.onChanged.addListener(info=>auditCookies.push(info.cookie.name)); window.auditTabs=[]; chrome.tabs.onUpdated.addListener((id,changes,tab)=>auditTabs.push({id,changes,tab}));');
    await evaluate(scoped.webId, 'window.auditCookies=[]; chrome.cookies.onChanged.addListener(info=>auditCookies.push(info.cookie.name));');
    await application.evaluate(async ({ session }, base) => {
      await session.fromPartition('persist:luma-web').cookies.set({ url: base, name: 'event_allowed', value: 'fixture-only', httpOnly: true });
      await session.fromPartition('persist:luma-web').cookies.set({ url: 'http://localhost/', name: 'event_forbidden', value: 'fixture-only', httpOnly: true });
    }, base);
    await wait(async () => (await evaluate(scoped.webId, 'auditCookies')).includes('event_allowed'), 'permitted Cookie event');
    assert.deepEqual(await evaluate(unprivileged.webId, 'auditCookies'), [], 'unprivileged extension receives no Cookie events');
    assert.equal((await evaluate(scoped.webId, 'auditCookies')).includes('event_forbidden'), false);
    await command('activate', original.id); await command('navigate', base + '/?private=next-test-token');
    await wait(async () => await evaluate(unprivileged.webId, 'auditTabs.some(event=>event.id===' + original.webContentsId + ')'), 'tab event');
    const tabEvents = await evaluate(unprivileged.webId, 'auditTabs.filter(event=>event.id===' + original.webContentsId + ')');
    for (const event of tabEvents) for (const field of ['url', 'title', 'favIconUrl', 'pendingUrl']) { assert.equal(event.changes[field], undefined); assert.equal(event.tab[field], undefined); }
    const windows = await evaluate(unprivileged.webId, 'chrome.windows.getAll({populate:true})');
    for (const window of windows) for (const tab of window.tabs || []) for (const field of ['url', 'title', 'favIconUrl', 'pendingUrl']) assert.equal(tab[field], undefined);
    await evaluate(scoped.webId, 'chrome.cookies.set({url:"http://localhost/",name:"forbidden_write",value:"test"})');
    assert.equal(await application.evaluate(async ({ session }) => (await session.fromPartition('persist:luma-web').cookies.get({name:'forbidden_write'})).length), 0);
    assert.notEqual(await evaluate(unprivileged.webId, 'chrome.permissions.request({origins:["<all_urls>"]})'), true, 'undeclared optional hosts are rejected before a prompt');
    await evaluate(scoped.webId, 'chrome.permissions.remove({permissions:["cookies"]})');
    assert.equal(await evaluate(scoped.webId, 'chrome.cookies.getAll({})'), undefined, 'revoking permission blocks future calls');
    // This test-only preload lets us challenge the main-process identity check
    // directly, even if a renderer acquired an arbitrary IPC transport.
    const auditPreload = path.join(profile, 'audit-preload.js');
    fs.writeFileSync(auditPreload, 'const {contextBridge,ipcRenderer}=require("electron");contextBridge.exposeInMainWorld("auditIPC",{invoke:(...args)=>ipcRenderer.invoke(...args)});');
    const attackId = await application.evaluate(async ({ BrowserWindow, session }, { preload, url }) => {
      const window = new BrowserWindow({show:false,webPreferences:{session:session.fromPartition('persist:luma-web'),preload,sandbox:true,contextIsolation:true,nodeIntegration:false}});
      await window.loadURL(url); return window.webContents.id;
    }, { preload: auditPreload, url: base });
    assert.equal(await evaluate(attackId, `(async()=>{try{await auditIPC.invoke('crx-msg',${JSON.stringify(scoped.id)},'tabs.query',{});return true;}catch{return false;}})()`), false, 'main process refuses a webpage pretending to be an extension');
    assert.equal(await evaluate(attackId, `(async()=>{try{await auditIPC.invoke('crx-msg-remote','persist:luma-web','browserAction.getState');return true;}catch{return false;}})()`), false, 'remote action APIs require a trusted browser renderer');
    await application.evaluate(({ BrowserWindow, webContents }, id) => BrowserWindow.fromWebContents(webContents.fromId(id)).destroy(), attackId);
    const active = await install('Active tab extension', ['activeTab']);
    assert.equal((await evaluate(active.webId, 'chrome.tabs.get(' + original.webContentsId + ')')).url, undefined);
    await command('activate', original.id); await command('extension-launch', { id: active.id, rect: {x:400,y:50,width:32,height:32} });
    assert.ok((await evaluate(active.webId, 'chrome.tabs.get(' + original.webContentsId + ')')).url.startsWith(base));
    await page.locator('#address').click();
    await command('new-tab', base); const siblingState = await state(), sibling = siblingState.tabs.find(tab => tab.id === siblingState.activeId);
    await wait(async () => (await state()).tabs.find(tab => tab.id === sibling.id).loading === false, 'sibling tab');
    assert.equal((await evaluate(active.webId, 'chrome.tabs.get(' + sibling.webContentsId + ')')).url, undefined, 'activeTab does not authorize a second tab on the same site');
    await command('close-tab', sibling.id); await command('activate', original.id);
    await command('navigate', 'https://example.invalid/');
    await wait(async () => !(await state()).tabs.find(tab => tab.id === original.id).loading, 'cross-origin navigation finishes');
    assert.equal((await evaluate(active.webId, 'chrome.tabs.get(' + original.webContentsId + ')')).url, undefined, 'cross-origin navigation revokes temporary metadata access');
  }
  await command('new-tab', 'https://chromewebstore.google.com/detail/test/' + unprivileged.id);
  let storeTab; await wait(async () => { storeTab = (await state()).tabs.find(tab => tab.title === 'Store security fixture'); return !!storeTab; }, 'store fixture');
  await wait(async () => await evaluate(storeTab.webContentsId, 'typeof window.lunaStore?.call') === 'function', 'store bridge');
  findings.storeImpersonation = await evaluate(storeTab.webContentsId, `(async () => { try { const cookies = await lunaStore.call('crx-msg',${JSON.stringify(unprivileged.id)},'cookies.getAll',{}); return {allowed:true,cookieCount:cookies?.length || 0}; } catch { return {allowed:false}; } })()`);
  findings.storeBrowserCommand = await evaluate(storeTab.webContentsId, `(async () => { try { await lunaStore.call('browser:command','state'); return true; } catch { return false; } })()`);
  if (!probe) {
    findings.additionalChecks = ['Cookie events scoped by permission and host', 'tab events and populated windows hide private metadata', 'cross-host Cookie writes blocked', 'undeclared optional hosts blocked', 'revocation enforced', 'main-process IPC caller authenticated', 'remote action API restricted', 'activeTab grant restricted to one tab and revoked across origins', 'legacy managed downloads marked before opening'];
  }
  if (!probe) {
    assert.deepEqual(findings.webpageIsolation, { node: 'undefined', browser: 'undefined', tools: 'undefined', menu: 'undefined' });
    assert.deepEqual(preferences, { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false });
    assert.deepEqual(findings.unprivilegedCookies, []);
    for (const field of ['url', 'title', 'favIconUrl', 'pendingUrl']) assert.equal(findings.unprivilegedTabDetails[field], undefined);
    assert.equal(findings.extensionFileNavigation, false);
    assert.deepEqual(findings.scopedCookies, ['security_allowed']);
    assert.equal(findings.storeImpersonation.allowed, false);
    assert.equal(findings.storeBrowserCommand, false);
  }
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts', probe ? 'security-before.json' : 'security-after.json'), JSON.stringify({ version: (await state()).version, passed: !probe, testedAt: new Date().toISOString(), findings }, null, 2));
  console.log(JSON.stringify(findings, null, 2));
  await closeApp(application, page, false); application = null;
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (application) await closeApp(application, page, false).catch(() => application.process().kill());
  await new Promise(resolve => server.close(resolve)); fs.rmSync(profile, { recursive: true, force: true });
});
