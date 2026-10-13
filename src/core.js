const SEARCH_ENGINES = {
  baidu: { name: '百度', prefix: 'https://www.baidu.com/s?wd=' },
  google: { name: 'Google', prefix: 'https://www.google.com/search?q=' },
  bing: { name: 'Bing', prefix: 'https://www.bing.com/search?q=' },
  duckduckgo: { name: 'DuckDuckGo', prefix: 'https://duckduckgo.com/?q=' },
};
const HOME = 'luna://newtab';
const SETTINGS = 'luna://settings';
const EXTENSIONS = 'luna://extensions';
const { DEFAULT_APPEARANCE, sanitizeAppearance } = require('./ui/appearance-model');
const { sanitizeBookmarks } = require('./bookmarks');
const DEFAULT_SETTINGS = Object.freeze({
  searchEngine: 'baidu', theme: 'light', showBookmarks: true, showHome: true,
  showShortcuts: true, startup: 'restore', homePage: '', downloadPath: '', askDownload: true,
  parallelDownloads: true, downloadThreads: 8,
  savePasswords: true, autofillPasswords: true,
  appearance: DEFAULT_APPEARANCE,
});

function sanitizeSettings(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const settings = { ...DEFAULT_SETTINGS };
  if (Object.hasOwn(SEARCH_ENGINES, value.searchEngine)) settings.searchEngine = value.searchEngine;
  if (['light', 'dark', 'system'].includes(value.theme)) settings.theme = value.theme;
  if (['restore', 'newtab'].includes(value.startup)) settings.startup = value.startup;
  for (const key of ['showBookmarks', 'showHome', 'showShortcuts', 'askDownload', 'parallelDownloads', 'savePasswords', 'autofillPasswords']) {
    if (typeof value[key] === 'boolean') settings[key] = value[key];
  }
  if ([1, 2, 4, 8, 16].includes(value.downloadThreads)) settings.downloadThreads = value.downloadThreads;
  if (typeof value.homePage === 'string' && isWebUrl(value.homePage)) settings.homePage = value.homePage.slice(0, 8192);
  if (typeof value.downloadPath === 'string' && value.downloadPath.length < 4096) settings.downloadPath = value.downloadPath;
  settings.appearance = sanitizeAppearance(value.appearance);
  return settings;
}
function isInternalUrl(url) { return url === HOME || url === SETTINGS || url === EXTENSIONS; }
function isSessionUrl(url) {
  if (isWebUrl(url) || isInternalUrl(url) || isViewSourceUrl(url)) return true;
  try { const parsed = new URL(url); return parsed.protocol === 'chrome-extension:' && /^[a-p]{32}$/.test(parsed.hostname); } catch { return false; }
}

function resolveAddress(input, engine = DEFAULT_SETTINGS.searchEngine) {
  const prefix = (Object.hasOwn(SEARCH_ENGINES, engine) ? SEARCH_ENGINES[engine] : SEARCH_ENGINES.baidu).prefix;
  const text = String(input || '').trim();
  if (!text || text === HOME) return HOME;
  if (text === SETTINGS || text === EXTENSIONS) return text;
  if (isViewSourceUrl(text)) return 'view-source:' + new URL(text.slice(12)).href;
  if (/^https?:\/\//i.test(text)) {
    try { return new URL(text).href; } catch { return prefix + encodeURIComponent(text); }
  }
  // Host:port must be recognized before the protocol guard (localhost:3000).
  if (/^(localhost|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?([/?#].*)?$/i.test(text)) {
    try { return new URL('http://' + text).href; } catch { /* search instead */ }
  }
  if (!/\s/.test(text) && /^(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}(?::\d+)?(?:[/?#].*)?$/u.test(text)) {
    try { return new URL('https://' + text).href; } catch { /* search instead */ }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(text)) return HOME;
  return prefix + encodeURIComponent(text);
}

function isWebUrl(url) {
  try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; }
}
function isViewSourceUrl(url) { return typeof url === 'string' && url.startsWith('view-source:') && isWebUrl(url.slice(12)); }
function resolveWebsite(input) {
  const text = String(input || '').trim();
  const resolved = resolveAddress(text);
  if (!text || !isWebUrl(resolved)) return null;
  if (!/^https?:\/\//i.test(text) && Object.values(SEARCH_ENGINES).some(engine => resolved.startsWith(engine.prefix))) return null;
  return resolved;
}

function cleanEntry(entry) {
  if (!entry || !isWebUrl(entry.url)) return null;
  return { url: entry.url, title: String(entry.title || entry.url).slice(0, 300), time: Number(entry.time) || Date.now() };
}

function sanitizeData(data = {}) {
  if (!data || typeof data !== 'object') data = {};
  const cleanList = value => Array.isArray(value) ? value.map(cleanEntry).filter(Boolean) : [];
  const bookmarks = sanitizeBookmarks(data.bookmarks, data.bookmarkFolders);
  return {
    ...bookmarks,
    history: cleanList(data.history).slice(0, 500),
    session: Array.isArray(data.session) ? data.session.filter(isSessionUrl).slice(0, 30) : [],
    sessionWindows: Array.isArray(data.sessionWindows) ? data.sessionWindows.slice(0, 12).map(value => require('./workspace-model').sanitizeLayout(value)).filter(Boolean) : [],
    sessionActive: Number.isInteger(data.sessionActive) ? Math.max(0, Math.min(29, data.sessionActive)) : 0,
    restoreOnce: typeof data.restoreOnce === 'boolean' ? data.restoreOnce : null,
    siteActivity: Object.fromEntries(Object.entries(data.siteActivity || {}).filter(([origin, time]) => isWebUrl(origin) && Number.isFinite(time)).slice(-1000)),
    siteSettings: Object.fromEntries(Object.entries(data.siteSettings || {}).filter(([origin, value]) => isWebUrl(origin) && value && Number.isFinite(value.time)).slice(-1000)),
    cookieTimes: Object.fromEntries(Object.entries(data.cookieTimes || {}).filter(([, time]) => Number.isFinite(time)).slice(-10000)),
    shortcuts: [...new Map(cleanList(data.shortcuts).map(entry => [entry.url, entry])).values()].slice(0, 8),
    settings: sanitizeSettings(data.settings),
    icons: Object.fromEntries(Object.entries(data.icons && typeof data.icons === 'object' ? data.icons : {}).filter(([origin, icon]) => isWebUrl(origin) && typeof icon === 'string' && /^data:image\/(?:png|jpeg|svg\+xml);base64,/.test(icon) && icon.length <= 128 * 1024).slice(-100)),
  };
}

function recentSites(history, shortcuts = [], limit = 8) {
  const sites = new Map();
  for (const entry of [...shortcuts, ...history]) {
    if (!entry || !isWebUrl(entry.url)) continue;
    const origin = new URL(entry.url).origin;
    if (!sites.has(origin)) sites.set(origin, entry);
    if (sites.size >= limit) break;
  }
  return [...sites.values()];
}

module.exports = { HOME, SETTINGS, EXTENSIONS, SEARCH_ENGINES, DEFAULT_SETTINGS, resolveAddress, resolveWebsite, isWebUrl, isViewSourceUrl, isInternalUrl, isSessionUrl, sanitizeData, sanitizeSettings, recentSites };
