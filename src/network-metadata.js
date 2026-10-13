// Electron webRequest handlers disable Chrome extension webRequest listeners.
// Observing CDP network events keeps extensions working and lets us distinguish
// GET downloads from POST responses, which must remain with Chromium.
function observeRequests(web) {
  const requests = new Map();
  try {
    web.debugger.attach('1.3');
    web.debugger.sendCommand('Network.enable', { maxTotalBufferSize: 0, maxResourceBufferSize: 0 }).catch(() => {});
    web.debugger.on('message', (_, method, params) => {
      if (method !== 'Network.requestWillBeSent') return;
      const request = params.request;
      if (!/^https?:\/\//i.test(request.url)) return;
      const headers = {};
      for (const [key, value] of Object.entries(request.headers)) {
        if (['authorization', 'referer', 'origin', 'user-agent'].includes(key.toLowerCase())) headers[key] = String(value);
      }
      requests.set(request.url, { method: request.method, headers, time: Date.now() });
      if (requests.size > 200) requests.delete(requests.keys().next().value);
    });
  } catch { /* downloads safely stay native if request metadata is unavailable */ }
  return requests;
}
module.exports = { observeRequests };
