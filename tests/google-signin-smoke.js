const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { closeApp } = require('./app-helpers');

const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-google-signin-'));
let application, page;
const reportPath = path.join(root, 'artifacts/google-signin-result.json');
async function run() {
  const env = { ...process.env, LUNA_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ executablePath: process.env.LUNA_EXECUTABLE || require('electron'), args: process.env.LUNA_EXECUTABLE ? ['--disable-gpu'] : [root, '--disable-gpu'], env, timeout: 30000 });
  page = await application.firstWindow(); await page.waitForSelector('.tab.selected');
  const state = () => page.evaluate(() => window.browser.command('state'));
  await page.evaluate(url => window.browser.command('navigate', url), 'https://accounts.google.com/signin/v2/identifier?service=mail&flowName=GlifWebSignIn&flowEntry=ServiceLogin');
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const current = await state(), tab = current.tabs.find(item => item.id === current.activeId);
    if (tab && !tab.loading && (tab.error || tab.title)) break;
    await page.waitForTimeout(250);
  }
  const current = await state(), tab = current.tabs.find(item => item.id === current.activeId);
  const result = await application.evaluate(async ({ webContents }, id) => {
    const web = webContents.fromId(id); const userAgent = await web.executeJavaScript('navigator.userAgent', true).catch(() => '');
    const body = await web.executeJavaScript('document.body?.innerText?.slice(0,12000) || ""', true).catch(() => '');
    return { userAgent, title: web.getTitle(), url: web.getURL(), body, loading: web.isLoading() };
  }, tab.webContentsId);
  const blocked = /this browser or app may not be secure|couldn.t sign you in|browser may not be secure/i.test(result.body);
  const report = { version: require('../package.json').version, passed: !tab.error && !blocked && !!result.title, status: tab.error ? 'unavailable' : blocked ? 'blocked' : 'login-page-only', authenticatedLoginVerified: false, blocked, pageLoaded: !tab.error && !!result.title, title: result.title, url: result.url, chromeMajor: current.chromium?.split('.')[0], userAgentHasElectron: /electron|luna/i.test(result.userAgent), error: tab.error?.description || null, checkedAt: new Date().toISOString(), credentialsEntered: false };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (blocked) process.exitCode = 1;
  await closeApp(application, page, false); application = null;
}
run().catch(async error => { console.error(error); process.exitCode = 1; if (application) await application.close().catch(() => {}); }).finally(() => fs.rmSync(profile, { recursive: true, force: true }));
