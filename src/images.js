const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

async function websiteIcon(webSession, url) {
  let buffer, type = 'image/png';
  if (/^data:image\/(?:png|jpeg|x-icon|svg\+xml);base64,/.test(url) && url.length < 256 * 1024) {
    type = url.slice(5, url.indexOf(';')); buffer = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  } else {
    if (!/^https?:\/\//i.test(url)) return '';
    const response = await webSession.fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok || Number(response.headers.get('content-length')) > 128 * 1024) { await response.body?.cancel(); return ''; }
    type = response.headers.get('content-type') || '';
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 128 * 1024) { await response.body.cancel().catch(() => {}); return ''; } chunks.push(Buffer.from(chunk)); }
    buffer = Buffer.concat(chunks);
  }
  const image = nativeImage.createFromBuffer(buffer);
  if (!image.isEmpty()) return image.resize({ width: 32, height: 32 }).toDataURL();
  if (type.includes('svg') && buffer.length < 64 * 1024 && /<svg[\s>]/i.test(buffer.toString())) return 'data:image/svg+xml;base64,' + buffer.toString('base64');
  return '';
}
async function fileIcon(file, name = '') {
  try {
    let source = file;
    if (!source || !fs.existsSync(source)) {
      const extension = path.extname(name).replace(/[^.a-z0-9]/gi, '').slice(0, 15);
      const directory = path.join(app.getPath('userData'), 'file-icons');
      fs.mkdirSync(directory, { recursive: true });
      source = path.join(directory, 'file' + (extension || '.bin'));
      if (!fs.existsSync(source)) fs.writeFileSync(source, '');
    }
    const image = await app.getFileIcon(source, { size: 'large' });
    return image.isEmpty() ? '' : image.toDataURL();
  } catch { return ''; }
}
module.exports = { websiteIcon, fileIcon };
