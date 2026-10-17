const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { Worker } = require('node:worker_threads');

const TYPES = ['bookmarks', 'history', 'downloads', 'passwords'];
const idFor = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
function readJSON(file, maximum = 8 * 1024 * 1024) {
  const handle = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(handle); if (!stat.isFile() || stat.size > maximum) throw new Error('文件过大或格式无效');
    const bytes = Buffer.alloc(stat.size + 1); let size = 0, count;
    while (size < bytes.length && (count = fs.readSync(handle, bytes, size, bytes.length - size, size))) size += count;
    if (size > maximum || size > stat.size) throw new Error('文件读取期间发生变化，请重试');
    return JSON.parse(bytes.subarray(0, size).toString('utf8').replace(/^\uFEFF/, ''));
  } finally { fs.closeSync(handle); }
}
function browserRoots(env = process.env, platform = process.platform, home = os.homedir()) {
  if (platform === 'darwin') {
    const support = path.join(home, 'Library', 'Application Support');
    return [['Edge', 'Microsoft Edge'], ['Chrome', 'Google/Chrome'], ['Brave', 'BraveSoftware/Brave-Browser'], ['Vivaldi', 'Vivaldi'], ['Firefox', 'Firefox/Profiles']]
      .map(([browser, relative]) => ({ browser, root: path.join(support, relative), kind: browser === 'Firefox' ? 'firefox' : 'chromium' }));
  }
  if (platform !== 'win32') return [];
  const local = env.LOCALAPPDATA, roaming = env.APPDATA;
  return [
    ['Edge', local, 'Microsoft/Edge/User Data'], ['Chrome', local, 'Google/Chrome/User Data'],
    ['Brave', local, 'BraveSoftware/Brave-Browser/User Data'], ['Vivaldi', local, 'Vivaldi/User Data'],
    ['Firefox', roaming, 'Mozilla/Firefox/Profiles'],
  ].filter(([, directory]) => directory).map(([browser, directory, relative]) => ({ browser, root: path.join(directory, relative), kind: browser === 'Firefox' ? 'firefox' : 'chromium' }));
}
function discoverProfiles(roots = browserRoots()) {
  const profiles = [];
  for (const source of roots) {
    let entries; try { entries = fs.readdirSync(source.root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries.slice(0, 200)) {
      if (!entry.isDirectory() || source.kind === 'chromium' && !/^(Default|Profile \d+)$/.test(entry.name)) continue;
      const directory = path.join(source.root, entry.name);
      try { const relative = path.relative(fs.realpathSync(source.root), fs.realpathSync(directory)); if (relative.startsWith('..') || path.isAbsolute(relative)) continue; } catch { continue; }
      const files = source.kind === 'firefox' ? { bookmarks: 'places.sqlite', history: 'places.sqlite', downloads: 'places.sqlite', passwords: 'logins.json' }
        : { bookmarks: 'Bookmarks', history: 'History', downloads: 'History', passwords: 'Login Data' };
      const available = Object.fromEntries(TYPES.map(type => [type, fs.existsSync(path.join(directory, files[type]))]));
      if (source.kind === 'firefox' && fs.existsSync(path.join(directory, 'downloads.json'))) available.downloads = true;
      if (!Object.values(available).some(Boolean)) continue;
      let name = entry.name; if (source.kind === 'chromium') { try { name = readJSON(path.join(directory, 'Preferences')).profile?.name || name; } catch {} }
      profiles.push({ ...source, directory, id: idFor(directory.toLowerCase()), name: String(name).slice(0, 100), available });
    }
  }
  return profiles;
}
class BrowserImporter {
  constructor({ roots, helper }) { this.roots = roots; this.helper = helper; this.profiles = new Map(); this.busy = false; }
  list() {
    const profiles = discoverProfiles(this.roots); this.profiles = new Map(profiles.map(profile => [profile.id, profile]));
    return profiles.map(({ id, browser, name, available, kind }) => ({ id, browser, name, available, passwordNote: kind === 'firefox' ? 'Firefox 密码请导出 CSV 后导入' : process.platform === 'darwin' ? 'macOS 密码请在来源浏览器导出 CSV 后导入' : '支持本账号可解密的密码；应用绑定密码需 CSV' }));
  }
  async read(id, types) {
    const profile = this.profiles.get(id);
    if (!profile || !Array.isArray(types) || !types.length || types.some(type => !TYPES.includes(type))) throw new Error('请选择已发现的浏览器配置和数据类型');
    if (this.busy) throw new Error('正在导入，请等待完成');
    this.busy = true;
    try {
      return await new Promise((resolve, reject) => {
        let settled = false;
        const worker = new Worker(path.join(__dirname, 'browser-import-worker.js'), { workerData: { profile, types: [...new Set(types)], helper: this.helper } });
        const timer = setTimeout(() => { settled = true; worker.terminate(); reject(new Error('读取超时，请关闭来源浏览器后重试')); }, 45000);
        worker.once('message', message => { settled = true; clearTimeout(timer); message.ok ? resolve(message.data) : reject(new Error('来源数据读取失败，请关闭来源浏览器后重试')); });
        worker.once('error', () => { settled = true; clearTimeout(timer); reject(new Error('导入读取程序无法启动')); });
        worker.once('exit', () => { clearTimeout(timer); if (!settled) reject(new Error('导入读取程序已停止')); });
      });
    } finally { this.busy = false; }
  }
}
module.exports = { BrowserImporter, browserRoots, discoverProfiles, readJSON, idFor, TYPES };
