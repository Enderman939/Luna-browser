const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { closeApp } = require('./app-helpers');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-tab-window-'));
let application, page;
const posts = [];
const server = http.createServer(async (request, response) => {
  let body = ''; for await (const chunk of request) body += chunk;
  if (request.method === 'POST') posts.push(body);
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><title>Tab fixture</title><input id="field"><a id="link" href="/child" target="_blank">new tab</a><script>window.marker=123</script>');
});
const command = (target, action, payload) => target.evaluate(args => window.browser.command(args.action, args.payload), { action, payload });
const state = target => command(target, 'state');
async function wait(fn, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 60)); }
  throw new Error('Timed out: ' + label);
}
const remote = (id, code) => application.evaluate(({ webContents }, args) => webContents.fromId(args.id).executeJavaScript(args.code, true), { id, code });
function windows() { return application.windows().filter(target => !target.isClosed() && /\/index\.html$/.test(target.url())); }
async function active(target) { const current = await state(target); return current.tabs.find(tab => tab.id === current.activeId); }
async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const env = { ...process.env, LUNA_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ executablePath: process.env.LUNA_EXECUTABLE || require('electron'), args: process.env.LUNA_EXECUTABLE ? [] : [root], env, timeout: 30000 });
  await application.evaluate(() => { globalThis.__tabErrors = []; process.on('uncaughtException', error => globalThis.__tabErrors.push(error.stack)); });
  page = await application.firstWindow(); await page.waitForSelector('.tab.selected');
  await command(page, 'navigate', base + '/parent');
  await wait(async () => !(await active(page)).loading && (await active(page)).url === base + '/parent', 'parent page');
  const parent = await active(page);
  await remote(parent.webContentsId, 'window.received=[];addEventListener("message",e=>window.received.push(e.data));true');
  // Both native guest creation and the link path must survive without replacing
  // Electron's supplied WebContents with a different object.
  for (const code of ["document.getElementById('link').click();true", `window.child=window.open('${base}/script-child','script-child');true`, "window.child=window.open('about:blank','blank-child');true"]) {
    const count = (await state(page)).tabs.length;
    await remote(parent.webContentsId, code);
    await wait(async () => (await state(page)).tabs.length === count + 1, 'new popup tab');
    const child = await active(page);
    if (code.includes('about:blank')) await remote(parent.webContentsId, `window.child.location='${base}/blank-navigation';true`);
    await wait(async () => { const current = (await state(page)).tabs.find(tab => tab.id === child.id); return current.url.startsWith(base) && !current.loading; }, 'child navigation');
    if (!code.includes("getElementById('link')")) {
      await remote(child.webContentsId, `window.opener.postMessage('from-child','${base}');true`);
      await wait(async () => (await remote(parent.webContentsId, 'window.received.length')) > 0, 'opener postMessage');
      await remote(parent.webContentsId, 'window.received=[];true');
    }
    await remote(child.webContentsId, 'window.close();true').catch(() => {});
    await wait(async () => !(await state(page)).tabs.some(tab => tab.id === child.id), 'window.close removes child');
  }
  const beforePost = (await state(page)).tabs.length;
  await remote(parent.webContentsId, `const form=document.createElement('form');form.method='POST';form.target='_blank';form.action='${base}/posted';const input=document.createElement('input');input.name='value';input.value='preserved';form.append(input);document.body.append(form);form.submit();true`);
  await wait(() => posts.includes('value=preserved'), 'POST body preserved');
  await wait(async () => (await state(page)).tabs.length === beforePost + 1, 'POST opens tab');
  await command(page, 'close-tab', (await active(page)).id);
  assert.deepEqual(await application.evaluate(() => globalThis.__tabErrors), []);
  console.log('PASS link, window.open, about:blank, POST, opener messaging and script close without main-process exceptions');

  for (let i = 0; i < 44; i++) await command(page, 'new-tab');
  await wait(async () => (await state(page)).tabs.length === 45 && await page.locator('.tab').count() === 45, 'more than 30 tabs');
  await application.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).setContentSize(900, 700), (await state(page)).windowId);
  await page.waitForTimeout(400);
  const geometry = await page.locator('#tabs').evaluate(node => ({ client: node.clientWidth, scroll: node.scrollWidth, widths: [...node.querySelectorAll('.tab')].map(tab => tab.getBoundingClientRect().width) }));
  assert.ok(geometry.scroll <= geometry.client + 1, JSON.stringify(geometry));
  assert.ok(geometry.widths.every(width => width > 0 && width < 34), JSON.stringify(geometry));
  await page.screenshot({ path: path.join(root, 'artifacts/tab-strip-many.png') });
  console.log('PASS 45 tabs remain visible and compress to fit a 900px window');

  await command(page, 'activate', parent.id);
  await remote(parent.webContentsId, 'window.marker=987;document.getElementById("field").value="unsaved";true');
  const packet = { id: parent.id, windowId: (await state(page)).windowId, dragKey: parent.dragKey };
  // Dispatch the same DOM drag events used by a real drag; desktop coordinates
  // come from a second-display-safe point outside every Luna window.
  const area = await application.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
  await application.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).setBounds({ x: 10, y: 10, width: 760, height: 560 }), packet.windowId);
  const point = { x: area.x + area.width - 8, y: area.y + area.height - 8 };
  await page.locator(`.tab[data-id="${parent.id}"]`).evaluate((node, point) => {
    const dataTransfer = new DataTransfer(); node.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    node.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer, screenX: point.x, screenY: point.y }));
  }, point);
  await page.waitForTimeout(250); assert.equal(windows().length, 1, 'Escape cancels drag-out');
  await page.locator(`.tab[data-id="${parent.id}"]`).evaluate((node, point) => {
    const dataTransfer = new DataTransfer(); node.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
    node.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer, screenX: point.x, screenY: point.y }));
  }, point);
  let other;
  await wait(() => { other = windows().find(target => target !== page); return !!other; }, 'drag outside creates new window');
  await other.waitForSelector('.tab.selected');
  assert.equal((await active(other)).webContentsId, parent.webContentsId);
  assert.deepEqual(await remote(parent.webContentsId, '({marker:window.marker,value:document.getElementById("field").value})'), { marker: 987, value: 'unsaved' });
  await assert.rejects(command(page, 'tab-drop', { id: parent.id, windowId: (await state(other)).windowId, dragKey: 'forged' }), /无法移动/);
  const movedPacket = { ...packet, windowId: (await state(other)).windowId };
  await other.locator('.tab.selected').evaluate(node => { const dataTransfer = new DataTransfer(); node.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer })); });
  await page.locator('.tab').first().evaluate((node, packet) => {
    const dataTransfer = new DataTransfer(); dataTransfer.setData('application/x-luna-tab', JSON.stringify(packet));
    node.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  }, movedPacket);
  await wait(() => other.isClosed(), 'merging the final tab closes its empty window');
  await wait(async () => (await state(page)).tabs.some(tab => tab.id === parent.id), 'tab merged into original window');
  assert.deepEqual(await remote(parent.webContentsId, '({marker:window.marker,value:document.getElementById("field").value})'), { marker: 987, value: 'unsaved' });
  assert.deepEqual(await application.evaluate(() => globalThis.__tabErrors), []);
  console.log('PASS DOM drag-out and cross-window drop merge preserve the exact WebContents, JS and form state');
  const remaining = (await state(page)).tabs;
  for (const [i, tab] of remaining.entries()) {
    if (i === 1 || i === 31 || i === 44) {
      await command(page, 'activate', tab.id); await command(page, 'navigate', base + '/restore-' + i);
      await wait(async () => !(await active(page)).loading, 'restore fixture ' + i);
    }
  }
  const savedUrls = (await state(page)).tabs.map(tab => tab.url);
  await closeApp(application, page, true); application = null;
  const saved = JSON.parse(fs.readFileSync(path.join(profile, 'browser-data.json'), 'utf8'));
  assert.equal(saved.sessionWindows[0].urls.length, 45);
  application = await electron.launch({ executablePath: process.env.LUNA_EXECUTABLE || require('electron'), args: process.env.LUNA_EXECUTABLE ? [] : [root], env, timeout: 30000 });
  page = await application.firstWindow(); await page.waitForSelector('.tab.selected');
  await wait(async () => (await state(page)).tabs.length === 45, '45 tabs restored on restart');
  assert.deepEqual((await state(page)).tabs.map(tab => tab.url), savedUrls, 'restoration preserves exact tab order');
  for (const [index, url] of savedUrls.entries()) {
    if (!url.startsWith(base)) continue;
    const restored = (await state(page)).tabs[index];
    await wait(async () => {
      const current = (await state(page)).tabs.find(tab => tab.id === restored.id);
      return current && !current.loading && !current.error && current.title === 'Tab fixture';
    }, 'restored page loaded: ' + url);
    const documentState = await remote(restored.webContentsId, '({url:location.href,title:document.title,marker:window.marker,field:!!document.getElementById("field")})');
    assert.deepEqual(documentState, { url, title: 'Tab fixture', marker: 123, field: true }, 'restored URL has a live document');
    await command(page, 'activate', restored.id);
  }
  await closeApp(application, page, false); application = null;
  console.log('PASS restarting restores all 45 tabs in the exact saved order');
  fs.writeFileSync(path.join(root, 'artifacts/tab-window-result.json'), JSON.stringify({
    passed: true, version: require('../package.json').version,
    checks: ['native link, window.open and about:blank navigation', 'POST body and opener messaging', 'script window.close', 'no main-process exception', '45 compressed tabs in a 900px window', 'Escape cancels DOM drag-out', 'DOM drag-out opens a new Luna window', 'forged drag rejected', 'cross-window DOM drop preserves WebContents, JavaScript and unsaved form state', 'last-tab merge closes the empty window', '45-tab restart restores exact order'],
    testedAt: new Date().toISOString(),
  }, null, 2) + '\n');
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (application) { await application.evaluate(({ app }) => app.exit(1)).catch(() => {}); await application.close().catch(() => {}); }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
