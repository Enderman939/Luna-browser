const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { closeApp } = require('./app-helpers');
const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-real-ui-'));
const records = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'luna', 'extensions-data.json'), 'utf8'));
fs.writeFileSync(path.join(profile, 'extensions-data.json'), JSON.stringify(records.map(record => ({ ...record, enabled: true, pinned: true }))));
let application, page;
(async () => {
  const env = { ...process.env, LUNA_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ executablePath: process.env.LUNA_EXECUTABLE || require('electron'), args: process.env.LUNA_EXECUTABLE ? ['--disable-gpu'] : [root, '--disable-gpu'], env });
  application.process().stderr.on('data', data => { if (/Error|error|failed|Unsupported/.test(data.toString())) console.log(data.toString().slice(0, 2000)); });
  page = await application.firstWindow(); await page.waitForSelector('.tab.selected');
  const started = Date.now();
  while (Date.now() - started < 45000) {
    const loaded = await page.evaluate(() => window.browser.command('state'));
    if (loaded.extensions.length && loaded.extensions.every(extension => extension.enabled)) break;
    await page.waitForTimeout(200);
  }
  const state = await page.evaluate(() => window.browser.command('state'));
  const actions = await page.evaluate(() => window.browserAction.getState('persist:luma-web'));
  console.log('Actual extensions:', state.extensions.map(extension => ({ id: extension.id, name: extension.name, enabled: extension.enabled, hasAction: extension.hasAction, icon: !!extension.icon, pinned: extension.pinned })));
  console.log('Action state:', JSON.stringify(actions));
  for (const extension of state.extensions) {
    const manifest = await application.evaluate(({ session }, id) => { const manifest = session.fromPartition('persist:luma-web').extensions.getExtension(id)?.manifest; return manifest && { action: manifest.action, browser_action: manifest.browser_action, icons: manifest.icons, background: manifest.background }; }, extension.id);
    console.log(extension.name, manifest);
  }
  console.log('Loaded toolbar images:', await page.locator('#extension-actions img').evaluateAll(images => images.map(image => ({ loaded: image.complete && image.naturalWidth > 0 }))));
  const guard = state.extensions.find(extension => extension.id === 'pdffkfellgipmhklpdmokmckkkfcopbh');
  if (guard) {
    await page.locator('#extension-actions button[data-id="' + guard.id + '"]').click();
    const started = Date.now(); let popup;
    while (Date.now() - started < 20000) {
      popup = application.context().pages().find(candidate => candidate.url().includes('chrome-extension://' + guard.id + '/pages/popup.html'));
      if (popup) break; await page.waitForTimeout(100);
    }
    if (!popup) throw new Error('Actual AdGuard popup did not open');
    popup.on('console', message => { if (message.type() === 'error') console.error('Popup error:', message.text()); });
    popup.on('pageerror', error => console.error('Popup script:', error.message));
    const ready = Date.now();
    while (Date.now() - ready < 30000 && await popup.evaluate(() => document.body.innerText.length) < 20) await popup.waitForTimeout(200);
    const actualUI = await popup.evaluate(() => ({ url: location.href, width: innerWidth, height: innerHeight, browserTabs: typeof browser.tabs.query, textLength: document.body.innerText.length }));
    console.log('Actual popup:', actualUI);
    if (actualUI.textLength < 20) throw new Error('Actual plugin UI remained on its loading screen');
    await popup.screenshot({ path: path.join(root, 'artifacts', 'actual-adguard-popup.png') });
    await page.screenshot({ path: path.join(root, 'artifacts', 'actual-toolbar-icons.png') });
  }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (application) await closeApp(application, page, false).catch(() => application.process().kill());
  fs.rmSync(profile, { recursive: true, force: true });
});
