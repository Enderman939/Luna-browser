const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { closeApp } = require('./app-helpers');
const { popupPage } = require('./popover-helpers');
const root = path.resolve(__dirname, '..'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-download-notice-'));
const artifacts = path.join(root, 'artifacts');
let application, page, notice, base;
const payload = Buffer.alloc(1024 * 1024, 67), errors = [];
const server = http.createServer((request, response) => {
  if (request.url.endsWith('.txt')) {
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="completed-file.txt"' });
    response.end('Synthetic completed download'); return;
  }
  if (request.url.endsWith('.zip')) {
    const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range || ''), start = range ? Number(range[1]) : 0, end = range ? Number(range[2]) : payload.length - 1;
    response.writeHead(range ? 206 : 200, { 'Content-Type': 'application/octet-stream', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ETag: '"notice-fixture"', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${payload.length}` } : {}) });
    response.end(payload.subarray(start, end + 1)); return;
  }
  response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><title>Live webpage below download notice</title><style>body{background:#164b85;color:white;font:24px sans-serif;padding:40px}</style><h1>Live webpage</h1><a id="download" href="/native.txt">Download</a><input id="draft" value="unsaved input"><script>window.ticks=0;setInterval(()=>window.ticks++,40)</script>');
});
const command = (action, payload, target = page) => target.evaluate(({ action, payload }) => window.browser.command(action, payload), { action, payload });
const state = target => command('state', undefined, target || page);
async function wait(predicate, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw new Error('Timed out: ' + label);
}
async function focus(target = page) { await application.evaluate(({ BrowserWindow }, id) => { const parent = BrowserWindow.fromId(id); parent.show(); parent.focus(); }, (await state(target)).windowId); }
async function card(target = page) {
  const owner = String((await state(target)).windowId);
  await wait(async () => {
    for (const window of application.windows()) if (!window.isClosed() && window.url().endsWith('/download-notice.html') && await window.locator('body').getAttribute('data-owner') === owner) { notice = window; return true; }
    return false;
  }, 'owned download notice');
  await notice.waitForSelector('#filename:not(:empty)'); return notice;
}
const nativeDownload = async target => {
  const current = await state(target || page), tab = current.tabs.find(tab => tab.id === current.activeId);
  return application.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScript('document.getElementById("download").click()'), tab.webContentsId);
};
async function assertBrowserPalette(label, { background, theme } = {}) {
  const matches = async () => {
    const expected = await page.evaluate(() => {
      const menu = getComputedStyle(document.querySelector('#panel'));
      const primary = getComputedStyle(document.querySelector('#homepage-form .primary-button'));
      return { background: menu.backgroundColor, ink: menu.color, border: menu.getPropertyValue('--line').trim(),
        muted: menu.getPropertyValue('--muted').trim(), soft: menu.getPropertyValue('--soft').trim(), hover: menu.getPropertyValue('--hover').trim(),
        primary: primary.backgroundColor, primaryInk: primary.color };
    });
    if (background && expected.background !== background) return false;
    return notice.evaluate(({ expected, theme }) => {
      const card = getComputedStyle(document.querySelector('#download-notice')), root = getComputedStyle(document.documentElement), primary = getComputedStyle(document.querySelector('#open-file'));
      return (!theme || document.documentElement.dataset.theme === theme) && card.backgroundColor === expected.background && card.color === expected.ink
        && root.getPropertyValue('--line').trim() === expected.border && root.getPropertyValue('--muted').trim() === expected.muted
        && root.getPropertyValue('--soft').trim() === expected.soft && root.getPropertyValue('--hover').trim() === expected.hover
        && primary.backgroundColor === expected.primary && primary.color === expected.primaryInk;
    }, { expected, theme });
  };
  await wait(matches, label + ' matches browser menu and button colors').catch(async error => {
    for (const [name, target, selector] of [['browser', page, '#panel'], ['notice', notice, '#download-notice']]) console.error(name, await target.evaluate(selector => {
      const element = getComputedStyle(document.querySelector(selector)), button = getComputedStyle(document.querySelector(selector === '#panel' ? '#homepage-form .primary-button' : '#open-file'));
      return { theme: document.documentElement.dataset.theme, background: element.backgroundColor, ink: element.color,
        vars: Object.fromEntries(['--line', '--muted', '--soft', '--hover', '--accent', '--on-accent'].map(name => [name, element.getPropertyValue(name)])), primary: button.backgroundColor, primaryInk: button.color };
    }, selector)); throw error;
  });
}
async function run() {
  fs.mkdirSync(artifacts, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = 'http://127.0.0.1:' + server.address().port;
  const env = { ...process.env, LUNA_USER_DATA: path.join(directory, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ executablePath: process.env.LUNA_EXECUTABLE || require('electron'), args: process.env.LUNA_EXECUTABLE ? ['--no-proxy-server'] : [root, '--no-proxy-server'], env });
  page = await application.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.waitForSelector('.tab.selected');
  await application.evaluate(({ app, dialog }, directory) => {
    app.setPath('downloads', directory);
    globalThis.__noticeOpen = []; globalThis.__noticeReveal = []; globalThis.__nativeNoticeCount = 0;
    const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    const electron = require('electron'); electron.shell.openPath = async file => { globalThis.__noticeOpen.push(file); return ''; };
    electron.shell.showItemInFolder = file => globalThis.__noticeReveal.push(file);
    electron.Notification.isSupported = () => true;
    electron.Notification.prototype.show = function() { globalThis.__nativeNoticeCount++; };
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  }, path.join(directory, 'files'));
  await command('choose-download-path'); await command('navigate', base);
  await wait(async () => !(await state()).tabs[0].loading, 'live webpage loaded'); await focus();
  await page.locator('#address').focus();
  await nativeDownload(); await card();
  await wait(async () => (await state()).completedDownloads === 1, 'completion badge state');
  await page.locator('#downloads-button.download-completed[data-completed="1"]').waitFor();
  assert.equal(await notice.locator('#filename').textContent(), 'completed-file.txt');
  const info = await application.evaluate(({ BrowserWindow, webContents }) => {
    const popup = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/download-notice.html'));
    return { visible: popup.isVisible(), focused: popup.isFocused(), parent: popup.getParentWindow()?.id, bounds: popup.getBounds(), focusedType: BrowserWindow.getFocusedWindow()?.webContents.getURL(), focusedWeb: webContents.getFocusedWebContents()?.getURL() };
  });
  assert.equal(info.visible, true); assert.equal(info.focused, false); assert.equal(info.parent, (await state()).windowId);
  assert.equal(await page.locator('#address').evaluate(input => input === document.activeElement), true, 'completion does not steal address input focus');
  assert.equal(await notice.evaluate(() => typeof window.browser), 'undefined', 'notice has no browser command bridge');
  await assertBrowserPalette('light completion card', { background: 'rgb(255, 255, 255)', theme: 'light' });
  const tickBefore = await application.evaluate(({ webContents }, base) => webContents.getAllWebContents().find(web => web.getURL() === base + '/').executeJavaScript('window.ticks'), base);
  await new Promise(resolve => setTimeout(resolve, 4000));
  assert.equal(await notice.locator('#download-notice').isVisible(), true, 'card outlasts the old 3.4-second text toast');
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/download-notice.html')).isVisible()), true);
  const tickAfter = await application.evaluate(({ webContents }, base) => webContents.getAllWebContents().find(web => web.getURL() === base + '/').executeJavaScript('window.ticks'), base);
  assert.ok(tickAfter > tickBefore);
  await notice.screenshot({ path: path.join(artifacts, 'download-completion-card-light.png') });
  await notice.locator('#open-file').click(); await wait(() => application.evaluate(() => globalThis.__noticeOpen.length === 1), 'open completed file');

  await focus(); await command('new-download', base + '/managed.zip'); await card();
  await wait(async () => await notice.locator('#filename').textContent() === 'managed.zip', 'segmented download card');
  assert.equal((await state()).completedDownloads, 2); await notice.locator('#completion-count').waitFor({ state: 'visible' });
  await command('update-settings', { theme: 'dark' }); await wait(async () => await notice.locator('html').getAttribute('data-theme') === 'dark', 'dark card theme');
  await assertBrowserPalette('dark completion card', { background: 'rgb(51, 51, 51)', theme: 'dark' });
  await notice.screenshot({ path: path.join(artifacts, 'download-completion-card-dark.png') });
  await command('appearance-update', { section: 'regions', key: 'menu', values: { color: '#643b6f' } });
  await command('appearance-update', { section: 'regions', key: 'surface', values: { color: '#e8dccc' } });
  await assertBrowserPalette('custom dark menu color independent of surface color', { background: 'rgb(100, 59, 111)', theme: 'dark' });
  await notice.screenshot({ path: path.join(artifacts, 'download-completion-card-custom-dark.png') });
  await command('update-settings', { theme: 'light' });
  await command('appearance-update', { section: 'regions', key: 'menu', values: { color: '#eedac8' } });
  await assertBrowserPalette('custom light completion card', { background: 'rgb(238, 218, 200)', theme: 'light' });
  await notice.screenshot({ path: path.join(artifacts, 'download-completion-card-custom-light.png') });
  await command('appearance-update', { section: 'regions', key: 'menu', values: { color: '' } });
  await command('appearance-update', { section: 'regions', key: 'surface', values: { color: '' } });
  await command('update-settings', { theme: 'system' });
  const systemDark = (await state()).dark;
  await assertBrowserPalette('follow system theme', { background: systemDark ? 'rgb(51, 51, 51)' : 'rgb(255, 255, 255)', theme: systemDark ? 'dark' : 'light' });
  await notice.locator('#reveal-file').click(); await wait(() => application.evaluate(() => globalThis.__noticeReveal.length === 1), 'reveal completed file');
  await page.locator('#downloads-button').click(); const downloads = await popupPage(application, 'downloads'); await downloads.waitForSelector('.download-entry');
  await wait(async () => (await state()).completedDownloads === 0, 'viewing downloads clears badge'); await command('popover-close');

  const countBefore = await application.evaluate(() => globalThis.__nativeNoticeCount);
  await application.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).minimize(), (await state()).windowId);
  await wait(async () => application.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isMinimized(), (await state()).windowId), 'browser minimized');
  await nativeDownload(); await wait(async () => (await state()).completedDownloads === 1, 'background completion');
  await wait(() => application.evaluate((_, before) => globalThis.__nativeNoticeCount === before + 1, countBefore), 'background system notification').catch(async error => {
    console.error('Background notice diagnostics', { before: countBefore }, await application.evaluate(({ BrowserWindow }) => ({ notifications: globalThis.__nativeNoticeCount, focused: BrowserWindow.getFocusedWindow()?.webContents.getURL(), windows: BrowserWindow.getAllWindows().map(window => ({ url: window.webContents.getURL(), visible: window.isVisible(), minimized: window.isMinimized() })) }))); throw error;
  });
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/download-notice.html')).isVisible()), false);
  await application.evaluate(({ BrowserWindow }, id) => { const parent = BrowserWindow.fromId(id); parent.restore(); parent.focus(); }, (await state()).windowId);
  await wait(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.webContents.getURL().endsWith('/download-notice.html') && window.isVisible())), 'returning to browser shows missed completion card');
  await command('update-settings', { downloadNotifications: false }); await wait(async () => (await state()).completedDownloads === 0, 'disabled reminders clear badge');
  const beforeDisabled = (await state()).downloads.length;
  await nativeDownload(); await wait(async () => (await state()).downloads.length === beforeDisabled + 1 && (await state()).downloads.at(-1).status === 'completed', 'silent completed download');
  assert.equal((await state()).completedDownloads, 0); assert.equal(await application.evaluate(() => globalThis.__nativeNoticeCount), countBefore + 1);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/download-notice.html')).isVisible()), false);
  await command('update-settings', { downloadNotifications: true }); await command('private-window');
  let privatePage;
  await wait(() => { privatePage = application.windows().find(window => window !== page && !window.isClosed() && window.url().endsWith('/index.html')); return !!privatePage; }, 'private window');
  await privatePage.waitForSelector('.tab.selected'); await command('navigate', base, privatePage);
  await wait(async () => !(await state(privatePage)).tabs[0].loading, 'private webpage'); await focus(privatePage);
  await nativeDownload(privatePage); await card(privatePage);
  assert.equal((await state(privatePage)).completedDownloads, 1); assert.equal((await state()).completedDownloads, 0, 'private completion stays in its own window');
  assert.equal(await application.evaluate(() => globalThis.__nativeNoticeCount), countBefore + 1, 'private filename is never sent to system notifications');
  await command('close-window', undefined, privatePage); await wait(() => privatePage.isClosed(), 'private close');
  assert.deepEqual(errors, []);
  const version = (await state()).version;
  await closeApp(application, page, false); application = null;
  const checks = ['native and segmented completion cards owned above live website', 'no input focus theft and webpage keeps running', '12-second card and completion badge', 'open/reveal actions and restricted notice bridge', 'exact browser download-panel and primary-button colors across light/dark/custom/system themes', 'live theme and custom palette updates without reloading the card', 'background system notification and card on return', 'opening downloads clears badge', 'reminder setting disables card/badge/system notification', 'private completion isolated to private window without system notification'];
  const result = { passed: true, version, checks, testedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(artifacts, 'download-notifications-result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (application) { await notice?.screenshot({ path: path.join(artifacts, 'download-notifications-failure.png') }).catch(() => {}); await application.evaluate(({ app }) => app.exit(1)).catch(() => {}); await application.close().catch(() => {}); }
  await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
