const { isWebUrl } = require('./core');
const fs = require('node:fs');
const path = require('node:path');
const securityBySession = new WeakMap();
const securedDelegates = new WeakSet();

function matchPattern(pattern, input, ignorePath = false) {
  let url; try { url = new URL(input); } catch { return false; }
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  if (pattern === '<all_urls>') return true;
  const match = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec(pattern);
  if (!match || match[1] !== '*' && match[1] + ':' !== url.protocol) return false;
  const host = match[2].toLowerCase(), actual = url.hostname.toLowerCase();
  if (!(host === '*' || host === actual || host.startsWith('*.') && (actual === host.slice(2) || actual.endsWith('.' + host.slice(2))))) return false;
  if (ignorePath) return true;
  const escaped = match[3].split('*').map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + escaped + '$').test(url.pathname + url.search);
}
function patternContains(declared, requested) {
  if (declared === requested) return true;
  if (declared === '<all_urls>') return /^(\*|https?):\/\//.test(requested);
  const outer = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec(declared), inner = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec(requested);
  if (!outer || !inner || outer[1] !== '*' && outer[1] !== inner[1]) return false;
  const host = inner[2].replace(/^\*\./, '');
  if (inner[2].includes('*') && outer[2] !== '*' && !(outer[2].startsWith('*.') && (host === outer[2].slice(2) || host.endsWith('.' + outer[2].slice(2))))) return false;
  return (outer[3] === '/*' || outer[3] === inner[3]) && matchPattern(declared, (inner[1] === '*' ? 'https' : inner[1]) + '://' + host + '/', true);
}
function extensionURL(input, extension) {
  const url = new URL(input, 'chrome-extension://' + extension.id + '/');
  if (isWebUrl(url.href) || url.protocol === 'chrome-extension:' && url.hostname === extension.id) return url.href;
  throw new Error('扩展不能打开此协议或其他扩展的页面');
}
function extensionResource(directory, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\0') || /[:]/.test(relative)) throw new Error('扩展资源路径无效');
  const root = fs.realpathSync(directory), file = fs.realpathSync(path.resolve(root, relative.replace(/^[/\\]+/, '')));
  const difference = path.relative(root, file);
  if (!difference || path.isAbsolute(difference) || difference === '..' || difference.startsWith('..' + path.sep) || !fs.statSync(file).isFile()) throw new Error('扩展资源超出安装目录');
  return file;
}

