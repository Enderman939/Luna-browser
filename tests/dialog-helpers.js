async function dialogPage(parent, selector = 'dialog[open]') {
  const owner = await parent.evaluate(() => window.browser.command('state')).then(state => String(state.windowId));
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    for (const candidate of parent.context().pages()) {
      if (candidate.isClosed() || !candidate.url().endsWith('/modal-layer.html')) continue;
      const belongs = await candidate.locator('body').getAttribute('data-owner-window').catch(() => null);
      if (belongs === owner && await candidate.locator(selector).isVisible().catch(() => false)) return candidate;
    }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error('Dialog layer not ready: ' + selector);
}
async function dialogClosed(layer) { return layer.isClosed() || await layer.locator('dialog[open]').count().catch(() => 0) === 0; }
module.exports = { dialogPage, dialogClosed };
