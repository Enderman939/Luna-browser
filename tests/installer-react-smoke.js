const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const runtime = process.env.LUNA_SETUP_RUNTIME;
if (!runtime || !fs.existsSync(path.join(runtime, 'luna.exe'))) throw new Error('LUNA_SETUP_RUNTIME must point to the packaged React installer app.');
const root = path.resolve(__dirname, '..'), scratch = fs.mkdtempSync(path.join(root, 'artifacts', 'luna-react-installer-smoke-'));
const target = path.join(scratch, 'Luna Install Location', 'Luna Browser'), desktop = path.join(scratch, 'Desktop'), startMenu = path.join(scratch, 'Start Menu');
const profile = path.join(scratch, 'installer-profile'), screenshot = path.join(root, 'artifacts/luna-setup-preview.png');
const testRegistryName = 'Luna Browser Test ' + require('node:crypto').randomUUID();
const testRegistryKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\' + testRegistryName;
const testEnvironment = { ...process.env, LUNA_USER_DATA: profile, LUNA_INSTALLER_TEST: '1', LUNA_INSTALLER_TEST_REGISTRY: testRegistryName, LUNA_INSTALLER_TEST_DESKTOP: desktop, LUNA_INSTALLER_TEST_STARTMENU: startMenu };
const registryKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Luna Browser';
function registrySnapshot() { const result = spawnSync('reg.exe', ['QUERY', registryKey, '/s'], { encoding: 'utf8', windowsHide: true }); return { status: result.status, stdout: result.stdout }; }
const originalRegistry = registrySnapshot();
let application, page;

async function wait(predicate, label, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('Timed out: ' + label);
}

