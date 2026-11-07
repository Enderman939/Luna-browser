const aborted = error => error?.errno === -3 || error?.code === 'ERR_ABORTED';

// Chromium can cancel its first startup navigation before a document commits.
// A saved GET may be retried once, but never a user stop, a newer navigation,
// a committed document or a real network error.
async function loadPage({ web, url, ready, restoring = false, current, stopped, committed, failed }) {
  try {
    await ready;
    if (!current() || stopped()) return;
    try { await web.loadURL(url); }
    catch (error) {
      const empty = !web.getURL() || web.getURL() === 'about:blank';
      if (!restoring || !aborted(error) || !empty || committed() || !current() || stopped()) throw error;
      await new Promise(resolve => setImmediate(resolve));
      if (!current() || stopped()) return;
      await web.loadURL(url);
    }
  } catch (error) {
    if (current() && !stopped()) failed(error);
  }
}

module.exports = { loadPage };
