async function popupPage(application, kind) {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    const page = application.context().pages().find(page => { try { return new URL(page.url()).searchParams.get('popover') === kind; } catch { return false; } });
    if (page && !page.isClosed()) { await page.waitForSelector('body[data-popover]'); return page; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Popover did not open: ' + kind);
}
module.exports = { popupPage };
