const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { pipeline } = require('node:stream/promises');
const { markDownloadedFile } = require('./download-origin');

function splitRanges(total, count) {
  if (!Number.isSafeInteger(total) || total <= 0) throw new Error('Invalid file size');
  count = Math.min(Math.max(1, Math.floor(count)), total, 16);
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1, start: Math.floor(total * index / count), end: Math.floor(total * (index + 1) / count) - 1,
    received: 0, status: 'waiting',
  }));
}
function contentRange(value) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value || '');
  if (!match) return null;
  const [start, end, total] = match.slice(1).map(Number);
  if (![start, end, total].every(Number.isSafeInteger) || start < 0 || end < start || total <= end) return null;
  return { start, end, total };
}
function validator(headers) {
  const etag = headers.get('etag');
  if (etag && !etag.startsWith('W/')) return { type: 'etag', value: etag };
  const modified = headers.get('last-modified');
  return modified ? { type: 'last-modified', value: modified } : null;
}
function sleep(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    function done() { signal?.removeEventListener('abort', abort); resolve(); }
    function abort() { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason); }
    signal?.addEventListener('abort', abort, { once: true });
  });
}
async function writeAll(handle, buffer) {
  let written = 0;
  while (written < buffer.length) {
    const result = await handle.write(buffer, written, buffer.length - written, null);
    if (!result.bytesWritten) throw new Error('磁盘写入失败');
    written += result.bytesWritten;
  }
}