async function run() {
  application = await electron.launch({ executablePath: path.join(runtime, 'luna.exe'), args: ['--no-proxy-server'], env: testEnvironment, timeout: 30000 });
  assert.equal(await application.evaluate(() => process.versions.electron), require('../package.json').devDependencies.electron, 'installer runs the pinned Electron version');
  page = await application.firstWindow(); await page.waitForSelector('.glow-button');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.content h2').parentElement).opacity === '1');
  assert.equal(await page.title(), 'Luna Browser Setup');
  assert.equal(await page.locator('.content h2').textContent(), 'Install Luna Browser');
  assert.equal(await page.locator('.feature-card span').count(), 4);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(22, 22, 27)');
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), 558);
  await page.waitForTimeout(700); fs.mkdirSync(path.dirname(screenshot), { recursive: true }); await page.screenshot({ path: screenshot });
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.reload(); await page.waitForSelector('.glow-button');
  assert.equal(await page.locator('.content h2').evaluate(element => getComputedStyle(element.parentElement).transform), 'none', 'reduced motion skips entrance movement');

  const occupied = path.join(scratch, 'Personal Files'); fs.mkdirSync(occupied); fs.writeFileSync(path.join(occupied, 'keep.txt'), 'personal file');
  await page.locator('.path-card input').fill(occupied);
  await page.locator('.glow-button').click();
  await page.waitForSelector('.error-row');
  assert.match(await page.locator('.error-row').textContent(), /空文件夹/);
  assert.equal(fs.readFileSync(path.join(occupied, 'keep.txt'), 'utf8'), 'personal file');
  await page.locator('.path-card input').fill(target);
  await page.locator('.option').nth(2).click();
  await page.locator('.glow-button').hover(); await page.waitForTimeout(100);
  assert.equal(await page.locator('.glow-layer').evaluate(element => Number(getComputedStyle(element).opacity) > 0), true);
  await page.locator('.glow-button').click();
  await page.waitForSelector('.installing-row');
  assert.equal(await page.locator('.window-close').isDisabled(), true);
  const pulse = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(true))));
  assert.equal(pulse, true, 'renderer stays responsive during installation');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  assert.equal(page.isClosed(), false, 'native close is blocked during installation');
  await wait(async () => fs.existsSync(path.join(target, 'luna.exe')) || await page.locator('.error-row').isVisible(), 'browser files installed or report failure');
  if (!fs.existsSync(path.join(target, 'luna.exe'))) throw new Error('Install UI error: ' + await page.locator('.error-row').textContent());
  await wait(async () => await page.locator('.installing-row').textContent().then(value => value.includes('Luna is ready')), 'installer completion state');
  assert.equal(fs.existsSync(path.join(target, 'Luna-Uninstall.exe')), true);
  assert.equal(fs.existsSync(path.join(desktop, 'Luna Browser.lnk')), true);
  assert.equal(fs.existsSync(path.join(startMenu, 'Luna Browser', 'Luna Browser.lnk')), true);
  assert.deepEqual(registrySnapshot(), originalRegistry, 'test installation leaves the real uninstall registration unchanged');
  const registration = spawnSync('reg.exe', ['QUERY', testRegistryKey, '/s'], { encoding: 'utf8', windowsHide: true });
  assert.equal(registration.status, 0); assert.ok(registration.stdout.includes(target)); assert.match(registration.stdout, /QuietUninstallString/);

  const browser = await electron.launch({ executablePath: path.join(target, 'luna.exe'), args: ['--no-proxy-server'], env: { ...testEnvironment, LUNA_USER_DATA: path.join(scratch, 'browser-profile') }, timeout: 30000 });
  try {
    assert.equal(await browser.evaluate(() => process.versions.electron), require('../package.json').devDependencies.electron, 'installed browser runs the pinned Electron version');
    const browserPage = await browser.firstWindow(); await browserPage.waitForLoadState('domcontentloaded'); assert.equal(browserPage.isClosed(), false);
    await assert.rejects(page.evaluate(installPath => window.installer.install({ installPath, desktop: true, startMenu: true, launch: false }), target), /请先关闭/);
  }
  finally { await browser.evaluate(({ app }) => app.exit(0)); await browser.close(); }

  // Upgrade through the same main-process install function, preserving unowned files.
  fs.writeFileSync(path.join(target, 'personal-note.txt'), 'keep this');
  const blockedDesktop = path.join(scratch, 'blocked-desktop'); fs.writeFileSync(blockedDesktop, 'not a directory');
  await application.evaluate((_, value) => { process.env.LUNA_INSTALLER_TEST_DESKTOP = value; }, blockedDesktop);
  await assert.rejects(page.evaluate(installPath => window.installer.install({ installPath, desktop: true, startMenu: true, launch: false }), target), /EEXIST|ENOTDIR/);
  assert.equal(fs.existsSync(path.join(target, 'luna.exe')), true, 'failed upgrade restores the original application');
  assert.equal(fs.readFileSync(path.join(target, 'personal-note.txt'), 'utf8'), 'keep this');
  await application.evaluate((_, value) => { process.env.LUNA_INSTALLER_TEST_DESKTOP = value; }, desktop);
  await application.evaluate(async ({ BrowserWindow }, installPath) => {
    const win = BrowserWindow.getAllWindows()[0];
    await win.webContents.executeJavaScript(`window.installer.install(${JSON.stringify({ installPath, desktop: true, startMenu: true, launch: false })})`);
  }, target);
  assert.equal(fs.readFileSync(path.join(target, 'personal-note.txt'), 'utf8'), 'keep this');

  const uninstaller = spawnSync(path.join(target, 'Luna-Uninstall.exe'), ['--silent'], { windowsHide: true, encoding: 'utf8', env: testEnvironment });
  assert.equal(uninstaller.status, 0, uninstaller.stderr || uninstaller.stdout);
  await wait(() => !fs.existsSync(path.join(target, 'luna.exe')) && !fs.existsSync(path.join(target, '.luna-install-files')), 'installed files uninstalled');
  assert.equal(fs.readFileSync(path.join(target, 'personal-note.txt'), 'utf8'), 'keep this', 'uninstall preserves unowned files');
  assert.equal(fs.existsSync(path.join(desktop, 'Luna Browser.lnk')), false);
  assert.equal(fs.existsSync(path.join(startMenu, 'Luna Browser')), false);
  assert.notEqual(spawnSync('reg.exe', ['QUERY', testRegistryKey], { windowsHide: true }).status, 0);
  await application.evaluate(({ app }) => app.exit(0)); await application.close(); application = null;
  assert.deepEqual(registrySnapshot(), originalRegistry);
  console.log('PASS React/Amicro installer: dark UI, entrance, glow, occupied-folder rejection, responsive installation, close protection, browser launch, upgrade, shortcuts, uninstall registration and uninstall preserving personal files');
}

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (application) { await application.evaluate(({ app }) => app.exit(1)).catch(() => {}); await application.close().catch(() => {}); }
  spawnSync('reg.exe', ['DELETE', testRegistryKey, '/f'], { windowsHide: true });
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
