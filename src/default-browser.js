const { execFile } = require('node:child_process');
const path = require('node:path');
const PROG_ID = 'LunaURL';
function externalURLs(args) {
  return args.filter(value => typeof value === 'string' && /^https?:\/\//i.test(value) && value.length <= 8192).flatMap(value => {
    try { const url = new URL(value); return url.username || url.password ? [] : [url.href]; } catch { return []; }
  }).slice(0, 20);
}
function registryEntries(executable, root = 'HKCU') {
  if (!path.win32.isAbsolute(executable) || /["\r\n\0]/.test(executable)) throw new Error('浏览器路径无效');
  if (root !== 'HKCU' && !/^HKCU\\Software\\luna\\RegistryTests\\[\da-f-]{36}$/i.test(root)) throw new Error('无效的注册范围');
  const classes = root + '\\Software\\Classes\\' + PROG_ID, capability = 'Software\\luna\\Capabilities';
  return [
    [classes, null, 'luna URL'], [classes, 'URL Protocol', ''], [classes + '\\DefaultIcon', null, '"' + executable + '",0'],
    [classes + '\\shell\\open\\command', null, '"' + executable + '" -- "%1"'],
    [root + '\\Software\\RegisteredApplications', 'luna', capability],
    [root + '\\' + capability, 'ApplicationName', 'luna'], [root + '\\' + capability, 'ApplicationDescription', 'luna 浏览器'],
    [root + '\\' + capability, 'ApplicationIcon', '"' + executable + '",0'],
    [root + '\\' + capability + '\\URLAssociations', 'http', PROG_ID], [root + '\\' + capability + '\\URLAssociations', 'https', PROG_ID],
  ];
}
function runRegistry(args) {
  return new Promise((resolve, reject) => execFile('reg.exe', args, { windowsHide: true, timeout: 10000, encoding: 'utf8' }, (error, stdout) => error ? reject(new Error('Windows 注册操作失败：' + error.message)) : resolve(stdout)));
}
async function registerBrowser(executable, execute = runRegistry, root = 'HKCU') {
  if (process.platform !== 'win32') throw new Error('此入口仅支持 Windows');
  for (const [key, name, value] of registryEntries(executable, root)) await execute(['add', key, ...(name === null ? ['/ve'] : ['/v', name]), '/t', 'REG_SZ', '/d', value, '/f']);
}
async function defaultStatus(executable, execute = runRegistry) {
  if (process.platform !== 'win32') return { available: false, isDefault: false };
  const value = async (key, name) => { try { const text = await execute(['query', key, ...(name ? ['/v', name] : ['/ve'])]); return text.split(/\r?\n/).map(line => /REG_SZ\s+(.*)/.exec(line)?.[1]).find(Boolean) || ''; } catch { return ''; } };
  const [http, https, command] = await Promise.all([
    value('HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice', 'ProgId'),
    value('HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', 'ProgId'),
    value('HKCU\\Software\\Classes\\' + PROG_ID + '\\shell\\open\\command'),
  ]);
  return { available: true, isDefault: http === PROG_ID && https === PROG_ID && command.toLowerCase() === ('"' + executable + '" -- "%1"').toLowerCase() };
}
module.exports = { externalURLs, registryEntries, registerBrowser, defaultStatus, PROG_ID, runRegistry };
