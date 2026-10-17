const { dialogPage } = require('./dialog-helpers');
async function closeApp(application, page, restore) {
  const process = application.process();
  if (process.exitCode !== null || process.signalCode !== null) { await application.close().catch(() => {}); return; }
  const exited = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Browser did not close')), 15000);
    process.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  if (page && !page.isClosed()) {
    const existing = page.locator('#confirmation-dialog[open]');
    if (await existing.count()) await (await dialogPage(page, '#confirmation-dialog[open]')).locator('#confirmation-cancel').click();
    await page.evaluate(() => window.browser.command('close-window')).catch(() => {});
    const state = await Promise.race([
      page.waitForSelector('#confirmation-dialog[open]', { timeout: 5000 }).then(() => 'prompt').catch(() => 'closed'),
      exited.then(() => 'closed'),
    ]);
    if (state === 'prompt') {
      const layer = await dialogPage(page, '#confirmation-dialog[open]');
      if (typeof restore === 'boolean') await layer.locator('#confirmation-restore').setChecked(restore);
      await layer.locator('#confirmation-accept').click();
    }
  } else await application.close().catch(() => {});
  if (process.platform === 'darwin') {
    const start = Date.now();
    while (Date.now() - start < 15000 && await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length).catch(() => 0)) await new Promise(resolve => setTimeout(resolve, 40));
    await application.evaluate(({ app }) => app.quit()).catch(() => {});
  }
  await exited;
  await application.close().catch(() => {});
}
async function acceptPrompt(page, kind) {
  await page.waitForSelector('#confirmation-dialog[open]');
  if (kind && await page.locator('#confirmation-dialog').getAttribute('data-kind') !== kind) throw new Error('Unexpected prompt');
  await (await dialogPage(page, '#confirmation-dialog[open]')).locator('#confirmation-accept').click();
}
module.exports = { closeApp, acceptPrompt };
