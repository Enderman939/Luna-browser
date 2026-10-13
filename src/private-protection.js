const { EventEmitter } = require('node:events');
const domains = require('./privacy-domains.json');
const BLOCKED = new Set(domains.ads.concat(domains.trackers));
function blockedHost(input) {
  let url; try { url = new URL(input); } catch { return false; }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return false;
  let host = url.hostname.toLowerCase();
  while (host.includes('.')) {
    if (BLOCKED.has(host)) return true;
    host = host.slice(host.indexOf('.') + 1);
  }
  return false;
}
class PrivateProtection extends EventEmitter {
  constructor() { super(); this.pages = new Map(); }
  async attach(web) {
    const previous = this.pages.get(web.id);
    previous?.removeListeners();
    const page = { web, enabled: true, blocked: 0, cookieRestriction: false, ready: false };
    this.pages.set(web.id, page);
    const send = (method, params, sessionId) => sessionId ? web.debugger.sendCommand(method, params, sessionId) : web.debugger.sendCommand(method, params);
    const autoAttach = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
      filter: [{ type: 'worker', exclude: false }, { type: 'shared_worker', exclude: false }, { type: 'service_worker', exclude: false }, { type: 'iframe', exclude: false }, { exclude: true }] };
    const handler = (_, method, params, sessionId) => {
      if (method === 'Target.attachedToTarget') {
        const child = params.sessionId;
        // Install interception before a worker resumes, including fetch/XHR in
        // dedicated workers. A worker without the Fetch domain is resumed safely.
        Promise.all([
          send('Network.enable', {}, child).then(() => send('Network.setExtraHTTPHeaders', { headers: { DNT: '1', 'Sec-GPC': '1' } }, child)),
          send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, child),
          send('Target.setAutoAttach', autoAttach, child),
        ]).catch(() => {}).finally(() => send('Runtime.runIfWaitingForDebugger', {}, child).catch(() => {}));
        return;
      }
      if (method !== 'Fetch.requestPaused') return;
      const cancel = page.enabled && blockedHost(params.request.url);
      if (cancel) { page.blocked++; this.emit('change'); }
      send(cancel ? 'Fetch.failRequest' : 'Fetch.continueRequest', cancel
        ? { requestId: params.requestId, errorReason: 'BlockedByClient' }
        : { requestId: params.requestId }, sessionId).catch(() => {});
    };
    const detach = () => { page.ready = false; this.emit('change'); };
    page.removeListeners = () => { web.debugger.removeListener('message', handler); web.debugger.removeListener('detach', detach); };
    web.debugger.on('message', handler);
    web.debugger.on('detach', detach);
    web.once('destroyed', () => { this.pages.delete(web.id); });
    web.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    await send('Network.enable');
    await send('Network.setExtraHTTPHeaders', { headers: { DNT: '1', 'Sec-GPC': '1' } });
    // Fetch interception leaves native extension webRequest listeners intact.
    await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    await send('Target.setAutoAttach', autoAttach);
    page.ready = true;
    try {
      await send('Network.setCookieControls', { enableThirdPartyCookieRestriction: true, disableThirdPartyCookieMetadata: true, disableThirdPartyCookieHeuristics: true });
      page.cookieRestriction = true;
    } catch { /* report capability accurately rather than claiming it is active */ }
  }
  reset(web) { const page = this.pages.get(web.id); if (page) page.blocked = 0; }
  toggle(web, enabled) { const page = this.pages.get(web.id); if (page) { page.enabled = enabled === true; this.emit('change'); } }
  snapshot(web) {
    const page = web && this.pages.get(web.id);
    return { enabled: page?.enabled !== false && (!page || page.ready), blocked: page?.blocked || 0, thirdPartyCookies: page?.cookieRestriction === true,
      extensionStorage: false, coverage: 'known-domains' };
  }
}
module.exports = { PrivateProtection, blockedHost };
