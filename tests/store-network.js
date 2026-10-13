const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { closeApp } = require('./app-helpers');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-store-network-'));
let application, page;
(async () => {
  const env = { ...process.env, LUNA_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ executablePath: require('electron'), args: [root, '--disable-gpu'], env });
  page = await application.firstWindow(); await page.waitForSelector('.tab.selected');
  const result = await application.evaluate(async ({ session }, root) => {
    const load = process.getBuiltinModule('module').createRequire(root + '/package.json');
    const { edgeCrxURL, fetchCrx, extensionIdFromKey } = load(root + '/src/webstore-download.js');
    const { unpackContainer } = load(root + '/src/extension-package.js');
    const { browserFetch } = load(root + '/src/webstore-transport.js');
    const browser = session.fromPartition('persist:luma-web');
    const id = 'pdffkfellgipmhklpdmokmckkkfcopbh', url = edgeCrxURL(id, process.versions.chrome);
    try {
      const buffer = await fetchCrx((url, options) => browserFetch(browser, url, options), url, () => {}, { timeout: 30000 });
      const container = unpackContainer(buffer);
      const Zip = load('adm-zip'); const entries = new Zip(container.zip).getEntries();
      return { passed: extensionIdFromKey(container.key) === id, bytes: buffer.length, extractedBytes: entries.reduce((sum, entry) => sum + entry.header.size, 0), largestFile: Math.max(...entries.map(entry => entry.header.size)), extensionId: id, proxy: await browser.resolveProxy(url) };
    } catch (error) { return { passed: false, error: error.message, cause: error.cause?.message, failedHost: error.downloadHost, proxy: await browser.resolveProxy(url) }; }
  }, root);
  console.log(JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(root, 'artifacts', 'store-network-result.json'), JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (application) await closeApp(application, page).catch(() => {});
  fs.rmSync(profile, { recursive: true, force: true });
});
