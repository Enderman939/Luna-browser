const { isWebUrl } = require('./core');

const PERMISSIONS = Object.freeze({ camera: '摄像头', microphone: '麦克风', geolocation: '位置信息', notifications: '通知', 'clipboard-read': '读取剪贴板' });
function secureOrigin(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password || !isWebUrl(url.href)) return null;
    return url.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ? url.origin : null;
  } catch { return null; }
}
function permissionKeys(permission, details = {}) {
  if (permission === 'media') {
    const types = details.mediaTypes || (details.mediaType ? [details.mediaType] : []);
    if (!types.length || types.some(type => !['video', 'audio'].includes(type))) return [];
    return [...new Set(types.map(type => type === 'video' ? 'camera' : 'microphone'))];
  }
  return Object.hasOwn(PERMISSIONS, permission) ? [permission] : [];
}
function requestOrigin(web, requesting, details = {}) {
  if (!web || web.isDestroyed()) return null;
  const top = secureOrigin(web.getURL()), origin = secureOrigin(requesting);
  if (!top || origin !== top) return null;
  if (details.embeddingOrigin && secureOrigin(details.embeddingOrigin) !== top) return null;
  if (details.isMainFrame === false) {
    const frames = web.mainFrame?.framesInSubtree?.filter(frame => secureOrigin(frame.url) === origin && frame.url === (details.requestingUrl || requesting)) || [];
    if (!frames.length || frames.some(frame => { for (let ancestor = frame.parent; ancestor; ancestor = ancestor.parent) if (secureOrigin(ancestor.url) !== top) return true; return false; })) return null;
  }
  return origin;
}
class SitePermissions {
  constructor({ session, store, owner, changed }) {
    Object.assign(this, { session, store, owner, changed }); this.pending = new Map();
    session.setPermissionCheckHandler((web, permission, requesting, details) => this.check(web, permission, requesting, details));
    session.setPermissionRequestHandler((web, permission, callback, details) => {
      this.request(web, permission, details || {}).then(callback, () => callback(false));
    });
  }
  decision(origin, key) { return this.store.data.siteSettings[origin]?.permissions?.[key] || 'ask'; }
  set(origin, key, value) {
    if (!secureOrigin(origin) || !Object.hasOwn(PERMISSIONS, key) || !['ask', 'allow', 'block'].includes(value)) throw new Error('无效的网站权限');
    const previous = this.store.data.siteSettings[origin] || {}, permissions = { ...previous.permissions };
    if (value === 'ask') delete permissions[key]; else permissions[key] = value;
    this.store.data.siteSettings[origin] = { ...previous, time: Date.now(), permissions }; this.store.save(); this.changed();
  }
  check(web, permission, requesting, details = {}) {
    if (!this.owner(web)) return false;
    const origin = requestOrigin(web, details.securityOrigin || details.requestingUrl || requesting, details);
    if (!origin) return false;
    if (['fullscreen', 'clipboard-sanitized-write'].includes(permission)) return true;
    const keys = permissionKeys(permission, details);
    return !!keys.length && keys.every(key => this.decision(origin, key) === 'allow');
  }
  async request(web, permission, details) {
    const browser = this.owner(web), origin = requestOrigin(web, details.requestingUrl || web.getURL(), details);
    if (!browser || !origin) return false;
    if (['fullscreen', 'clipboard-sanitized-write'].includes(permission)) return true;
    const keys = permissionKeys(permission, details);
    if (!keys.length || keys.some(key => this.decision(origin, key) === 'block')) return false;
    const currentURL = web.getURL(), unknown = keys.filter(key => this.decision(origin, key) !== 'allow');
    if (!unknown.length) return true;
    const id = web.id + ':' + origin + ':' + unknown.join(',');
    if (this.pending.has(id)) return this.pending.get(id);
    const task = (async () => {
      const result = await browser.prompts.ask({ kind: 'site-permission', permissionTarget: web.id, title: '网站权限', message: origin + ' 请求使用' + unknown.map(key => PERMISSIONS[key]).join('、'),
        detail: '选择允许或拒绝会记住此网站的设置。可点击地址栏左侧的网站信息按钮修改。' + (browser.isPrivate ? '无痕授权仅在本次无痕会话有效。' : ''), confirmLabel: '允许', cancelLabel: '拒绝' });
      if (result.cancelled || web.isDestroyed() || web.getURL() !== currentURL || this.owner(web) !== browser || browser.window?.isDestroyed() || keys.some(key => this.decision(origin, key) === 'block')) return false;
      for (const key of unknown) this.set(origin, key, result.accepted ? 'allow' : 'block');
      return result.accepted;
    })();
    this.pending.set(id, task);
    try { return await task; } finally { this.pending.delete(id); }
  }
  snapshot(origin) { return Object.entries(PERMISSIONS).map(([key, label]) => ({ key, label, value: this.decision(origin, key) })); }
}
module.exports = { SitePermissions, PERMISSIONS, permissionKeys, secureOrigin, requestOrigin };
