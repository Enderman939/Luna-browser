const { net } = require('electron');
const { Readable } = require('node:stream');

// Use Chromium's network stack and the browser's session/proxy. Keep the last
// redirect destination so a failed CDN request is reported against that host.
function browserFetch(session, url, options = {}) {
  return new Promise((resolve, reject) => {
    let destination = url;
    const request = net.request({ session, url, method: options.method || 'GET', redirect: 'follow', credentials: 'include', useSessionCookies: true, headers: options.headers || {} });
    const failed = error => { error.downloadHost = new URL(destination).hostname; reject(error); };
    request.on('redirect', (_, method, target) => { destination = target; request.followRedirect(); });
    request.once('error', failed);
    const abort = () => { const error = options.signal.reason || new Error('请求已取消'); failed(error); request.abort(); };
    if (options.signal?.aborted) { abort(); return; }
    options.signal?.addEventListener('abort', abort, { once: true });
    request.once('close', () => options.signal?.removeEventListener('abort', abort));
    request.once('response', incoming => {
      try {
        const headers = new Headers();
        for (const [name, values] of Object.entries(incoming.headers)) for (const value of Array.isArray(values) ? values : [values]) headers.append(name, String(value));
        const response = new Response([204, 205, 304].includes(incoming.statusCode) ? null : Readable.toWeb(incoming), { status: incoming.statusCode, headers });
        resolve(response);
      } catch (error) { failed(error); request.abort(); }
    });
    if (options.body) request.write(options.body);
    request.end();
  });
}
module.exports = { browserFetch };