class DownloadManager extends EventEmitter {
  constructor({ directory, fetch, onComplete }) {
    super();
    this.directory = directory;
    this.fetch = fetch;
    this.onComplete = onComplete;
    this.jobs = new Map();
    this.file = path.join(directory, 'download-jobs.json');
    fs.mkdirSync(path.join(directory, 'download-parts'), { recursive: true });
    this.restore();
    this.timer = setInterval(() => this.tick(), 400);
    this.timer.unref();
    this.ticks = 0;
  }
  partDirectory(job) { return path.join(this.directory, 'download-parts', job.id); }
  partPath(job, part) { return path.join(this.partDirectory(job), part.id + '.part'); }
  uniquePath(file, exceptId) {
    const directory = path.dirname(file), extension = path.extname(file), stem = path.basename(file, extension);
    let candidate = file, suffix = 1;
    while (fs.existsSync(candidate) || [...this.jobs.values()].some(job => job.id !== exceptId && job.file === candidate && job.status !== 'cancelled')) {
      candidate = path.join(directory, `${stem} (${suffix++})${extension}`);
    }
    return candidate;
  }
  create({ url, file, name, headers = {}, threads = 8, overwrite = false }) {
    if (!/^https?:\/\//i.test(url) || !path.isAbsolute(file)) throw new Error('下载地址或位置无效');
    const id = crypto.randomUUID();
    const job = {
      id, url, file, name: name || path.basename(file), headers, overwrite,
      total: 0, received: 0, status: 'waiting', mode: 'checking', resumable: false,
      threads: [], requestedThreads: Math.min(16, Math.max(1, Number(threads) || 8)),
      speed: 0, eta: null, speedLimit: 0, completion: 'none', error: '', icon: '',
      validator: null, createdAt: Date.now(), controller: null, running: null,
      lastReceived: 0, lastTime: Date.now(), nextSlot: 0, rateController: new AbortController(),
    };
    this.jobs.set(id, job);
    this.persist(); this.start(job); return id;
  }
  publicJob(job) {
    return {
      id: job.id, name: job.name, url: job.url, total: job.total, received: job.received,
      status: job.status, mode: job.mode, resumable: job.resumable, speed: job.speed, eta: job.eta,
      speedLimit: job.speedLimit, completion: job.completion, error: job.error, icon: job.icon,
      managed: true, createdAt: job.createdAt,
      threads: job.threads.map(part => ({ ...part })),
    };
  }
  snapshot() { return [...this.jobs.values()].map(job => this.publicJob(job)); }
  changed() { this.emit('change'); }
  tick() {
    let active = false;
    const now = Date.now();
    for (const job of this.jobs.values()) {
      if (['progressing', 'checking', 'merging'].includes(job.status)) active = true;
      const elapsed = Math.max(1, now - job.lastTime);
      const speed = Math.max(0, job.received - job.lastReceived) * 1000 / elapsed;
      job.speed = job.status === 'progressing' ? Math.round(job.speed ? job.speed * 0.5 + speed * 0.5 : speed) : 0;
      job.eta = job.speed > 0 && job.total > 0 ? Math.ceil(Math.max(0, job.total - job.received) / job.speed) : null;
      job.lastReceived = job.received; job.lastTime = now;
    }
    if (active) { this.changed(); if (++this.ticks % 3 === 0) this.persist(); }
  }
  start(job) {
    if (job.running) return;
    job.controller = new AbortController();
    job.status = 'checking'; job.error = ''; job.nextSlot = 0;
    job.lastReceived = job.received; job.lastTime = Date.now();
    job.running = this.run(job).catch(error => {
      if (['paused', 'cancelled'].includes(job.status)) return;
      job.status = 'interrupted'; job.error = error.message || '连接已中断';
      job.controller.abort();
      for (const part of job.threads) if (part.status === 'progressing') part.status = 'interrupted';
    }).finally(() => {
      job.running = null; job.speed = 0; job.eta = null;
      if (['paused', 'cancelled', 'interrupted'].includes(job.status)) for (const part of job.threads) if (part.status !== 'completed') part.status = job.status;
      this.persist(); this.changed();
    });
    this.changed();
  }
  async discardParts(job) {
    await fs.promises.rm(this.partDirectory(job), { recursive: true, force: true });
    await fs.promises.mkdir(this.partDirectory(job), { recursive: true });
    job.received = 0;
  }
  async run(job) {
    const signal = job.controller.signal;
    const headers = { ...job.headers, 'Accept-Encoding': 'identity', Range: 'bytes=0-0' };
    const headerTimeout = new AbortController();
    const timeout = setTimeout(() => headerTimeout.abort(new Error('连接超时，请重试')), 20000);
    let probe;
    try { probe = await this.fetch(job.url, { headers, signal: AbortSignal.any([signal, headerTimeout.signal]) }); }
    finally { clearTimeout(timeout); }
    signal.throwIfAborted();
    if (!probe.ok) { await probe.body?.cancel(); throw new Error('服务器返回 HTTP ' + probe.status); }
    const range = contentRange(probe.headers.get('content-range'));
    const identity = !probe.headers.get('content-encoding') || probe.headers.get('content-encoding') === 'identity';
    const tag = validator(probe.headers);
    if (probe.status === 206 && range?.start === 0 && range.end === 0 && identity && tag) {
      await probe.body?.cancel();
      const same = job.mode === 'range' && job.total === range.total && job.validator?.type === tag.type && job.validator?.value === tag.value;
      if (!same) {
        await this.discardParts(job);
        job.threads = splitRanges(range.total, job.requestedThreads);
      }
      job.total = range.total; job.validator = tag; job.mode = 'range'; job.resumable = true;
      job.received = 0;
      for (const part of job.threads) {
        try { part.received = (await fs.promises.stat(this.partPath(job, part))).size; } catch { part.received = 0; }
        if (part.received > part.end - part.start + 1) throw new Error('分段缓存不完整，请取消后重新下载');
        job.received += part.received;
      }
      job.status = 'progressing';
      const results = await Promise.allSettled(job.threads.map(part => this.transferRange(job, part).catch(error => { job.controller.abort(error); throw error; })));
      signal.throwIfAborted();
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
    } else {
      job.mode = 'single'; job.resumable = false; job.validator = null;
      await this.discardParts(job);
      // If the server ignored Range, reuse the response as the single stream.
      let response = probe;
      if (probe.status !== 200) {
        await probe.body?.cancel();
        response = await this.fetch(job.url, { headers: { ...job.headers, 'Accept-Encoding': 'identity' }, signal });
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error('服务器返回 HTTP ' + response.status); }
      job.total = Number(response.headers.get('content-length')) || 0;
      if (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') job.total = 0;
      job.threads = [{ id: 1, start: 0, end: job.total ? job.total - 1 : null, received: 0, status: 'progressing' }];
      job.status = 'progressing';
      await this.writeResponse(job, job.threads[0], response, job.total || null);
      if (!job.total) { job.total = job.received; job.threads[0].end = job.total - 1; }
    }
    signal.throwIfAborted();
    await this.finish(job);
  }
  async transferRange(job, part) {
    const signal = job.controller.signal;
    const size = part.end - part.start + 1;
    if (part.received === size) { part.status = 'completed'; return; }
    part.status = 'connecting';
    const start = part.start + part.received;
    const response = await this.fetch(job.url, { headers: { ...job.headers, 'Accept-Encoding': 'identity', Range: `bytes=${start}-${part.end}`, 'If-Range': job.validator.value }, signal });
    const range = contentRange(response.headers.get('content-range'));
    const responseValidator = response.headers.get(job.validator.type);
    if (response.status !== 206 || !range || range.start !== start || range.end !== part.end || range.total !== job.total || responseValidator !== job.validator.value || (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity')) {
      await response.body?.cancel();
      throw new Error('服务器的分段响应发生变化，请重试下载');
    }
    part.status = 'progressing';
    await this.writeResponse(job, part, response, size);
  }
  async rateLimit(job, length) {
    while (job.speedLimit) {
      const now = Date.now();
      job.nextSlot = Math.max(now, job.nextSlot) + length * 1000 / (job.speedLimit * 1024);
      try { await sleep(Math.max(0, job.nextSlot - now), AbortSignal.any([job.controller.signal, job.rateController.signal])); return; }
      catch (error) { if (job.controller.signal.aborted) throw error; /* speed setting changed */ }
    }
  }
  async writeResponse(job, part, response, expected) {
    const handle = await fs.promises.open(this.partPath(job, part), 'a');
    try {
      for await (const chunk of response.body) {
        job.controller.signal.throwIfAborted();
        if (expected !== null && part.received + chunk.length > expected) throw new Error('服务器返回了超出范围的数据');
        await this.rateLimit(job, chunk.length);
        await writeAll(handle, Buffer.from(chunk));
        part.received += chunk.length; job.received += chunk.length;
      }
      if (expected !== null && part.received !== expected) throw new Error('下载数据不完整，请继续或重试');
      part.status = 'completed';
    } catch (error) {
      part.status = ['paused', 'cancelled'].includes(job.status) ? job.status : 'interrupted';
      throw error;
    } finally { await handle.close(); }
  }
  async finish(job) {
    job.status = 'merging'; this.changed();
    const temporary = job.file + '.luna-' + job.id + '.tmp';
    await fs.promises.mkdir(path.dirname(job.file), { recursive: true });
    const output = fs.createWriteStream(temporary, { flags: 'w' });
    async function* chunks(manager) {
      for (const part of job.threads) {
        for await (const chunk of fs.createReadStream(manager.partPath(job, part))) {
          job.controller.signal.throwIfAborted(); yield chunk;
        }
      }
    }
    try {
      await pipeline(chunks(this), output, { signal: job.controller.signal });
      if ((await fs.promises.stat(temporary)).size !== job.total) throw new Error('下载文件大小不一致');
      job.controller.signal.throwIfAborted();
      // Mark the temporary file before publishing it or invoking auto-open.
      // Windows rename/CopyFile preserves its NTFS alternate data streams.
      await markDownloadedFile(temporary, job.url);
      if (job.overwrite) await fs.promises.rename(temporary, job.file);
      else {
        job.file = this.uniquePath(job.file, job.id); job.name = path.basename(job.file);
        await fs.promises.copyFile(temporary, job.file, fs.constants.COPYFILE_EXCL);
        await fs.promises.unlink(temporary);
      }
      job.status = 'completed'; job.error = ''; job.resumable = false;
      await fs.promises.rm(this.partDirectory(job), { recursive: true, force: true });
      if (this.onComplete) await this.onComplete(job);
    } finally { await fs.promises.rm(temporary, { force: true }).catch(() => {}); }
  }
  async action(id, action, value) {
    const job = this.jobs.get(id);
    if (!job) return;
    if (action === 'pause' && ['waiting', 'checking', 'progressing'].includes(job.status)) {
      job.status = 'paused'; job.controller?.abort();
      await job.running;
    } else if (action === 'resume' && ['paused', 'interrupted'].includes(job.status)) {
      await job.running; this.start(job);
    } else if (action === 'cancel' && !['completed', 'cancelled'].includes(job.status)) {
      job.status = 'cancelled'; job.controller?.abort(); await job.running;
      await fs.promises.rm(this.partDirectory(job), { recursive: true, force: true });
      for (const part of job.threads) part.status = 'cancelled';
    } else if (action === 'speed-limit') {
      const limit = Number(value);
      if (Number.isFinite(limit) && limit >= 0 && limit <= 1024 * 1024) { job.speedLimit = Math.round(limit); job.nextSlot = 0; job.rateController.abort(); job.rateController = new AbortController(); }
    } else if (action === 'completion' && ['none', 'open', 'reveal'].includes(value)) job.completion = value;
    this.persist(); this.changed();
  }
  persist() {
    const data = [...this.jobs.values()].slice(-100).map(job => ({
      ...this.publicJob(job), file: job.file, overwrite: job.overwrite,
      requestedThreads: job.requestedThreads, validator: job.validator,
    }));
    try {
      fs.writeFileSync(this.file + '.tmp', JSON.stringify(data));
      fs.renameSync(this.file + '.tmp', this.file);
    } catch { /* current transfers remain available if metadata cannot be saved */ }
  }
  restore() {
    try {
      const records = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(records)) return;
      for (const record of records.slice(-100)) {
        if (!/^[a-f0-9-]{36}$/.test(record.id) || !/^https?:\/\//i.test(record.url) || !path.isAbsolute(record.file) || !Array.isArray(record.threads) || record.threads.length > 16) continue;
        if (!['checking', 'range', 'single'].includes(record.mode)) continue;
        const job = { ...record, headers: {}, controller: null, running: null, speed: 0, eta: null, lastReceived: 0, lastTime: Date.now(), nextSlot: 0, rateController: new AbortController(), completion: 'none' };
        if (!['completed', 'cancelled'].includes(job.status)) {
          job.status = 'paused'; job.received = 0;
          for (const part of job.threads) {
            if (!Number.isInteger(part.id) || part.id < 1 || part.id > 16) throw new Error('Invalid download checkpoint');
            let size = 0;
            try { size = fs.statSync(this.partPath(job, part)).size; } catch { /* missing part starts over */ }
            part.received = size; job.received += size; part.status = 'paused';
          }
        }
        this.jobs.set(job.id, job);
      }
    } catch { /* corrupt checkpoints are ignored */ }
  }
  async shutdown() {
    clearInterval(this.timer);
    await Promise.all([...this.jobs.values()].filter(job => job.running).map(job => job.status === 'merging' ? job.running : this.action(job.id, 'pause')));
    this.persist();
  }
}

module.exports = { DownloadManager, splitRanges, contentRange };
