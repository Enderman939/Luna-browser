const { dialog, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isAsset } = require('./ui/appearance-model');

function rasterImage(buffer) {
  const png = buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = buffer.length > 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  const webp = buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  const ico = buffer.length > 6 && buffer.readUInt32LE(0) === 0x10000;
  if (!(png || jpeg || webp || ico)) throw new Error('请选择 PNG、JPEG、WebP 或 ICO 图片');
  if (png && buffer.readUInt32BE(16) * buffer.readUInt32BE(20) > 64000000) throw new Error('图片像素过大，请选择较小的图片');
}
class AppearanceAssets {
  constructor(directory, webSession) {
    this.directory = path.join(directory, 'appearance-assets');
    webSession.protocol.handle('luna-asset', async request => {
      try {
        const url = new URL(request.url), name = url.pathname.slice(1);
        if (!['GET', 'HEAD'].includes(request.method) || url.hostname !== 'image' || url.username || url.password || url.port || !isAsset(name)) return new Response('', { status: 404 });
        const file = path.join(this.directory, name);
        if (!(await fs.promises.lstat(file)).isFile()) return new Response('', { status: 404 });
        return new Response(request.method === 'HEAD' ? null : await fs.promises.readFile(file), { headers: { 'Content-Type': 'image/png', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Security-Policy': "default-src 'none'" } });
      } catch { return new Response('', { status: 404 }); }
    });
  }
  async choose(parent, kind, brand = false) {
    const result = await dialog.showOpenDialog(parent, { title: kind === 'background' ? '选择背景图片' : '选择图标图片', properties: ['openFile'], filters: [{ name: '图片', extensions: kind === 'background' ? ['png', 'jpg', 'jpeg', 'webp'] : ['png', 'jpg', 'jpeg', 'webp', 'ico'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = result.filePaths[0], limit = kind === 'background' ? 20 * 1024 * 1024 : 4 * 1024 * 1024;
    if ((await fs.promises.stat(file)).size > limit) throw new Error(kind === 'background' ? '背景图片不能超过 20 MB' : '图标图片不能超过 4 MB');
    const buffer = await fs.promises.readFile(file); if (buffer.length > limit) throw new Error('图片文件过大'); rasterImage(buffer);
    let image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) throw new Error('无法读取此图片，请使用 PNG 或 JPEG 格式');
    const size = image.getSize();
    if (!size.width || !size.height || size.width * size.height > 64000000) throw new Error('图片像素过大或无效');
    const maximum = kind === 'background' ? { width: 1920, height: 1080 } : { width: brand ? 256 : 48, height: brand ? 256 : 48 };
    const scale = Math.min(1, maximum.width / size.width, maximum.height / size.height);
    if (scale < 1) image = image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'better' });
    const bytes = image.toPNG(); if (bytes.length > 10 * 1024 * 1024) throw new Error('处理后的图片过大');
    const name = crypto.createHash('sha256').update(bytes).digest('hex') + '.png';
    await fs.promises.mkdir(this.directory, { recursive: true });
    try { await fs.promises.writeFile(path.join(this.directory, name), bytes, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    return { image: name, imageName: path.basename(file).slice(0, 160) };
  }
  async cleanup(appearance) {
    const used = new Set([...Object.values(appearance.regions).map(region => region.image), ...Object.values(appearance.icons.custom)]);
    let entries; try { entries = await fs.promises.readdir(this.directory, { withFileTypes: true }); } catch { return; }
    await Promise.all(entries.filter(entry => entry.isFile() && isAsset(entry.name) && !used.has(entry.name)).map(entry => fs.promises.unlink(path.join(this.directory, entry.name)).catch(() => {})));
  }
  windowIcon(asset) {
    try { return isAsset(asset) ? nativeImage.createFromPath(path.join(this.directory, asset)) : nativeImage.createFromPath(path.join(__dirname, 'ui', 'assets', 'app.png')); } catch { return null; }
  }
}
module.exports = { AppearanceAssets, rasterImage };
