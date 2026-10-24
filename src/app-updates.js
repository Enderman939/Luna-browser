const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');

const REPOSITORY = 'Enderman939/Luna-browser';
const LATEST = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const MAX_PACKAGE = 1024 * 1024 * 1024;
const stableVersion = value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
function newerVersion(candidate, current) {
  if (!stableVersion(candidate) || typeof current !== 'string') return false;
  const match = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(current);
  if (!match) return false;
  const parts = candidate.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) { const previous = BigInt(match[i + 1]); if (parts[i] !== previous) return parts[i] > previous; }
  return !!match[4];
}
function releaseAssetURL(value, tag, name) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.port && !url.username && !url.password && !url.search && !url.hash
      && url.pathname === `/${REPOSITORY}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
  } catch { return false; }
}
function selectRelease(release, current, platform, arch) {
  if (!release || release.draft || release.prerelease || !Array.isArray(release.assets)) return null;
  const version = String(release.tag_name || '').replace(/^v/, '');
  if (!newerVersion(version, current)) return null;
  const name = `luna-${version}-${platform}-${arch}.zip`;
  const asset = release.assets.find(asset => asset.name === name && asset.state === 'uploaded');
  if (!asset) throw new Error('最新正式版尚未提供适用于本机的更新包，请稍后重试。');
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_PACKAGE || !releaseAssetURL(asset.browser_download_url, release.tag_name, name)) throw new Error('GitHub 更新包信息无效。');
  const digest = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest || '')?.[1].toLowerCase();
  const sumName = platform === 'darwin' ? 'SHA256SUMS-macos-arm64.txt' : 'SHA256SUMS.txt';
  const sums = release.assets.find(asset => asset.name === sumName && asset.state === 'uploaded');
  const checksumURL = sums && releaseAssetURL(sums.browser_download_url, release.tag_name, sumName) ? sums.browser_download_url : null;
  if (!digest && !checksumURL) throw new Error('此 Release 缺少 SHA-256 校验值，无法自动更新。');
  return { version, name, size: asset.size, url: asset.browser_download_url, sha256: digest || null, checksumURL,
    page: `https://github.com/${REPOSITORY}/releases/tag/${encodeURIComponent(release.tag_name)}` };
}
async function responseBytes(response, limit, onChunk) {
  if (!response.ok) {
    if (response.status === 403 || response.status === 429) throw new Error('GitHub 请求次数已达上限，请稍后重试。');
    throw new Error('GitHub 请求失败（HTTP ' + response.status + '）。');
  }
  const length = Number(response.headers.get('content-length'));
  if (length > limit) throw new Error('更新响应超过大小限制。');
  let received = 0; const chunks = [];
  if (!response.body) throw new Error('GitHub 返回了空响应。');
  for await (const chunk of response.body) {
    received += chunk.length;
    if (received > limit) throw new Error('更新响应超过大小限制。');
    if (onChunk) await onChunk(Buffer.from(chunk), received); else chunks.push(Buffer.from(chunk));
  }
  return onChunk ? received : Buffer.concat(chunks);
}
async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}
class AppUpdates extends EventEmitter {
  constructor({ directory, version, platform = process.platform, arch = process.arch, supported, fetch, prepareInstall }) {
    super(); Object.assign(this, { directory, version, platform, arch, supported, fetch, prepareInstall });
    this.automatic = false; this.release = null; this.readyFile = null; this.pending = null; this.controller = null;
    this.state = { phase: supported ? 'idle' : 'unsupported', current: version, version: null, received: 0, total: 0, error: '', checkedAt: null };
  }
  snapshot() { return { ...this.state, supported: this.supported }; }
  change(values) { Object.assign(this.state, values); this.emit('change', this.snapshot()); }
  configure(enabled) {
    this.automatic = enabled === true;
    clearTimeout(this.timer);
    if (!this.automatic) { if (this.pending && this.background) this.controller?.abort(); return; }
    if (this.supported) { this.timer = setTimeout(() => this.check(true), 10000); this.timer.unref(); }
  }
  schedule() {
    clearTimeout(this.timer);
    if (this.automatic && this.supported) { this.timer = setTimeout(() => this.check(true), 6 * 60 * 60 * 1000); this.timer.unref(); }
  }
  async request(url, signal, limit) {
    const response = await this.fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Luna-Browser/' + this.version }, credentials: 'omit', cache: 'no-store', signal });
    return responseBytes(response, limit);
  }
  run(background, operation) {
    if (this.pending) return this.pending;
    this.background = background; this.controller = new AbortController();
    this.pending = Promise.resolve().then(operation).catch(error => {
      this.change({ phase: this.readyFile ? 'ready' : 'error', error: this.controller.signal.aborted ? '更新已暂停，可点击重试。' : String(error.message || error).slice(0, 300) });
      return this.snapshot();
    }).finally(() => { this.pending = null; this.controller = null; this.schedule(); });
    return this.pending;
  }
  check(background = false) {
    if (!this.supported || ['preparing', 'installing'].includes(this.state.phase)) return Promise.resolve(this.snapshot());
    if (this.pending) return this.pending;
    return this.run(background, async () => {
      this.change({ phase: 'checking', error: '' });
      const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(20000)]);
      const release = JSON.parse((await this.request(LATEST, signal, 2 * 1024 * 1024)).toString('utf8'));
      const selected = selectRelease(release, this.version, this.platform, this.arch);
      this.change({ checkedAt: Date.now() });
      if (!selected) { this.release = null; this.readyFile = null; this.change({ phase: 'current', version: null, received: 0, total: 0 }); return this.snapshot(); }
      if (this.release?.version !== selected.version) this.readyFile = null;
      this.release = selected;
      this.change({ phase: this.readyFile ? 'ready' : 'available', version: selected.version, total: selected.size });
      if (this.readyFile) return this.snapshot();
      if (this.automatic) await this.downloadRelease();
      return this.snapshot();
    });
  }
  download() {
    if (!this.supported || !this.release || ['preparing', 'installing'].includes(this.state.phase)) return Promise.resolve(this.snapshot());
    return this.run(false, async () => { await this.downloadRelease(); return this.snapshot(); });
  }
  async downloadRelease() {
    const release = this.release;
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(30 * 60 * 1000)]);
    this.change({ phase: 'downloading', received: 0, total: release.size, error: '' });
    await fs.promises.mkdir(this.directory, { recursive: true });
    const file = path.join(this.directory, release.name), partial = file + '.partial';
    let handle;
    try {
      let expected = release.sha256;
      if (!expected) {
        const sums = (await this.request(release.checksumURL, signal, 128 * 1024)).toString('utf8');
        expected = sums.split(/\r?\n/).map(line => /^([a-f0-9]{64})\s+\*?([^\r\n]+)$/i.exec(line)).find(match => match?.[2] === release.name)?.[1].toLowerCase();
        if (!expected) throw new Error('Release 校验文件中没有此更新包。');
      }
      if (await fs.promises.stat(file).then(stat => stat.isFile() && stat.size === release.size, () => false) && await hashFile(file) === expected) {
        release.sha256 = expected; this.readyFile = file; this.change({ phase: 'ready', received: release.size }); return;
      }
      handle = await fs.promises.open(partial, 'w');
      const response = await this.fetch(release.url, { credentials: 'omit', cache: 'no-store', signal });
      const hash = createHash('sha256'); let lastProgress = 0;
      const received = await responseBytes(response, release.size, async (chunk, received) => {
        signal.throwIfAborted(); hash.update(chunk);
        let offset = 0;
        while (offset < chunk.length) { const result = await handle.write(chunk, offset, chunk.length - offset); if (!result.bytesWritten) throw new Error('无法写入更新包。'); offset += result.bytesWritten; }
        if (Date.now() - lastProgress >= 200) { lastProgress = Date.now(); this.change({ received }); }
      });
      this.change({ phase: 'verifying', received });
      if (received !== release.size || hash.digest('hex') !== expected) throw new Error('更新包不完整或 SHA-256 校验失败，请重试。');
      await handle.close(); handle = null;
      await fs.promises.rename(partial, file);
      release.sha256 = expected; this.readyFile = file;
      this.change({ phase: 'ready', received }); this.emit('ready', this.snapshot());
      for (const name of await fs.promises.readdir(this.directory)) {
        if (/^luna-\d+\.\d+\.\d+-(?:win32-x64|darwin-arm64)\.zip(?:\.partial)?$/.test(name) && name !== release.name) await fs.promises.rm(path.join(this.directory, name), { force: true }).catch(() => {});
      }
    } finally { await handle?.close(); await fs.promises.rm(partial, { force: true }).catch(() => {}); }
  }
  async prepare() {
    if (this.pending || !this.readyFile || !this.release || this.state.phase !== 'ready') throw new Error('请先下载并校验更新。');
    this.change({ phase: 'preparing', error: '' });
    try {
      if (await hashFile(this.readyFile) !== this.release.sha256) { this.readyFile = null; throw new Error('更新包已变化，请重新下载。'); }
      return await this.prepareInstall({ file: this.readyFile, release: this.release });
    } catch (error) { this.change({ phase: this.readyFile ? 'ready' : 'error', error: String(error.message).slice(0, 300) }); throw error; }
  }
  dispose() { this.automatic = false; clearTimeout(this.timer); this.controller?.abort(); }
}
module.exports = { AppUpdates, newerVersion, selectRelease, releaseAssetURL, responseBytes, hashFile, LATEST };
