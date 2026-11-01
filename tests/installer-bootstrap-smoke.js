const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { fileURLToPath } = require('node:url');

async function run(installer) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-bootstrap-smoke-'));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  let browser, child, extractedRoot;
  try {
    child = spawn(installer, [`--remote-debugging-port=${port}`], { env: { ...process.env, LUNA_USER_DATA: path.join(scratch, 'profile'), LUNA_INSTALLER_TEST: '1' }, windowsHide: false, stdio: 'ignore' });
    const ended = new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    let connected = false;
    for (let attempt = 0; attempt < 300; attempt++) {
      if (child.exitCode !== null) throw new Error('Installer exited before displaying its window: ' + child.exitCode);
      try { const response = await fetch(`http://127.0.0.1:${port}/json/version`); if (response.ok) { connected = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(connected, true, 'single-file executable starts the React runtime');
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.waitForEvent('page');
    await page.waitForSelector('.glow-button');
    assert.equal(await page.title(), 'Luna Browser Setup');
    assert.equal(await page.locator('h2').textContent(), 'Install Luna Browser');
    const applicationPath = fileURLToPath(page.url());
    const split = applicationPath.split(path.sep + 'app' + path.sep + 'resources' + path.sep);
    assert.equal(split.length, 2);
    extractedRoot = split[0]; assert.match(path.basename(extractedRoot), /^LunaSetup-[a-f0-9]{32}$/);
    await page.locator('.window-close').click();
    const code = await Promise.race([ended, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Bootstrap did not exit after closing the installer')), 15000); timer.unref(); })]);
    assert.equal(code, 0);
    assert.equal(fs.existsSync(extractedRoot), false, 'bootstrap removes its extracted runtime');
    const target = path.join(scratch, 'Luna 安装 & Test');
    const result = spawnSync(installer, ['--silent', '--install-dir', target], { env: { ...process.env, LUNA_USER_DATA: path.join(scratch, 'profile'), LUNA_INSTALLER_TEST: '1' }, windowsHide: true, timeout: 30000 });
    assert.equal(result.status, 0, 'outer executable forwards silent arguments');
    assert.equal(fs.existsSync(path.join(target, 'luna.exe')), true);
    assert.equal(spawnSync(path.join(target, 'Luna-Uninstall.exe'), ['--silent'], { env: { ...process.env, LUNA_INSTALLER_TEST: '1' }, windowsHide: true }).status, 0);
    for (let attempt = 0; attempt < 100 && fs.existsSync(target); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(fs.existsSync(target), false);
    console.log('PASS final single-file executable: React UI, normal close, temporary cleanup, silent install with Unicode/spaces/ampersand path and uninstall');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (child && child.exitCode === null) child.kill();
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

run(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1; });
