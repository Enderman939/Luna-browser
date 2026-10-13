const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { closeApp } = require('./app-helpers');
const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-edge-live-'));
const id = 'pdffkfellgipmhklpdmokmckkkfcopbh';
let application, page;
(async () => {
  const env = { ...process.env, LUNA_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ executablePath: process.env.LUNA_EXECUTABLE || require('electron'), args: process.env.LUNA_EXECUTABLE ? ['--disable-gpu'] : [root, '--disable-gpu'], env });
  page = await application.firstWindow(); await page.waitForSelector('.tab.selected');
  await page.evaluate(() => window.browser.command('extensions'));
  const installed = page.evaluate(id => window.browser.command('extension-install-store', { input: id, market: 'edge' }).then(() => ({ ok: true }), error => ({ ok: false, error: error.message })), id);
  const result = await Promise.race([
    installed,
    page.waitForSelector('#confirmation-dialog[open]', { timeout: 45000 }).then(async () => { await page.locator('#confirmation-accept').click(); return installed; }),
  ]);
  const state = await page.evaluate(() => window.browser.command('state'));
  const extension = state.extensions.find(extension => extension.id === id);
  const summary = { ...result, enabled: extension?.enabled || false, name: extension?.name, version: extension?.version, market: extension?.market, stage: state.extensionInstallState?.phase, error: state.extensionInstallState?.error };
  console.log(JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(root, 'artifacts', 'edge-live-install-result.json'), JSON.stringify(summary, null, 2));
  await page.evaluate(() => window.browser.command('extensions'));
  await page.waitForTimeout(200); await page.screenshot({ path: path.join(root, 'artifacts', 'edge-live-install.png') });
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (application) await closeApp(application, page, false).catch(() => application.process().kill());
  fs.rmSync(profile, { recursive: true, force: true });
});
