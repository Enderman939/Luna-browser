const fs = require('node:fs');
const path = require('node:path');

const RANGES = { quarter: 15 * 60e3, hour: 60 * 60e3, day: 24 * 60 * 60e3, week: 7 * 24 * 60 * 60e3, month: 28 * 24 * 60 * 60e3, all: Infinity };
const TYPES = ['history', 'cookies', 'cache', 'downloads', 'siteSettings', 'passwords'];
function rangeStart(range, now = Date.now()) {
  if (!Object.hasOwn(RANGES, range)) throw new Error('无效的时间范围');
  return range === 'all' ? 0 : now - RANGES[range];
}
function cookieKey(cookie) { return [cookie.domain, cookie.path || '/', cookie.name, cookie.secure ? '1' : '0'].join('|'); }
function inRange(time, start, end) { return Number.isFinite(time) && time >= start && time <= end; }
function nativeCookieTimes(directory) {
  let database;
  try {
    const file = path.join(directory, 'Network', 'Cookies');
    if (!fs.existsSync(file)) return {};
    const { DatabaseSync } = require('node:sqlite');
    database = new DatabaseSync(file, { readOnly: true });
    const rows = database.prepare('SELECT host_key, name, path, is_secure, CAST(creation_utc AS REAL) / 1000 - 11644473600000 AS time FROM cookies').all();
    return Object.fromEntries(rows.map(row => [cookieKey({ domain: row.host_key, path: row.path, name: row.name, secure: !!row.is_secure }), row.time]));
  } catch { return {}; } finally { database?.close(); }
}

