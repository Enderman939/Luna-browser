const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const metadata = require('../package.json');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-runtime-'));
let application;
async function run() {
  const env = { ...process.env, LUNA_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ executablePath: process.env.LUNA_EXECUTABLE || require('electron'), args: process.env.LUNA_EXECUTABLE ? [] : [root], env, timeout: 30000 });
  const page = await application.firstWindow(); await page.waitForSelector('.tab.selected');
  const runtime = await application.evaluate(({ app }) => ({ version: app.getVersion(), electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node, platform: process.platform, arch: process.arch, executable: process.execPath, packaged: app.isPackaged }));
  assert.equal(runtime.version, metadata.version);
  assert.equal(runtime.electron, metadata.devDependencies.electron);
  if (runtime.electron === '45.2.3') {
    assert.equal(runtime.chromium, '156.0.8078.80'); assert.equal(runtime.node, '24.22.2');
  }
  if (process.env.LUNA_EXECUTABLE) assert.equal(runtime.packaged, true);
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts/runtime-result.json'), JSON.stringify({ passed: true, ...runtime, testedAt: new Date().toISOString() }, null, 2) + '\n');
  console.log('PASS actual runtime:', JSON.stringify(runtime));
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (application) { await application.evaluate(({ app }) => app.exit(0)).catch(() => {}); await application.close().catch(() => {}); }
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
