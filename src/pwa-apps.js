const { createHash } = require('node:crypto');

function webURL(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
    return url;
  } catch { return null; }
}
function appId(startURL) { return createHash('sha256').update(new URL(startURL).origin + '\n' + new URL(startURL).pathname).digest('hex').slice(0, 32); }
function withinScope(url, scope) {
  const target = webURL(url), base = webURL(scope);
  const prefix = base?.pathname.endsWith('/') ? base.pathname : base?.pathname + '/';
  return !!target && !!base && target.origin === base.origin && (target.pathname === base.pathname || target.pathname.startsWith(prefix));
}
function sanitizeManifest(manifest, pageURL, manifestURL) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('网站应用清单格式无效');
  const page = webURL(pageURL); if (!page) throw new Error('网站应用必须使用安全网页');
  let start; try { start = webURL(new URL(String(manifest.start_url || page.pathname || '/'), page).href); } catch { start = null; }
  if (!start || start.origin !== page.origin) throw new Error('网站应用必须使用当前网站的安全来源');
  const scope = webURL(new URL(String(manifest.scope || start.pathname.replace(/[^/]*$/, '')), start).href);
  if (!scope || scope.origin !== start.origin || !withinScope(start.href, scope.href)) throw new Error('网站应用范围无效');
  const name = String(manifest.name || manifest.short_name || page.hostname).trim().slice(0, 120);
  if (!name) throw new Error('网站应用缺少名称');
  const icons = Array.isArray(manifest.icons) ? manifest.icons.slice(0, 32).map(icon => {
    if (!icon || typeof icon !== 'object' || typeof icon.src !== 'string') return null;
    try { const source = new URL(icon.src, manifestURL || page.href); return webURL(source.href) && source.origin === page.origin ? source.href : null; } catch { return null; }
  }).filter(Boolean) : [];
  return { id: appId(start.href), origin: page.origin, startUrl: start.href, scope: scope.href, name, shortName: String(manifest.short_name || name).slice(0, 60),
    description: String(manifest.description || '').slice(0, 300), display: ['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display) ? manifest.display : 'standalone',
    themeColor: typeof manifest.theme_color === 'string' && /^#[0-9a-f]{3,8}$/i.test(manifest.theme_color) ? manifest.theme_color : '', icons, createdAt: Date.now() };
}
function sanitizeInstalledApps(value) {
  if (!Array.isArray(value)) return [];
  return value.map(entry => { try {
    const start = webURL(entry.startUrl), origin = webURL(entry.origin), scope = webURL(entry.scope || entry.startUrl);
    if (!start || !origin || !scope || start.origin !== origin.origin || scope.origin !== origin.origin || !withinScope(start.href, scope.href) || !/^[a-f0-9]{24,64}$/.test(entry.id)) return null;
    return { id: entry.id, origin: origin.origin, startUrl: start.href, scope: scope.href, name: String(entry.name || origin.hostname).slice(0, 120), shortName: String(entry.shortName || entry.name || origin.hostname).slice(0, 60), description: String(entry.description || '').slice(0, 300), display: ['standalone', 'fullscreen', 'minimal-ui'].includes(entry.display) ? entry.display : 'standalone', themeColor: typeof entry.themeColor === 'string' && /^#[0-9a-f]{3,8}$/i.test(entry.themeColor) ? entry.themeColor : '', icons: Array.isArray(entry.icons) ? entry.icons.filter(icon => webURL(icon)?.origin === origin.origin).slice(0, 32) : [], createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now() };
  } catch { return null; } }).filter(Boolean).slice(0, 100);
}
module.exports = { webURL, appId, withinScope, sanitizeManifest, sanitizeInstalledApps };