class BrowsingData {
  constructor({ session, store, downloadManager, nativeDownloads, downloadHistory, tabs, passwordVault }) {
    Object.assign(this, { session, store, downloadManager, nativeDownloads, downloadHistory, tabs, passwordVault });
    this.busy = false;
    session.cookies.on('changed', (_, cookie, cause, removed) => {
      const key = cookieKey(cookie);
      if (removed && cause !== 'overwrite') delete store.data.cookieTimes[key];
      else if (!removed && !store.data.cookieTimes[key]) store.data.cookieTimes[key] = Date.now();
      clearTimeout(this.cookieTimer);
      this.cookieTimer = setTimeout(() => { try { store.save(); } catch { /* retry on next save */ } }, 200);
      this.cookieTimer.unref();
    });
  }
  async selected(range) {
    await this.session.cookies.flushStore();
    const cookies = await this.session.cookies.get({});
    const nativeTimes = nativeCookieTimes(this.session.getStoragePath() || '');
    const now = Date.now(), start = rangeStart(range, now);
    const selectedCookies = cookies.filter(cookie => range === 'all' || inRange(nativeTimes[cookieKey(cookie)] ?? this.store.data.cookieTimes[cookieKey(cookie)], start, now));
    const activity = { ...Object.fromEntries(this.store.data.history.map(entry => [new URL(entry.url).origin, entry.time])), ...this.store.data.siteActivity };
    const origins = Object.keys(activity).filter(origin => range === 'all' || inRange(activity[origin], start, now));
    return { now, start, cookies: selectedCookies, origins, unknownCookies: cookies.filter(cookie => !(nativeTimes[cookieKey(cookie)] ?? this.store.data.cookieTimes[cookieKey(cookie)])).length };
  }
  async stats(range) {
    const selection = await this.selected(range);
    const ended = entry => ['completed', 'cancelled'].includes(entry.status) && inRange(entry.createdAt, selection.start, selection.now);
    const cacheBytes = await this.session.getCacheSize();
    const sites = new Set(selection.cookies.map(cookie => cookie.domain?.replace(/^\./, '')).filter(Boolean));
    for (const origin of selection.origins) sites.add(new URL(origin).hostname);
    return {
      history: this.store.data.history.filter(entry => inRange(entry.time, selection.start, selection.now)).length,
      cookies: selection.cookies.length, sites: sites.size, unknownCookies: selection.unknownCookies,
      cacheBytes, cacheScope: 'all',
      downloads: [...this.downloadManager.jobs.values(), ...this.nativeDownloads.values(), ...[...(this.downloadHistory?.records.values() || [])].filter(entry => !this.nativeDownloads.has(entry.id))].filter(ended).length,
      siteSettings: Object.values(this.store.data.siteSettings).filter(value => inRange(value.time, selection.start, selection.now)).length,
      autofill: 0, hostedApps: 0,
      passwords: this.passwordVault && !this.passwordVault.error && this.passwordVault.available() ? this.passwordVault.list().filter(entry => inRange(entry.updatedAt, selection.start, selection.now)).length : 0,
    };
  }
  async clear({ range, types }) {
    if (this.busy) throw new Error('正在清理浏览数据，请稍候');
    if (!Array.isArray(types) || !types.length || types.some(type => !TYPES.includes(type))) throw new Error('请选择要删除的数据');
    this.busy = true;
    try {
      const { start, now, cookies, origins } = await this.selected(range);
      if (types.includes('passwords')) this.passwordVault?.clear(start, now);
      if (types.includes('cookies')) {
        if (range === 'all') {
          const excludeOrigins = this.session.extensions.getAllExtensions().map(extension => 'chrome-extension://' + extension.id);
          await this.session.clearData({ dataTypes: ['cookies', 'localStorage', 'indexedDB', 'serviceWorkers', 'fileSystems', 'webSQL', 'backgroundFetch'], excludeOrigins });
        } else {
          for (const cookie of cookies) {
            const url = (cookie.secure ? 'https://' : 'http://') + cookie.domain.replace(/^\./, '') + (cookie.path || '/');
            await this.session.cookies.set({ url, name: cookie.name, value: '', domain: cookie.hostOnly ? undefined : cookie.domain, path: cookie.path || '/', secure: !!cookie.secure, httpOnly: !!cookie.httpOnly, sameSite: cookie.sameSite, expirationDate: 1 });
          }
          for (const origin of origins) await this.session.clearStorageData({ origin, storages: ['localstorage', 'indexdb', 'filesystem', 'serviceworkers', 'cachestorage'] });
        }
        for (const cookie of cookies) delete this.store.data.cookieTimes[cookieKey(cookie)];
        for (const origin of origins) delete this.store.data.siteActivity[origin];
      }
      if (types.includes('cache')) {
        await this.session.clearCache();
        await this.session.clearCodeCaches({});
        this.store.data.icons = {};
        for (const tab of this.tabs.values()) { tab.iconRequest++; tab.favicon = ''; }
      }
      if (types.includes('history')) this.store.data.history = this.store.data.history.filter(entry => !inRange(entry.time, start, now));
      if (types.includes('downloads')) {
        const ended = entry => ['completed', 'cancelled'].includes(entry.status) && inRange(entry.createdAt, start, now);
        for (const [id, entry] of this.downloadManager.jobs) if (ended(entry)) this.downloadManager.jobs.delete(id);
        for (const [id, entry] of this.nativeDownloads) if (ended(entry)) this.nativeDownloads.delete(id);
        for (const [id, entry] of this.downloadHistory?.records || []) if (ended(entry) || entry.historical && inRange(entry.createdAt, start, now)) this.downloadHistory.records.delete(id);
        this.downloadHistory?.save();
        this.downloadManager.persist(); this.downloadManager.changed();
      }
      if (types.includes('siteSettings')) {
        for (const [origin, value] of Object.entries(this.store.data.siteSettings)) {
          if (!inRange(value.time, start, now)) continue;
          delete this.store.data.siteSettings[origin];
          for (const tab of this.tabs.values()) if (tab.url.startsWith(origin + '/') || tab.url === origin) tab.view.webContents.setZoomFactor(1);
        }
      }
      this.store.save();
      return { success: true };
    } finally { this.busy = false; }
  }
}
module.exports = { BrowsingData, rangeStart, inRange, cookieKey, nativeCookieTimes };
