const path = require('node:path');

function localFile(value, platform = process.platform) {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f]/.test(value)) return '';
  if (platform === 'win32') return /^[a-z]:[\\/]/i.test(value) ? path.win32.normalize(value) : '';
  return /^\/(?!\/)/.test(value) ? path.posix.normalize(value) : '';
}
function localName(value, platform = process.platform) {
  return (platform === 'win32' ? path.win32 : path.posix).basename(value || '');
}
module.exports = { localFile, localName };
