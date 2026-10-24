const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { closeApp, acceptPrompt } = require('./app-helpers');
const { createExtension } = require('./extension-fixture');

const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-context-'));
const artifacts = path.join(root, 'artifacts'), icon = fs.readFileSync(path.join(root, 'src/ui/assets/app.png'));
const paragraph = 'Luna reading fixture explains how a browser should preserve your selection, keep links working, and provide useful page actions. '.repeat(9);
let application, main, base, currentId;
const errors = [];
const server = http.createServer((request, response) => {
  if (request.url === '/image.png') { response.writeHead(200, { 'Content-Type': 'image/png' }); response.end(icon); return; }
  if (request.url === '/download.txt') { response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="context-download.txt"' }); response.end('context download'); return; }
  if (request.url === '/frame') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end('<p id="frame-text">Selection inside an iframe</p>'); return; }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><html><head><title>Luna Context Fixture</title></head><body style="margin:24px;font:16px sans-serif;background:#fafafa;color:#222">
    <div id="blank" style="height:40px;background:#eee"></div><p id="selection">gpt-6.1-sol & browser context</p>
    <p><a id="link" href="/next">Test link</a> <a id="download" href="/download.txt">Download file</a></p><input id="edit" value="Edit me"><input id="password" type="password" value="secret">
    <p><img id="image" src="/image.png" width="64" height="64"></p><iframe id="frame" src="/frame" style="height:70px;width:380px"></iframe>
    <article><h1>Reading fixture article</h1><p>${paragraph}</p><h2>Second section</h2><p>${paragraph}</p><p>${paragraph}</p><p>${paragraph}</p><p>${paragraph}</p></article></body></html>`);
});
async function wait(predicate, label, timeout = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
  if (main && !main.isClosed()) { const current = await state(); console.error('Diagnostics:', JSON.stringify({ tabs: current.tabs, activeId: current.activeId })); }
  throw new Error('Timed out: ' + label);
}
const command = (action, payload) => main.evaluate(({ action, payload }) => window.browser.command(action, payload), { action, payload });
const state = () => command('state');
const remote = code => application.evaluate(({ webContents }, { id, code }) => webContents.fromId(id).executeJavaScript(code, true), { id: currentId, code });
async function getWindow(file) {
  let page;
  await wait(() => { page = application.windows().find(page => page.url().split('?')[0].endsWith('/' + file)); return !!page; }, file + ' opens');
  return page;
}
async function context(selector = '#blank', selection = false) {
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'luna')?.focus());
  const coords = await remote(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element.scrollIntoView({block:'nearest'});
    if (${selection}) {
      if (element instanceof HTMLInputElement) { element.focus(); element.select(); }
      else { const range = document.createRange(); range.selectNodeContents(element); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); }
    } else getSelection().removeAllRanges();
    const rect = element.getBoundingClientRect(); return {x:Math.round(rect.x+Math.min(rect.width/2,80)),y:Math.round(rect.y+Math.min(rect.height/2,16))};
  })()`);
  await application.evaluate(({ webContents }, { id, coords }) => {
    const web = webContents.fromId(id); web.focus();
    web.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...coords });
    web.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...coords });
  }, { id: currentId, coords });
  const menu = await getWindow('context-menu.html'); await menu.waitForSelector('#root button'); return menu;
}
async function activateOriginal() { const tab = (await state()).tabs.find(tab => tab.webContentsId === currentId); await command('activate', tab.id); }
async function dismiss(menu) { await menu.evaluate(() => window.contextMenu.close()); await wait(() => menu.isClosed(), 'menu closes'); }
async function tool() { const page = await getWindow('page-tool.html'); await page.waitForSelector('#tool-title'); await wait(async () => !!await page.locator('#tool-title').textContent(), 'tool ready'); return page; }
async function closeTool(page) { await page.locator('#close').click(); await wait(() => page.isClosed(), 'tool closes'); }
async function run() {
  fs.mkdirSync(artifacts, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = 'http://127.0.0.1:' + server.address().port;
  const env = { ...process.env, LUNA_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ executablePath: process.env.LUNA_EXECUTABLE || require('electron'), args: process.env.LUNA_EXECUTABLE ? ['--disable-gpu'] : [root, '--disable-gpu'], env, timeout: 30000 });
  application.on('window', page => page.on('pageerror', error => errors.push(error.message)));
  main = await application.firstWindow(); await main.waitForSelector('.tab.selected');
  await command('update-settings', { theme: 'dark', searchEngine: 'bing' });
  await application.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, profile);
  await command('choose-download-path');
  await command('navigate', base); await wait(async () => (await state()).tabs[0].title === 'Luna Context Fixture', 'fixture loads');
  currentId = (await state()).tabs[0].webContentsId;
  await application.evaluate(({ dialog }) => {
    globalThis.__contextSaveAs = [];
    dialog.showSaveDialog = async (window, options) => { globalThis.__contextSaveAs.push(options); return { canceled: false, filePath: options.defaultPath }; };
  });
  let menu = await context();
  console.log('Checking navigation and selection actions');
  assert.equal(await menu.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await menu.getByRole('menuitem', { name: '后退', exact: true }).isDisabled(), true);
  await menu.screenshot({ path: path.join(artifacts, 'context-page-dark.png') });
  await menu.getByRole('menuitem', { name: '更多工具', exact: true }).hover(); await menu.waitForSelector('#submenu:not([hidden])');
  await menu.screenshot({ path: path.join(artifacts, 'context-submenu.png') });
  await menu.getByRole('menuitem', { name: '复制网页地址', exact: true }).click();
  await wait(async () => application.evaluate(({ clipboard }) => clipboard.readText()).then(value => value === base + '/'), 'copy page URL');

  menu = await context('#selection', true); await menu.screenshot({ path: path.join(artifacts, 'context-selection.png') });
  await menu.getByRole('menuitem', { name: '复制', exact: true }).click();
  await wait(async () => application.evaluate(({ clipboard }) => clipboard.readText()).then(value => value === 'gpt-6.1-sol & browser context'), 'copy preserves selection');
  menu = await context('#selection', true); await menu.getByRole('menuitem', { name: '复制指向高亮文字的链接', exact: true }).click();
  const highlighted = await application.evaluate(({ clipboard }) => clipboard.readText());
  assert.ok(highlighted.startsWith(base + '/#:~:text=gpt%2D6.1%2Dsol%20%26%20browser%20context'));
  menu = await context('#selection', true); await menu.getByRole('menuitem', { name: '在阅读模式中打开选中文字', exact: true }).click();
  let page = await tool(); assert.equal(await page.locator('#article-body').innerText(), 'gpt-6.1-sol & browser context'); await closeTool(page);
  menu = await context('#selection', true); await menu.getByRole('menuitem', { name: /^使用 Bing 搜索/ }).click();
  await wait(async () => (await state()).tabs.some(tab => tab.url.startsWith('https://www.bing.com/search?q=gpt-6.1-sol')), 'selection search uses selected engine');
  await command('close-tab', (await state()).activeId); await activateOriginal();
  menu = await context('#selection', true); await menu.getByRole('menuitem', { name: '将选中文字翻译成简体中文', exact: true }).click();
  await wait(async () => (await state()).tabs.some(tab => tab.url.startsWith('https://translate.google.com/?sl=auto&tl=zh-CN&text=')), 'selection translation opens real service');
  await command('close-tab', (await state()).activeId); await activateOriginal();

  menu = await context('#link'); await menu.getByRole('menuitem', { name: '在后台标签页打开链接', exact: true }).click();
  console.log('Checking link/image save-as and editing');
  await wait(async () => (await state()).tabs.length === 2, 'background link opens'); const backgroundState = await state(); assert.equal(backgroundState.tabs.find(tab => tab.id === backgroundState.activeId).webContentsId, currentId);
  await command('close-tab', (await state()).tabs.find(tab => tab.webContentsId !== currentId).id);
  menu = await context('#link'); await menu.getByRole('menuitem', { name: '复制链接地址', exact: true }).click();
  assert.equal(await application.evaluate(({ clipboard }) => clipboard.readText()), base + '/next');
  menu = await context('#download'); await menu.getByRole('menuitem', { name: '链接另存为…', exact: true }).click();
  await wait(async () => fs.existsSync(path.join(profile, 'download.txt')), 'link download'); assert.equal(fs.readFileSync(path.join(profile, 'download.txt'), 'utf8'), 'context download');
  menu = await context('#image'); await menu.screenshot({ path: path.join(artifacts, 'context-image.png') });
  await menu.getByRole('menuitem', { name: '复制图片', exact: true }).click();
  await wait(async () => application.evaluate(({ clipboard }) => clipboard.has('image/png')), 'image copied');
  menu = await context('#image'); await menu.getByRole('menuitem', { name: '图片另存为…', exact: true }).click();
  await wait(async () => fs.existsSync(path.join(profile, 'image.png')), 'image saved'); assert.deepEqual(fs.readFileSync(path.join(profile, 'image.png')), icon);
  assert.equal(await application.evaluate(() => globalThis.__contextSaveAs.length), 2, 'save-as actions request a file picker despite automatic download settings');
  menu = await context('#edit', true); await menu.getByRole('menuitem', { name: '剪切', exact: true }).click();
  await wait(async () => await remote('document.getElementById("edit").value') === '', 'cut applies to original field');
  await application.evaluate(({ clipboard }) => clipboard.writeText('Pasted from menu'));
  menu = await context('#edit'); await menu.getByRole('menuitem', { name: '粘贴', exact: true }).click();
  await wait(async () => await remote('document.getElementById("edit").value') === 'Pasted from menu', 'paste applies to original field');
  menu = await context('#password', true); assert.equal(await menu.getByRole('menuitem', { name: /^使用 / }).count(), 0); await dismiss(menu);

  menu = await context(); await menu.getByRole('menuitem', { name: '为此页面创建二维码', exact: true }).click();
  console.log('Checking page tools');
  page = await tool(); assert.equal(await page.locator('body').getAttribute('data-kind'), 'qr');
  await wait(async () => page.locator('#preview').evaluate(image => image.complete && image.naturalWidth === 320), 'QR image ready');
  await page.screenshot({ path: path.join(artifacts, 'context-qr.png') });
  await application.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, path.join(profile, 'qr.png'));
  await page.locator('#save-image').click(); await wait(() => fs.existsSync(path.join(profile, 'qr.png')), 'QR saved'); await closeTool(page);
  menu = await context(); await menu.getByRole('menuitem', { name: '截图…', exact: true }).click();
  page = await tool(); const visible = await page.locator('#preview').evaluate(image => ({ width: image.naturalWidth, height: image.naturalHeight })); assert.ok(visible.width > 700 && visible.height > 300);
  await page.screenshot({ path: path.join(artifacts, 'context-screenshot.png') }); await page.locator('#copy-image').click();
  assert.ok(await application.evaluate(async ({ clipboard, nativeImage }) => {
    const item = (await clipboard.read()).find(item => item.types.includes('image/png'));
    return nativeImage.createFromBuffer(Buffer.from(await (await item.getType('image/png')).arrayBuffer())).getSize().width > 700;
  })); await closeTool(page);
  menu = await context(); await menu.getByRole('menuitem', { name: '更多工具', exact: true }).click(); await menu.getByRole('menuitem', { name: '整页截图…', exact: true }).click();
  page = await tool(); await wait(async () => page.locator('#preview').evaluate(image => image.complete && image.naturalHeight > 1000), 'full-page image');
  assert.ok(await page.locator('#preview').evaluate((image, height) => image.naturalHeight > height, visible.height)); await closeTool(page);
  menu = await context(); await menu.getByRole('menuitem', { name: '更多工具', exact: true }).click(); await menu.getByRole('menuitem', { name: '阅读模式', exact: true }).click();
  page = await tool(); assert.ok((await page.locator('#article-body').innerText()).includes(paragraph.trim()));
  assert.ok(await page.locator('#article-body h2').count() >= 1); await page.screenshot({ path: path.join(artifacts, 'context-reading.png') }); await closeTool(page);
  await application.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, path.join(profile, 'saved.mhtml'));
  menu = await context(); await menu.getByRole('menuitem', { name: '网页另存为…', exact: true }).click();
  await wait(() => fs.existsSync(path.join(profile, 'saved.mhtml')) && fs.readFileSync(path.join(profile, 'saved.mhtml'), 'utf8').replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))).includes('Luna Context Fixture'), 'page saved with actual content');
  await application.evaluate(({ webContents }, id) => { const web = webContents.fromId(id); web.print = options => { web.__printOptions = options; }; }, currentId);
  menu = await context(); await menu.getByRole('menuitem', { name: '打印…', exact: true }).click();
  assert.deepEqual(await application.evaluate(({ webContents }, id) => webContents.fromId(id).__printOptions, currentId), { printBackground: true });
  menu = await context(); await menu.getByRole('menuitem', { name: '查看网页源代码', exact: true }).click();
  console.log('Checking source, iframe selection and inspector');
  await wait(async () => (await state()).tabs.some(tab => tab.url === 'view-source:' + base + '/' && !tab.loading), 'native source tab');
  const source = (await state()).tabs.find(tab => tab.url.startsWith('view-source:')); assert.equal(source.error, null);
  assert.ok(source.title.startsWith('view-source:'));
  const sourceImage = await application.evaluate(async ({ webContents }, id) => (await webContents.fromId(id).capturePage()).toPNG().toString('base64'), source.webContentsId);
  fs.writeFileSync(path.join(artifacts, 'context-source.png'), Buffer.from(sourceImage, 'base64'));
  await command('close-tab', source.id); await activateOriginal();
  const frameCoords = await remote(`(() => { const iframe = document.getElementById('frame'); iframe.scrollIntoView({block:'nearest'}); const text = iframe.contentDocument.getElementById('frame-text');
    const range = iframe.contentDocument.createRange(); range.selectNodeContents(text); const selection = iframe.contentWindow.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    const rect = iframe.getBoundingClientRect(), inner = text.getBoundingClientRect(); return {x:Math.round(rect.x + iframe.clientLeft + inner.x + 30),y:Math.round(rect.y + iframe.clientTop + inner.y + 8)};
  })()`);
  await application.evaluate(({ webContents }, { id, coords }) => { const web = webContents.fromId(id); web.focus(); web.sendInputEvent({type:'mouseDown',button:'right',clickCount:1,...coords}); web.sendInputEvent({type:'mouseUp',button:'right',clickCount:1,...coords}); }, { id: currentId, coords: frameCoords });
  menu = await getWindow('context-menu.html'); await menu.getByRole('menuitem', { name: '复制指向高亮文字的链接', exact: true }).click();
  assert.equal(await application.evaluate(({ clipboard }) => clipboard.readText()), base + '/frame#:~:text=Selection%20inside%20an%20iframe');
  menu = await context(); await menu.getByRole('menuitem', { name: '检查元素', exact: true }).click();
  await wait(async () => application.evaluate(({ webContents }, id) => webContents.fromId(id).isDevToolsOpened(), currentId), 'inspect opens DevTools');
  await application.evaluate(({ webContents }, id) => webContents.fromId(id).closeDevTools(), currentId);

  const extensionPath = path.join(profile, 'extension'); createExtension(extensionPath, icon);
  console.log('Checking extension context menus');
  fs.writeFileSync(path.join(extensionPath, 'background.js'), `{
    chrome.contextMenus.create({id:'first',title:'Context fixture first',contexts:['page']});
    chrome.contextMenus.create({id:'second',title:'Context fixture second',contexts:['page']});
    chrome.contextMenus.create({id:'selected',title:'Selected: %s',contexts:['selection']});
  } chrome.contextMenus.onClicked.addListener((info,tab)=>chrome.storage.local.set({contextClicked:info.menuItemId,contextTab:tab.id,contextSelection:info.selectionText || ''}));`);
  await application.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, extensionPath);
  const loading = command('extension-load-directory'); await acceptPrompt(main, 'permissions'); await loading;
  await wait(async () => (await state()).extensions.some(extension => extension.enabled), 'fixture extension enabled');
  const extension = (await state()).extensions[0];
  await new Promise(resolve => setTimeout(resolve, 500));
  menu = await context(); await menu.getByRole('menuitem', { name: 'Luna Test Extension', exact: true }).click();
  await menu.getByRole('menuitem', { name: 'Context fixture second', exact: true }).click();
  await command('extension-options', extension.id); const optionsId = (await state()).tabs.find(tab => tab.url.endsWith('/options.html')).webContentsId;
  await wait(async () => application.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScript('chrome.storage.local.get(["contextClicked","contextTab"])'), optionsId).then(value => value.contextClicked === 'second' && value.contextTab === currentId), 'extension click callback');
  await command('close-tab', (await state()).activeId); await activateOriginal();
  menu = await context('#selection', true); await menu.getByRole('menuitem', { name: 'Luna Test Extension', exact: true }).click(); await menu.getByRole('menuitem', { name: 'Selected: gpt-6.1-sol & browser context', exact: true }).click();
  await command('extension-options', extension.id); const nextOptionsId = (await state()).tabs.find(tab => tab.url.endsWith('/options.html')).webContentsId;
  await wait(async () => application.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScript('chrome.storage.local.get(["contextSelection"])'), nextOptionsId).then(value => value.contextSelection === 'gpt-6.1-sol & browser context'), 'extension selection context');
  await command('close-tab', (await state()).activeId); await activateOriginal();
  await command('extension-enable', { id: extension.id, enabled: false }); menu = await context(); assert.equal(await menu.getByRole('menuitem', { name: 'Luna Test Extension', exact: true }).count(), 0); await dismiss(menu);
  assert.deepEqual(await remote('({tool:typeof window.pageTool,menu:typeof window.contextMenu,browser:typeof window.browser?.command})'), { tool: 'undefined', menu: 'undefined', browser: 'undefined' });
  await command('update-settings', { theme: 'light' }); menu = await context(); assert.equal(await menu.locator('html').getAttribute('data-theme'), 'light');
  await menu.screenshot({ path: path.join(artifacts, 'context-page-light.png') });
  await menu.keyboard.press('ArrowDown'); assert.equal(await menu.evaluate(() => document.activeElement.textContent.includes('刷新')), true);
  await menu.keyboard.press('Escape'); await wait(() => menu.isClosed(), 'keyboard dismissal');
  await application.evaluate(({ webContents }, id) => { const web = webContents.fromId(id); web.focus(); web.sendInputEvent({type:'keyDown',keyCode:'S',modifiers:['control','shift']}); web.sendInputEvent({type:'keyUp',keyCode:'S',modifiers:['control','shift']}); }, currentId);
  page = await tool(); assert.equal(await page.locator('body').getAttribute('data-kind'), 'screenshot'); await closeTool(page);
  console.log('Checking screenshot shortcut and shutdown');
  assert.deepEqual(errors, []);
  await closeApp(application, main); application = null;
  fs.writeFileSync(path.join(artifacts, 'context-result.json'), JSON.stringify({ passed: true, checks: ['real right clicks', 'light/dark themes', 'copy/highlight/search/translate', 'background links', 'downloads', 'image clipboard', 'editable cut/paste', 'password selection', 'QR generation/save', 'visible/full screenshots', 'reading extraction', 'MHTML save', 'print dispatch', 'native source', 'inspect', 'extension submenus/callback/selection/disable', 'bridge isolation', 'keyboard'], testedAt: new Date().toISOString() }, null, 2));
  console.log('PASS: real right-click context menus, page/selection/link/image/edit actions, QR, screenshots, reading, save/print/source/inspect, extension submenus and callbacks, isolation, light/dark themes, keyboard.');
}
run().catch(async error => { console.error(error); for (const page of application?.windows() || []) if (!page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'context-failure-' + (page.url().includes('context-menu') ? 'menu' : 'page') + '.png') }).catch(() => {}); process.exitCode = 1; }).finally(async () => {
  if (application) await closeApp(application, main, false).catch(() => application.close().catch(() => {}));
  await new Promise(resolve => server.close(resolve)); fs.rmSync(profile, { recursive: true, force: true });
});
