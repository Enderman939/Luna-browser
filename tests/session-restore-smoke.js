const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { closeApp } = require('./app-helpers');
const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-restore-pages-'));
let application, page;
const requests = [];
const server = http.createServer((request, response) => {
  requests.push(request.url);
  if (request.url === '/failed') { request.socket.destroy(); return; }
  const title = 'Restored ' + request.url;
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  setTimeout(() => response.end(`<!doctype html><title>${title}</title><main id="restored">${title}</main><script>window.restoredReady=true;setInterval(()=>window.restoredTick=(window.restoredTick||0)+1,50)</script>`), request.url === '/slow' ? 400 : 5);
});
async function wait(predicate, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('Timed out: ' + label);
}
const state = () => page.evaluate(() => window.browser.command('state'));
async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const profile = path.join(scratch, 'profile'), fixture = path.join(scratch, 'fixture');
  fs.mkdirSync(profile); fs.mkdirSync(fixture);
  const urls = [base + '/first', base + '/slow', base + '/first', 'luna://newtab', base + '/last', base + '/failed'];
  fs.writeFileSync(path.join(profile, 'browser-data.json'), JSON.stringify({ settings: { startup: 'restore', autoUpdate: false }, sessionWindows: [{ urls, activeIndex: 4, pinned: [0], groups: [{ name: 'Restored', indices: [1, 2], color: 'blue' }] }] }));
  // Reproduce a startup load cancellation that is only reported by loadURL's
  // rejected promise, not did-fail-load. No production environment override.
  fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'luna-restore-fixture', version: require('../package.json').version, main: 'main.cjs' }));
  fs.writeFileSync(path.join(fixture, 'main.cjs'), `
    const {app}=require('electron');
    app.on('web-contents-created',(_,web)=>{
      const original=web.loadURL.bind(web);let first=true;
      web.loadURL=(url,...args)=>{
        if(first&&url.startsWith(${JSON.stringify(base)})){
          first=false;return Promise.reject(Object.assign(new Error('ERR_ABORTED: restore initialization cancelled'),{code:'ERR_ABORTED',errno:-3}));
        }
        return original(url,...args);
      };
    });
    require(${JSON.stringify(path.join(root, 'src/main.js'))});
  `);
  const env = { ...process.env, LUNA_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const faultMode = !process.env.LUNA_EXECUTABLE;
  application = await electron.launch({ executablePath: process.env.LUNA_EXECUTABLE || require('electron'), args: faultMode ? [fixture, '--no-proxy-server'] : ['--no-proxy-server'], env, timeout: 30000 });
  page = await application.firstWindow(); await page.waitForSelector('.tab.selected');
  await wait(async () => (await state()).tabs.length === urls.length, 'all saved tabs created');
  for (const index of [0, 1, 2, 4]) {
    await wait(async () => { const tab = (await state()).tabs[index]; return !tab.loading && !tab.error && tab.title === 'Restored ' + new URL(urls[index]).pathname; }, 'live restored page at index ' + index);
    const tab = (await state()).tabs[index];
    const documentState = await application.evaluate(({webContents}, id) => webContents.fromId(id).executeJavaScript('({url:location.href,text:document.querySelector("#restored")?.textContent,ready:window.restoredReady,bridge:typeof window.browser})', true), tab.webContentsId);
    assert.deepEqual(documentState, { url: urls[index], text: tab.title, ready: true, bridge: 'undefined' });
    await page.evaluate(id => window.browser.command('activate', id), tab.id);
  }
  await wait(async () => !!(await state()).tabs[5].error, 'failed restored page shows an error instead of a blank tab');
  const current = await state();
  assert.deepEqual(current.tabs.map(tab => tab.url), urls);
  assert.equal(current.tabs[0].pinned, true); assert.equal(current.groups[0].name, 'Restored');
  assert.equal(requests.filter(url => url === '/first').length, 2, 'duplicate URLs each restore a distinct page');
  assert.equal(requests.filter(url => url === '/last').length, 1, 'successful pages are not loaded twice');
  await page.evaluate(id => window.browser.command('activate', id), current.tabs[4].id);
  const ticks = await application.evaluate(({webContents}, id) => webContents.fromId(id).executeJavaScript('window.restoredTick||0', true), current.tabs[4].webContentsId);
  await wait(async () => (await application.evaluate(({webContents}, id) => webContents.fromId(id).executeJavaScript('window.restoredTick||0', true), current.tabs[4].webContentsId)) > ticks + 1, 'restored document keeps running after selection');
  // A screenshot of the UI renderer excludes native WebContentsView children.
  // Check the restored view itself, then composite its pixels into the preview.
  const frame = await application.evaluate(async ({BrowserWindow}, args) => {
    const win = BrowserWindow.fromId(args.windowId);
    const view = win.contentView.children.find(view => view.webContents?.id === args.webId);
    if (!view) throw new Error('Restored native view was not attached to its window');
    const image = await view.webContents.capturePage();
    const bitmap = image.toBitmap(); let painted = 0;
    for (let i = 0; i < bitmap.length; i += 4) if (Math.min(bitmap[i], bitmap[i+1], bitmap[i+2]) < 180 && bitmap[i+3] > 0) painted++;
    return { visible: view.getVisible(), bounds: view.getBounds(), painted, image: image.toDataURL(), ui: (await win.webContents.capturePage()).toDataURL(), size: win.getContentSize() };
  }, { windowId: current.windowId, webId: current.tabs[4].webContentsId });
  assert.equal(frame.visible, true, 'active restored native webpage is visible');
  assert.ok(frame.bounds.width > 500 && frame.bounds.height > 200, 'restored webpage has usable bounds');
  assert.ok(frame.painted > 100, 'restored document paints content, not an empty white frame');
  const composite = await page.evaluate(async frame => {
    const canvas = document.createElement('canvas'); [canvas.width, canvas.height] = frame.size;
    const context = canvas.getContext('2d');
    for (const part of [{ source: frame.ui, box: { x: 0, y: 0, width: canvas.width, height: canvas.height } }, { source: frame.image, box: frame.bounds }]) {
      const image = new Image(); image.src = part.source; await image.decode();
      context.drawImage(image, part.box.x, part.box.y, part.box.width, part.box.height);
    }
    return canvas.toDataURL('image/png').split(',')[1];
  }, frame);
  fs.writeFileSync(path.join(root, 'artifacts/session-restore-live.png'), Buffer.from(composite, 'base64'));
  await closeApp(application, page, false); application = null;
  const report = { passed: true, version: require('../package.json').version, mode: faultMode ? 'source startup cancellation injected' : 'packaged cold restoration', checks: ['cold startup restored real HTML and script execution', 'active native view is visible and paints document pixels', 'background and active pages load', 'duplicate URL tabs load independently', 'new-tab, pinned and group metadata retained', 'failed restore surfaces an error', 'successful pages are not reloaded twice'], testedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(root, faultMode ? 'artifacts/session-restore-fault-result.json' : 'artifacts/session-restore-result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('PASS ' + report.mode + ': ' + report.checks.join('; '));
}
run().catch(async error => { console.error(error); if (page && !page.isClosed()) { console.error('restored tabs', JSON.stringify((await state()).tabs.map(({id,url,title,loading,error}) => ({id,url,title,loading,error})))); console.error('web contents', await application.evaluate(({webContents}) => webContents.getAllWebContents().map(web => ({id:web.id,url:web.getURL(),loading:web.isLoading()})))); } process.exitCode = 1; }).finally(async () => {
  if (application) { await application.evaluate(({app}) => app.exit(1)).catch(() => {}); await application.close().catch(() => {}); }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  fs.rmSync(scratch, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
});
