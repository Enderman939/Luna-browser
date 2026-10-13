const fs = require('node:fs');

function originMarker(source) {
  const url = new URL(source);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('下载来源协议无效');
  // Keep the origin without credentials, signed query tokens, or fragments.
  url.username = ''; url.password = ''; url.search = ''; url.hash = '';
  return '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=' + url.href + '\r\n';
}
async function markDownloadedFile(file, source) {
  if (process.platform !== 'win32') return;
  try { await fs.promises.writeFile(file + ':Zone.Identifier', originMarker(source), 'utf8'); }
  catch (error) { throw new Error('无法写入 Windows 下载来源标记，请使用支持来源标记的下载目录', { cause: error }); }
}
module.exports = { originMarker, markDownloadedFile };
