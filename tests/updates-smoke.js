const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createHash } = require('node:crypto');
const AdmZip = require('adm-zip');
const { dialogPage } = require('./dialog-helpers');
const root = path.resolve(__dirname, '..'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-update-smoke-'));
let application, page;
const errors = [];
async function wait(predicate, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('Timed out: ' + label);
}
async function run() {
  assert.equal(process.platform, 'win32');
  const version = '9.0.0', name = `luna-${version}-win32-x64.zip`;
  const source = path.join(directory, 'fixture-source'), fixture = path.join(directory, 'fixture-package', 'luna-win32-x64');
  const installed = path.join(directory, 'isolated installed app'), profile = path.join(directory, 'profile');
  fs.mkdirSync(source); fs.mkdirSync(path.join(fixture, 'resources'), { recursive: true }); fs.mkdirSync(installed);
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'luna-browser', version }));
  const asar = await import('@electron/asar'); await asar.createPackage(source, path.join(fixture, 'resources/app.asar'));
  for (const target of [fixture, installed]) fs.copyFileSync(path.join(process.env.SystemRoot, 'System32/where.exe'), path.join(target, 'luna.exe'));
  for (const file of ['icudtl.dat', 'resources.pak', 'new-marker']) fs.writeFileSync(path.join(fixture, file), 'new');
  fs.writeFileSync(path.join(installed, 'old-marker'), 'old');
  const zip = new AdmZip(); zip.addLocalFolder(fixture, 'luna-win32-x64'); const file = path.join(directory, name); zip.writeZip(file);
  const payload = fs.readFileSync(file), digest = createHash('sha256').update(payload).digest('hex');
  const release = { tag_name: 'v' + version, draft: false, prerelease: false, assets: [{ name, state: 'uploaded', size: payload.length, digest: 'sha256:' + digest,
    browser_download_url: `https://github.com/Enderman939/Luna-browser/releases/download/v${version}/${name}` }] };
  const env = { ...process.env, LUNA_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ executablePath: process.env.LUNA_EXECUTABLE || require('electron'), args: process.env.LUNA_EXECUTABLE ? ['--no-proxy-server'] : [root, '--no-proxy-server'], env });
  application.process().stderr.on('data', bytes => { if (process.env.LUNA_UPDATE_DIAGNOSTICS) console.error(String(bytes)); });
  page = await application.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.waitForSelector('.tab.selected');
  const command = (action, payload) => page.evaluate(({ action, payload }) => window.browser.command(action, payload), { action, payload });
  const state = () => command('state');
  const appVersion = (await state()).version;
  await application.evaluate(({ app }, options) => {
    const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    const { AppUpdates, LATEST } = require('./src/app-updates'); const { prepareUpdate } = require('./src/update-installer');
    const originalSnapshot = AppUpdates.prototype.snapshot, originalCheck = AppUpdates.prototype.check;
    globalThis.__updateRequests = []; globalThis.__corruptUpdate = true;
    AppUpdates.prototype.snapshot = function() { this.supported = true; return originalSnapshot.call(this); };
    AppUpdates.prototype.check = function(...args) {
      this.supported = true;
      this.fetch = async (url, request) => {
        globalThis.__updateRequests.push({ url, credentials: request.credentials });
        if (url === LATEST) return Response.json(options.release);
        const bytes = require('node:fs').readFileSync(options.file);
        if (globalThis.__corruptUpdate) bytes.fill(0);
        return new Response(new ReadableStream({ async start(controller) {
          const size = Math.ceil(bytes.length / 4);
          for (let offset = 0; offset < bytes.length; offset += size) { await new Promise(resolve => setTimeout(resolve, 80)); controller.enqueue(bytes.subarray(offset, offset + size)); }
          controller.close();
        } }));
      };
      this.prepareInstall = ({ file, release }) => prepareUpdate({ file, release, executable: options.executable, directory: options.cache });
      return originalCheck.apply(this, args);
    };
  }, { release, file, executable: path.join(installed, 'luna.exe'), cache: path.join(profile, 'updates') });
  await command('update-settings', { autoUpdate: false }); await command('settings');
  await page.locator('[data-settings-section="about"]').click(); await page.locator('#app-update-check').click();
  await wait(async () => (await state()).update.phase === 'available', 'manual update check');
  await page.locator('#app-update-download').waitFor({ state: 'visible' });
  await page.locator('#app-update-download').click(); await page.locator('#app-update-progress').waitFor({ state: 'visible' });
  await wait(async () => (await state()).update.phase === 'error', 'corrupt update refused');
  await wait(async () => /校验失败/.test(await page.locator('#app-update-error').textContent()), 'checksum error rendered'); assert.equal(await page.locator('#app-update-install').isVisible(), false);
  await application.evaluate(() => { globalThis.__corruptUpdate = false; });
  await page.locator('#app-update-download').click(); await wait(async () => (await state()).update.phase === 'ready', 'verified update ready');
  assert.equal(fs.readFileSync(path.join(installed, 'old-marker'), 'utf8'), 'old', 'background download leaves the running application untouched');
  await page.locator('#app-update-install').waitFor({ state: 'visible' });
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true }); await page.screenshot({ path: path.join(root, 'artifacts/app-update-ready.png') });
  await page.locator('#app-update-install').click(); let dialog = await dialogPage(page, '#confirmation-dialog[open][data-kind="app-update"]');
  await dialog.locator('#confirmation-cancel').click(); await wait(async () => !(await state()).prompt, 'cancel install');
  assert.equal(fs.existsSync(path.join(installed, 'old-marker')), true);
  const requests = await application.evaluate(() => globalThis.__updateRequests); assert.equal(requests.length, 3); assert.ok(requests.every(request => request.credentials === 'omit'));
  assert.deepEqual(errors, []);
  const browserProcess = application.process();
  const nativePid = await application.evaluate(() => process.pid);
  await page.locator('#app-update-install').click(); dialog = await dialogPage(page, '#confirmation-dialog[open][data-kind="app-update"]');
  await dialog.locator('#confirmation-accept').click();
  dialog = await dialogPage(page, '#confirmation-dialog[open][data-kind="close-browser"]');
  await dialog.locator('#confirmation-restore').uncheck(); await dialog.locator('#confirmation-accept').click();
  await wait(() => browserProcess.exitCode !== null, 'browser orderly shutdown');
  if (process.env.LUNA_UPDATE_DIAGNOSTICS) {
    let alive; try { process.kill(nativePid, 0); alive = true; } catch { alive = false; }
    console.error('Shutdown PIDs', { wrapper: browserProcess.pid, wrapperCode: browserProcess.exitCode, nativePid, alive });
  }
  const log = path.join(profile, 'updates/install-result.log'); await wait(() => fs.existsSync(log), 'external updater completes');
  assert.match(fs.readFileSync(log, 'utf8'), /Updated successfully/);
  assert.equal(fs.readFileSync(path.join(installed, 'new-marker'), 'utf8'), 'new'); assert.equal(fs.existsSync(path.join(installed, 'old-marker')), false);
  const backups = fs.readdirSync(directory).filter(name => name.startsWith('.luna-backup-')); assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(directory, backups[0], 'old-marker'), 'utf8'), 'old');
  assert.equal(fs.existsSync(path.join(profile, 'browser-data.json')), true, 'profile survives updating');
  await application.close().catch(() => {}); application = null;
  const checks = ['real settings controls and manual check', 'download progress and SHA-256 rejection/retry', 'verified update ready and cancellation', 'orderly browser shutdown', 'external Windows updater replaces isolated application and launches it', 'previous application backup and profile retained'];
  fs.writeFileSync(path.join(root, 'artifacts/app-updates-result.json'), JSON.stringify({ passed: true, version: appVersion, checks, testedAt: new Date().toISOString() }, null, 2));
  console.log('PASS: ' + checks.join('; '));
}
run().catch(error => {
  console.error(error);
  for (const name of ['installer-output.log', 'installer-error.log', 'install-result.log']) {
    const log = path.join(directory, 'profile/updates', name); if (fs.existsSync(log)) console.error(name, fs.readFileSync(log, 'utf8'));
  }
  process.exitCode = 1;
}).finally(async () => {
  if (application) { await page?.screenshot({ path: path.join(root, 'artifacts/app-update-failure.png') }).catch(() => {}); await application.evaluate(({ app }) => app.exit(1)).catch(() => {}); await application.close().catch(() => {}); }
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
