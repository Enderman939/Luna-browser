const crypto = require('node:crypto');

function parseExtensionId(input) {
  const value = String(input || '').trim();
  if (/^[a-p]{32}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['chromewebstore.google.com', 'chrome.google.com'].includes(url.hostname)) throw new Error();
    const id = url.pathname.split('/').find(part => /^[a-p]{32}$/.test(part));
    if (id) return id;
  } catch { /* invalid store link */ }
  throw new Error('请输入 Chrome 网上应用店链接或 32 位扩展 ID');
}
function parseStoreRequest(input, market = 'edge') {
  const value = String(input || '').trim();
  if (/^[a-p]{32}$/.test(value)) return { id: value, market: market === 'chrome' ? 'chrome' : 'edge' };
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error();
    if (url.hostname === 'microsoftedge.microsoft.com' && url.pathname.startsWith('/addons/')) {
      const id = url.pathname.split('/').find(part => /^[a-p]{32}$/.test(part));
      if (id) return { id, market: 'edge' };
    }
    return { id: parseExtensionId(value), market: 'chrome' };
  } catch { throw new Error('请输入 Edge / Chrome 扩展商店链接或 32 位扩展 ID'); }
}
function extensionIdFromKey(key) {
  return crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
}
function crxURL(id, chromeVersion, endpoint = 'https://update.googleapis.com/service/update2/crx') {
  const url = new URL(endpoint);
  url.searchParams.set('response', 'redirect'); url.searchParams.set('acceptformat', 'crx3,crx2');
  url.searchParams.set('prodversion', chromeVersion); url.searchParams.set('prod', 'chromecrx');
  url.searchParams.set('x', new URLSearchParams({ id: parseExtensionId(id), installsource: 'ondemand', uc: '' }).toString());
  return url.href;
}
function edgeCrxURL(id, chromeVersion) {
  if (!/^[a-p]{32}$/.test(id)) throw new Error('无效的扩展 ID');
  const url = new URL('https://edge.microsoft.com/extensionwebstorebase/v1/crx');
  url.searchParams.set('response', 'redirect');
  url.searchParams.set('prodversion', chromeVersion);
  url.searchParams.set('x', new URLSearchParams({ id, installsource: 'ondemand', uc: '' }).toString());
  return url.href;
}
function friendlyError(error, host = 'Google 扩展下载服务') {
  if (error?.message && /[\u4e00-\u9fff]/.test(error.message) && error.message !== '连接超时') return error.message;
  const text = [error?.message, error?.cause?.message, error?.cause?.code, error?.code].filter(Boolean).join(' ');
  if (/timeout|timed out|ERR_TIMED_OUT|TimeoutError/i.test(text)) return '连接 ' + host + ' 超时，请检查浏览器代理或网络后重试。';
  if (/ERR_PROXY|PROXY_CONNECTION|TUNNEL_CONNECTION/i.test(text)) return '无法连接代理服务器，请检查系统代理后重试。';
  if (/ERR_CERT|certificate|CERT_/i.test(text)) return '下载连接的证书校验失败，请检查网络或代理证书。';
  if (/fetch failed|Failed to fetch|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ENOTFOUND|ECONN|network/i.test(text)) return '无法连接 ' + host + '。网页和扩展下载使用不同域名，请确认代理能访问该下载服务，然后重试。';
  if (/ENOSPC/i.test(text)) return '磁盘空间不足，无法保存扩展程序。';
  return error?.message || '扩展安装失败，请重试。';
}
async function fetchCrx(fetch, url, onProgress = () => {}, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('连接超时')), options.timeout || 120000);
  const limit = options.limit || 64 * 1024 * 1024;
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'include', headers: { 'Cache-Control': 'no-cache' } });
    if (response.status === 204 || response.status === 404) throw new Error('商店未提供此扩展的可用安装包，可能已下架或不支持当前 Chromium 版本。');
    if (!response.ok) throw new Error('扩展下载服务返回 HTTP ' + response.status + '，请稍后重试。');
    const total = Number(response.headers.get('content-length')) || 0;
    if (total > limit) throw new Error('扩展安装包超过 64 MB');
    const chunks = []; let received = 0, lastUpdate = 0;
    for await (const chunk of response.body) {
      received += chunk.length; if (received > limit) throw new Error('扩展安装包超过 64 MB');
      chunks.push(Buffer.from(chunk));
      if (Date.now() - lastUpdate >= 150) { onProgress({ received, total }); lastUpdate = Date.now(); }
    }
    onProgress({ received, total });
    const buffer = Buffer.concat(chunks);
    if (buffer.length < 12 || buffer.subarray(0, 4).toString() !== 'Cr24') throw new Error('下载服务未返回有效的 CRX 安装包，请检查代理是否拦截了下载。');
    return buffer;
  } catch (error) {
    controller.abort();
    const wrapped = new Error(friendlyError(error, error.downloadHost || new URL(url).hostname), { cause: error });
    wrapped.downloadHost = error.downloadHost || new URL(url).hostname;
    throw wrapped;
  } finally { clearTimeout(timeout); }
}
async function downloadStoreCrx(fetch, id, chromeVersion, onProgress, options = {}) {
  const endpoints = options.endpoints || ['https://update.googleapis.com/service/update2/crx', 'https://clients2.google.com/service/update2/crx'];
  let last;
  for (const endpoint of endpoints) {
    try { return await fetchCrx(fetch, crxURL(id, chromeVersion, endpoint), onProgress, options); }
    catch (error) {
      last = error;
      if (error.downloadHost && error.downloadHost !== new URL(endpoint).hostname) throw error;
      if (!/net::|network|fetch|timeout|连接|超时|HTTP 5\d\d/i.test([error.message, error.cause?.message].join(' '))) throw error;
    }
  }
  throw last;
}
module.exports = { parseExtensionId, parseStoreRequest, extensionIdFromKey, crxURL, edgeCrxURL, fetchCrx, downloadStoreCrx, friendlyError };
