const { isWebUrl } = require('./core');
function originOf(value) { try { return isWebUrl(value) && !new URL(value).username && !new URL(value).password ? new URL(value).origin : null; } catch { return null; } }
function matchesHost(cookie, url) {
  try {
    const host = new URL(url).hostname.toLowerCase(), domain = String(cookie.domain || '').replace(/^\./,'').toLowerCase();
    return !!domain && (host === domain || cookie.hostOnly !== true && host.endsWith('.'+domain)) && !cookie.partitionKey;
  } catch { return false; }
}
function cookieKey(cookie) { return [String(cookie.domain || '').replace(/^\./,'').toLowerCase(),cookie.path || '/',cookie.name].join('|'); }
function normalizeCookie(value, url) {
  if (!originOf(url) || !value || typeof value.name !== 'string' || value.name.length > 4096 || typeof value.value !== 'string' || value.value.length > 16384 || /[\x00-\x1f;\r\n]/.test(value.name) || !matchesHost(value,url)) return null;
  const path = typeof value.path === 'string' && value.path.startsWith('/') && value.path.length <= 8192 ? value.path : '/';
  const cookie = { name: value.name, value: value.value, domain: String(value.domain).toLowerCase(), path, secure: value.secure === true, httpOnly: value.httpOnly === true, hostOnly: value.hostOnly === true, sameSite: ['strict','lax','no_restriction','unspecified'].includes(value.sameSite) ? value.sameSite : 'unspecified' };
  if (Number.isFinite(value.expirationDate)) cookie.expirationDate = value.expirationDate;
  return cookie;
}
function cookieURL(cookie, site) {
  const target = new URL(site); target.protocol = cookie.secure ? 'https:' : target.protocol;
  const scope = cookie.path || '/'; target.pathname = scope.endsWith('/') ? scope : scope + '/'; target.search = ''; target.hash = ''; return target.href;
}
function cookieDetails(cookie, site) {
  const value = normalizeCookie(cookie,site); if (!value) throw new Error('Invalid IE cookie scope');
  const result = { ...value, url: cookieURL(value,site) }; delete result.hostOnly;
  if (value.hostOnly) delete result.domain;
  if (result.sameSite === 'no_restriction' && !result.secure) result.sameSite = 'unspecified';
  return result;
}
function fingerprint(cookie) { return JSON.stringify([cookie.value,cookie.domain.replace(/^\./,''),cookie.path,cookie.secure,cookie.httpOnly,cookie.hostOnly,cookie.sameSite,cookie.expirationDate ?? null]); }
function sanitizeStorage(value, expectedOrigin) {
  if (!value || value.origin !== expectedOrigin || !originOf(expectedOrigin)) return null;
  const clean = { origin: expectedOrigin, local: Object.create(null), session: Object.create(null) };
  let bytes = 0;
  for (const kind of ['local','session']) {
    if (!value[kind] || typeof value[kind] !== 'object' || Array.isArray(value[kind])) return null;
    const entries = Object.entries(value[kind]); if (entries.length > 5000) return null;
    for (const [key,text] of entries) { if (typeof text !== 'string') return null; bytes += Buffer.byteLength(key+text,'utf8'); if (bytes > 1024*1024) return null; clean[kind][key] = text; }
  }
  return clean;
}
const READ_STORAGE = `(()=>{function read(s){const o=Object.create(null);for(let i=0;i<s.length;i++){const k=s.key(i);o[k]=s.getItem(k)}return o}return {origin:location.origin,local:read(localStorage),session:read(sessionStorage)}})()`;
function storageScript(value) {
  return `(function(d){if(location.origin!==d.origin)return false;function put(s,o){s.clear();Object.keys(o).forEach(function(k){s.setItem(k,o[k])})}put(localStorage,d.local);put(sessionStorage,d.session);return true})(${JSON.stringify(value)})`;
}
module.exports = { originOf, matchesHost, cookieKey, normalizeCookie, cookieURL, cookieDetails, fingerprint, sanitizeStorage, READ_STORAGE, storageScript };
