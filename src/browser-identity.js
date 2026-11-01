function browserUserAgent(value) {
  return String(value || '').replace(/\s(?:Electron|luna(?:-browser)?|Luma)\/[\w.+-]+/gi, '');
}
function chromeUserAgent(value, platform = process.platform) {
  const chrome = process.versions.chrome || /Chrome\/([\w.]+)/i.exec(String(value || ''))?.[1] || '120.0.0.0';
  const system = platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${system}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
}
function chromeUserAgentMetadata(platform = process.platform, architecture = process.arch, release = require('node:os').release()) {
  const fullVersion = process.versions.chrome || '120.0.0.0', major = fullVersion.split('.')[0];
  const system = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux';
  const winBuild = platform === 'win32' ? Number(release.split('.')[2]) || 0 : 0;
  const brands = [{ brand: 'Not_A Brand', version: '99' }, { brand: 'Chromium', version: major }, { brand: 'Google Chrome', version: major }];
  return {
    brands, fullVersionList: brands.map(item => ({ ...item, version: item.brand === 'Not_A Brand' ? '99.0.0.0' : fullVersion })),
    platform: system, platformVersion: platform === 'win32' ? winBuild >= 22000 ? '15.0.0' : '10.0.0' : '',
    architecture: architecture === 'x64' ? 'x86' : architecture === 'arm64' ? 'arm' : 'x86',
    model: '', mobile: false, bitness: ['x64', 'arm64'].includes(architecture) ? '64' : '32', wow64: false,
  };
}
function configureSessionIdentity(session) {
  const value = chromeUserAgent(session.getUserAgent());
  session.setUserAgent(value);
  return value;
}
function isGoogleOAuthPopup(url) {
  try { const hostname = new URL(url).hostname.toLowerCase(); return hostname === 'accounts.google.com' || hostname.endsWith('.accounts.google.com'); }
  catch { return false; }
}
module.exports = { browserUserAgent, chromeUserAgent, chromeUserAgentMetadata, configureSessionIdentity, isGoogleOAuthPopup };