class ExtensionSecurity {
  constructor({ bridge, session, trustedRenderer }) {
    Object.assign(this, { bridge, session, trustedRenderer }); this.activeGrants = new Map();
    const router = bridge.ctx?.router;
    if (!router?.handlers || !router?.delegate || !bridge.api?.permissions?.permissionMap) throw new Error('扩展桥的安全适配接口不兼容，已停止加载扩展');
    this.router = router;
    const originalMessage = router.onExtensionMessage.bind(router);
    router.onExtensionMessage = async (event, id, name, ...args) => {
      if (!id) {
        if (!name.startsWith('browserAction.') || !trustedRenderer(event)) throw new Error('扩展接口调用者无效');
        const action = args[0]; if (name === 'browserAction.activate' && action?.eventType === 'click') this.grantActiveTab(action.extensionId, action.tabId);
        return originalMessage(event, id, name, ...args);
      }
      const extension = this.authenticate(event, id);
      this.authorize(id, name);
      if (name === 'tabs.create' && args[0]?.url) args[0] = { ...args[0], url: extensionURL(args[0].url, extension) };
      if (name === 'tabs.update') {
        const index = typeof args[0] === 'number' ? 1 : 0;
        if (args[index]?.url) args[index] = { ...args[index], url: extensionURL(args[index].url, extension) };
      }
      if (name === 'windows.create' && args[0]?.url) {
        const urls = Array.isArray(args[0].url) ? args[0].url : [args[0].url]; urls.forEach(url => extensionURL(url, extension));
      }
      if (name === 'tabs.insertCSS') {
        const tab = bridge.ctx.store.getTabById(args[0]);
        if (!tab || !this.hasHost(id, tab.getURL(), true, false, tab.id)) throw new Error('扩展没有此页面的访问权限');
      }
      if (name.startsWith('cookies.') && ['get', 'set', 'remove'].includes(name.split('.')[1])) {
        if (!this.hasHost(id, args[0]?.url, false, true)) throw new Error('扩展没有此网站的 Cookie 权限');
      }
      if (name === 'permissions.request') this.validatePermissionRequest(extension, args[0]);
      if (name === 'permissions.remove') {
        const request = args[0] || {}, current = this.grants(id);
        current.permissions = current.permissions.filter(permission => !request.permissions?.includes(permission));
        current.origins = current.origins.filter(origin => !request.origins?.includes(origin));
        return true;
      }
      if (name === 'browserAction.setPopup' && args[0]?.popup) {
        const url = extensionURL(args[0].popup, extension);
        if (!url.startsWith('chrome-extension://' + id + '/')) throw new Error('扩展弹窗必须属于自身');
      }
      if (name === 'browserAction.setIcon' && args[0]?.path) {
        const paths = typeof args[0].path === 'string' ? [args[0].path] : Object.values(args[0].path);
        paths.forEach(value => extensionResource(extension.path, value));
      }
      const result = await originalMessage(event, id, name, ...args);
      if (name === 'cookies.getAll') return result.filter(cookie => this.cookieAllowed(id, cookie));
      if (name === 'cookies.get' && result && !this.cookieAllowed(id, result)) return null;
      if (name.startsWith('tabs.')) {
        const info = name === 'tabs.query' ? args[0] : null;
        if (Array.isArray(result) && (info?.url || info?.title)) return result.filter(tab => this.canReadTab(id, tab)).map(tab => this.sanitize(id, tab));
        return this.sanitize(id, result);
      }
      if (name.startsWith('windows.')) return this.sanitize(id, result);
      return result;
    };
    const originalSend = router.sendEvent.bind(router);
    router.sendEvent = (target, name, ...args) => {
      const ids = target ? [target] : session.extensions.getAllExtensions().map(extension => extension.id);
      for (const id of ids) {
        try { this.authorize(id, name); } catch { continue; }
        if (name === 'cookies.onChanged' && !this.cookieAllowed(id, args[0]?.cookie)) continue;
        if ((name.startsWith('webNavigation.') || name.startsWith('webRequest.')) && args[0]?.url && !this.hasHost(id, args[0].url)) continue;
        if (['browserAction.onClicked', 'contextMenus.onClicked'].includes(name)) this.grantActiveTab(id, args.at(-1)?.id);
        const outgoing = args.map(value => this.sanitize(id, value));
        if (name === 'tabs.onUpdated' && !this.canReadTab(id, args[2])) {
          outgoing[1] = { ...outgoing[1] }; for (const field of ['url', 'title', 'favIconUrl', 'pendingUrl']) delete outgoing[1][field];
        }
        originalSend(id, name, ...outgoing);
      }
    };
    const { ipcMain } = require('electron'), delegate = router.delegate;
    securityBySession.set(session, this);
    if (!securedDelegates.has(delegate)) {
      securedDelegates.add(delegate);
      for (const [method, channel] of [['onAddListener', 'crx-add-listener'], ['onRemoveListener', 'crx-remove-listener']]) {
        const original = delegate[method];
        delegate[method] = (event, id, name) => {
          const security = securityBySession.get(event.type === 'service-worker' ? event.session : event.sender?.session);
          if (!security) return;
          try { security.authenticate(event, id); if (method === 'onAddListener') security.authorize(id, name); }
          catch { return; }
          return original(event, id, name);
        };
        ipcMain.removeListener(channel, original); ipcMain.on(channel, delegate[method]);
      }
    }
    session.extensions.on('extension-unloaded', (_, extension) => this.activeGrants.delete(extension.id));
  }
  authenticate(event, id) {
    const eventSession = event.type === 'service-worker' ? event.session : event.sender?.session;
    const extension = this.session.extensions.getExtension(id);
    const source = event.type === 'service-worker' ? event.serviceWorker?.scope : event.senderFrame?.origin || event.senderFrame?.url;
    let url; try { url = new URL(source); } catch { /* rejected below */ }
    if (eventSession !== this.session || !extension || url?.protocol !== 'chrome-extension:' || url.hostname !== id) throw new Error('扩展身份与实际调用来源不一致');
    return extension;
  }
  dispose() { securityBySession.delete(this.session); }
  grants(id) {
    const extension = this.session.extensions.getExtension(id), manifest = extension?.manifest || {};
    return this.bridge.api.permissions.permissionMap.get(id) || { permissions: manifest.permissions || [], origins: manifest.host_permissions || [] };
  }
  hosts(id) { const grants = this.grants(id); return [...grants.origins, ...grants.permissions.filter(value => typeof value === 'string' && (value.includes('://') || value === '<all_urls>'))]; }
  authorize(id, name) {
    if (!this.session.extensions.getExtension(id)) throw new Error('扩展未启用');
    const namespace = name.split('.')[0], required = { cookies: 'cookies', contextMenus: 'contextMenus', notifications: 'notifications', webNavigation: 'webNavigation', webRequest: 'webRequest' }[namespace];
    if (required && !this.grants(id).permissions.includes(required)) throw new Error('扩展缺少 ' + required + ' 权限');
  }
  hasHost(id, url, active = false, ignorePath = false, tabId) {
    if (this.hosts(id).some(pattern => matchPattern(pattern, url, ignorePath))) return true;
    if (!active || !isWebUrl(url)) return false;
    const origin = new URL(url).origin, grant = this.activeGrants.get(id)?.get(tabId);
    if (!grant || grant.origin !== origin || grant.web.isDestroyed()) return false;
    try { return new URL(grant.web.getURL()).origin === origin; } catch { return false; }
  }
  grantActiveTab(id, tabId) {
    if (!this.grants(id).permissions.includes('activeTab')) return;
    const web = this.bridge.ctx.store.getTabById(tabId);
    if (!web || !isWebUrl(web.getURL())) return;
    if (!this.activeGrants.has(id)) this.activeGrants.set(id, new Map());
    if (!this.activeGrants.get(id).has(tabId)) web.once('destroyed', () => this.activeGrants.get(id)?.delete(tabId));
    this.activeGrants.get(id).set(tabId, { web, origin: new URL(web.getURL()).origin });
  }
  cookieAllowed(id, cookie) {
    if (!cookie?.domain) return false;
    const domain = cookie.domain.replace(/^\./, '').toLowerCase(), schemes = cookie.secure ? ['https'] : ['http', 'https'];
    const candidates = new Set([domain]);
    if (!cookie.hostOnly) for (const pattern of this.hosts(id)) {
      const host = /^(?:\*|https?):\/\/([^/]+)/.exec(pattern)?.[1].replace(/^\*\./, '').toLowerCase();
      if (host && (host === domain || host.endsWith('.' + domain))) candidates.add(host);
    }
    return [...candidates].some(host => schemes.some(scheme => this.hasHost(id, scheme + '://' + host + '/', false, true)));
  }
  canReadTab(id, tab) {
    if (!tab) return false;
    return this.grants(id).permissions.includes('tabs') || tab.url?.startsWith('chrome-extension://' + id + '/') || this.hasHost(id, tab.url, true, false, tab.id);
  }
  sanitize(id, value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(entry => this.sanitize(id, entry));
    const result = { ...value };
    if (Array.isArray(result.tabs)) result.tabs = this.sanitize(id, result.tabs);
    if ('id' in result && ('windowId' in result || 'active' in result) && !this.canReadTab(id, result)) for (const field of ['url', 'title', 'favIconUrl', 'pendingUrl']) delete result[field];
    return result;
  }
  validatePermissionRequest(extension, request = {}) {
    const manifest = extension.manifest, permissions = [...(manifest.permissions || []), ...(manifest.optional_permissions || [])];
    const origins = [...(manifest.host_permissions || []), ...(manifest.optional_host_permissions || []), ...permissions.filter(value => typeof value === 'string' && (value.includes('://') || value === '<all_urls>'))];
    if (request.permissions && (!Array.isArray(request.permissions) || request.permissions.some(value => !permissions.includes(value)))) throw new Error('不能申请未声明的扩展权限');
    if (request.origins && (!Array.isArray(request.origins) || request.origins.some(value => !origins.some(origin => patternContains(origin, value))))) throw new Error('不能申请未声明的网站权限');
  }
}
module.exports = { ExtensionSecurity, matchPattern, patternContains, extensionURL, extensionResource };
