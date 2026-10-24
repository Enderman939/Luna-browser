const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { DownloadHistory } = require('../src/download-history');
const { dialogPage } = require('./dialog-helpers');
const { popupPage } = require('./popover-helpers');
const { closeApp } = require('./app-helpers');

const root = path.resolve(__dirname, '..'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-delete-smoke-'));
const profile = path.join(directory, 'profile'), marker = path.join(directory, 'helper-started');
let application, page;
const command = (action, payload) => page.evaluate(({ action, payload }) => window.browser.command(action, payload), { action, payload });
const state = () => command('state');
async function wait(predicate, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw new Error('Timed out: ' + label);
}
async function run() {
  const fixture = path.join(directory, 'app'); fs.mkdirSync(fixture);
  const version = require('../package.json').version;
  fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'luna-browser', version, main: 'main.js' }));
  fs.writeFileSync(path.join(fixture, 'main.js'), `
    if (process.argv.includes('--luna-trash-helper')) {
      const fs = require('node:fs'), { shell } = require('electron');
      const original = shell.trashItem;
      shell.trashItem = async file => {
        fs.writeFileSync(${JSON.stringify(marker)}, file);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2200);
        if (file.includes('failure.txt')) throw new Error('Synthetic recycle failure');
        return original(file);
      };
    }
    require(${JSON.stringify(path.join(root, 'src/main.js'))});
  `);
  const files = Object.fromEntries(['success', 'failure', 'changed'].map(name => {
    const file = path.join(directory, name + '.txt'); fs.writeFileSync(file, 'synthetic ' + name); return [name, file];
  }));
  const history = new DownloadHistory(profile);
  history.import(Object.entries(files).map(([name, file], index) => ({ file, url: 'https://download.example/' + name, name: path.basename(file), createdAt: Date.now() - index * 1000, status: 'completed', total: 10, received: 10 })));
  const env = { ...process.env, LUNA_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ executablePath: require('electron'), args: [fixture, '--no-proxy-server'], env });
  page = await application.firstWindow(); await page.waitForSelector('.tab.selected');
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const rows = (await state()).downloads, record = name => rows.find(row => row.name === name + '.txt');
  async function openDownloads() { await page.locator('#downloads-button').click(); return popupPage(application, 'downloads'); }
  let popup = await openDownloads();
  const row = name => popup.locator(`.download-entry[data-id="${record(name).id}"]`);
  const red = async locator => {
    const color = await locator.evaluate(element => getComputedStyle(element).color);
    const [r, g, b] = color.match(/\d+/g).map(Number); assert.ok(r > g * 1.5 && r > b * 1.5, 'delete action is red: ' + color);
  };
  await red(row('success').locator('[data-action="delete-file"]'));
  await command('update-settings', { theme: 'dark' });
  await wait(async () => await popup.locator('html').getAttribute('data-theme') === 'dark', 'dark popup');
  await red(row('success').locator('[data-action="delete-file"]'));
  await row('success').locator('[data-action="delete-file"]').click();
  let dialog = await dialogPage(page, '#confirmation-dialog[open][data-kind="download-delete-file"]');
  await red(dialog.locator('#confirmation-accept'));
  await dialog.locator('#confirmation-cancel').click();
  await wait(async () => !(await state()).downloads.find(row => row.id === record('success').id).deleting, 'cancel restores state');
  assert.equal(fs.existsSync(files.success), true); assert.equal(fs.existsSync(marker), false);

  popup = await openDownloads(); await row('success').locator('[data-action="delete-file"]').click();
  dialog = await dialogPage(page, '#confirmation-dialog[open][data-kind="download-delete-file"]'); await dialog.locator('#confirmation-accept').click();
  await wait(() => fs.existsSync(marker), 'blocking shell call started in helper');
  const started = Date.now();
  await command('new-tab'); assert.equal((await state()).tabs.length, 2);
  const responseMs = Date.now() - started;
  assert.ok(responseMs < 1200, 'browser responds while helper is blocked: ' + responseMs + 'ms');
  const current = (await state()).downloads.find(row => row.id === record('success').id);
  assert.equal(current.deleting, true);
  popup = await openDownloads();
  await row('success').locator('[data-action="delete-file"]:disabled').waitFor();
  assert.equal(await row('success').locator('[data-action="delete-file"]').textContent(), '正在删除…');
  await command('download-action', { id: current.id, action: 'delete-file' });
  assert.equal((await state()).prompt, null, 'duplicate delete cannot open another confirmation');
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  await popup.screenshot({ path: path.join(root, 'artifacts/download-delete-pending.png') });
  await wait(async () => !(await state()).downloads.some(row => row.id === current.id), 'successful recycle removes record');
  assert.equal(fs.existsSync(files.success), false);

  await row('failure').locator('[data-action="delete-file"]').click();
  dialog = await dialogPage(page, '#confirmation-dialog[open][data-kind="download-delete-file"]'); await dialog.locator('#confirmation-accept').click();
  await wait(async () => (await state()).downloads.find(row => row.id === record('failure').id).error.includes('Synthetic recycle failure'), 'recycle failure reported');
  assert.equal(fs.existsSync(files.failure), true);
  assert.equal((await state()).downloads.find(row => row.id === record('failure').id).deleting, false);
  popup = await openDownloads(); await row('failure').locator('[data-action="delete-file"]:enabled').waitFor();
  await popup.screenshot({ path: path.join(root, 'artifacts/download-delete-error.png') });

  await row('changed').locator('[data-action="delete-file"]').click();
  dialog = await dialogPage(page, '#confirmation-dialog[open][data-kind="download-delete-file"]');
  fs.writeFileSync(files.changed, 'different data after the confirmation opened');
  await dialog.locator('#confirmation-accept').click();
  await wait(async () => (await state()).downloads.find(row => row.id === record('changed').id).error.includes('文件已变化'), 'changed file retained');
  assert.equal(fs.existsSync(files.changed), true);
  assert.deepEqual(errors, []);
  await closeApp(application, page, false); application = null;
  const persisted = new DownloadHistory(profile); assert.equal(persisted.records.size, 2);
  const result = { passed: true, version, responseWhileShellBlockedMs: responseMs, checks: ['red list and confirmation actions in light/dark themes', 'cancel keeps file and record', 'slow recycle isolated from browser main thread', 'pending UI and duplicate deletion guard', 'actual recycle succeeds', 'recycle failure keeps record and allows retry', 'file changed after confirmation is preserved'], testedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'artifacts/download-delete-result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (application) { await page?.screenshot({ path: path.join(root, 'artifacts/download-delete-failure.png') }).catch(() => {}); await application.evaluate(({ app }) => app.exit(1)).catch(() => {}); await application.close().catch(() => {}); }
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
