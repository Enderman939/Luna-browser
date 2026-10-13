const { contextBridge, ipcRenderer, webFrame } = require('electron');

if (location.origin === 'https://chromewebstore.google.com' && window === window.top) {
  const allowed = new Set(['beginInstall', 'completeInstall', 'enableAppLauncher', 'getBrowserLogin', 'getExtensionStatus', 'getFullChromeVersion', 'getIsLauncherEnabled', 'getMV2DeprecationStatus', 'getReferrerChain', 'getStoreLogin', 'getWebGLStatus', 'install', 'isInIncognitoMode', 'isPendingCustodianApproval', 'setStoreLogin'].map(name => 'chromeWebstore.' + name).concat(['chrome.management.getAll', 'chrome.management.setEnabled', 'chrome.management.uninstall']));
  contextBridge.exposeInMainWorld('lunaStore', {
    call: (method, ...args) => { if (!allowed.has(method)) throw new Error('不支持的商店接口'); return ipcRenderer.invoke(method, ...args); },
    subscribe: (name, callback) => { if (!['chrome.management.onInstalled', 'chrome.management.onUninstalled'].includes(name)) throw new Error('不支持的商店事件'); ipcRenderer.on(name, (_, info) => callback(info)); },
  });
  webFrame.executeJavaScript(`(${function () {
    const bridge = window.lunaStore;
    const chrome = window.chrome || (window.chrome = {});
    const runtime = chrome.runtime || (chrome.runtime = {});
    const extension = chrome.extension || (chrome.extension = {});
    const statuses = { BLOCKED_BY_POLICY: 'blocked_by_policy', CAN_REQUEST: 'can_request', CUSTODIAN_APPROVAL_REQUIRED: 'custodian_approval_required', DEPRECATED_MANIFEST_VERSION: 'deprecated_manifest_version', DISABLED: 'disabled', ENABLED: 'enabled', FORCE_INSTALLED: 'force_installed', INSTALLABLE: 'installable', REQUEST_PENDING: 'request_pending', TERMINATED: 'terminated' };
    const resultCodes = { SUCCESS: 'success', USER_CANCELLED: 'user_cancelled', INSTALL_ERROR: 'install_error', ICON_ERROR: 'icon_error', INVALID_ID: 'invalid_id', INSTALL_IN_PROGRESS: 'install_in_progress', MANIFEST_ERROR: 'manifest_error', UNKNOWN_ERROR: 'unknown_error' };
    function call(method, ...args) { return bridge.call('chromeWebstore.' + method, ...args); }
    const withCallback = (name, fallback) => async (...args) => {
      const callback = typeof args.at(-1) === 'function' ? args.pop() : null;
      const result = await call(name, ...args);
      if (callback) callback(result === undefined ? fallback : result);
      return result;
    };
    const api = {
      ExtensionInstallStatus: statuses, Result: resultCodes,
      MV2DeprecationStatus: { INACTIVE: 'inactive', SOFT_DISABLE: 'soft_disable', WARNING: 'warning' },
      WebGlStatus: { WEBGL_ALLOWED: 'webgl_allowed', WEBGL_BLOCKED: 'webgl_blocked' },
      beginInstallWithManifest3: async (details, callback) => {
        let answer;
        try { answer = await call('beginInstall', details); }
        catch (error) { answer = { result: 'install_error', message: String(error.message || '扩展安装失败') }; }
        const message = answer.message || (answer.result === 'user_cancelled' ? '已取消安装' : '扩展安装失败，请重试。');
        // Set both error objects in the same world before invoking the callback.
        runtime.lastError = extension.lastError = answer.result === 'success' ? null : { message };
        if (callback) callback(answer.result);
        return answer.result;
      },
      completeInstall: withCallback('completeInstall', 'success'),
      enableAppLauncher: withCallback('enableAppLauncher', true),
      getBrowserLogin: withCallback('getBrowserLogin', ''),
      getExtensionStatus: withCallback('getExtensionStatus', 'installable'),
      getFullChromeVersion: async callback => { const result = await call('getFullChromeVersion'); const version = { version_number: result.version_number }; if (callback) callback(version); return version; },
      getIsLauncherEnabled: withCallback('getIsLauncherEnabled', true),
      getMV2DeprecationStatus: withCallback('getMV2DeprecationStatus', 'inactive'),
      getReferrerChain: withCallback('getReferrerChain', ''), getStoreLogin: withCallback('getStoreLogin', ''),
      getWebGLStatus: withCallback('getWebGLStatus', 'webgl_allowed'), install: withCallback('install', 'success'),
      isInIncognitoMode: withCallback('isInIncognitoMode', false), isPendingCustodianApproval: withCallback('isPendingCustodianApproval', false), setStoreLogin: withCallback('setStoreLogin', true),
    };
    chrome.webstorePrivate = api;
    runtime.getManifest = async () => ({});
    const listeners = new Set(); bridge.subscribe('chrome.management.onInstalled', info => { for (const listener of listeners) listener(info); });
    chrome.management = {
      getAll: async callback => { const info = await bridge.call('chrome.management.getAll'); if (callback) callback(info); return info; },
      onInstalled: { addListener: callback => listeners.add(callback), removeListener: callback => listeners.delete(callback) },
      onUninstalled: { addListener: callback => bridge.subscribe('chrome.management.onUninstalled', callback), removeListener: () => {} },
      setEnabled: async (id, enabled, callback) => { await bridge.call('chrome.management.setEnabled', id, enabled); if (callback) callback(); },
      uninstall: async (id, options, callback) => { if (typeof options === 'function') callback = options; await bridge.call('chrome.management.uninstall', id, options); if (callback) callback(); },
    };
    const rename = () => {
      for (const span of document.querySelectorAll('span')) if (/^(Add to Chrome|添加至 Chrome|添加到 Chrome)$/.test(span.textContent.trim())) span.textContent = span.textContent.replace('Chrome', 'luna');
    };
    addEventListener('DOMContentLoaded', rename);
    let queued = false;
    new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; rename(); }); } }).observe(document, { subtree: true, childList: true, characterData: true });
  }.toString()})()`).catch(() => {});
}
if (location.origin === 'https://microsoftedge.microsoft.com' && window === window.top) {
  contextBridge.exposeInMainWorld('lunaEdgeStore', {
    install: id => ipcRenderer.invoke('lunaEdgeStore.install', id),
    status: id => ipcRenderer.invoke('lunaEdgeStore.status', id),
  });
  webFrame.insertCSS('#luna-edge-panel{position:fixed!important;right:24px!important;bottom:24px!important;z-index:2147483647!important;display:flex!important;flex-direction:column!important;gap:10px!important;max-width:420px!important;padding:16px!important;border:1px solid #ddd!important;border-radius:12px!important;background:white!important;color:#111!important;box-shadow:0 8px 32px #0003!important;font:13px "Segoe UI",sans-serif!important}#luna-edge-panel[hidden]{display:none!important}#luna-edge-panel button{border:0!important;border-radius:8px!important;background:#111!important;color:#fff!important;padding:11px 20px!important;font:13px "Segoe UI",sans-serif!important;cursor:pointer!important}#luna-edge-panel button:disabled{opacity:.55!important;cursor:default!important}#luna-edge-message{line-height:1.6!important;overflow-wrap:anywhere!important}');
  webFrame.executeJavaScript(`(${function () {
    let panel, button, message, id = '', busy = false;
    const refresh = async () => {
      if (!document.body) return;
      const next = location.pathname.startsWith('/addons/detail/') ? location.pathname.split('/').find(part => /^[a-p]{32}$/.test(part)) || '' : '';
      if (!next) { if (panel) panel.hidden = true; return; }
      if (!panel) {
        panel = document.createElement('div'); panel.id = 'luna-edge-panel';
        button = document.createElement('button'); button.textContent = '安装到 luna';
        message = document.createElement('div'); message.id = 'luna-edge-message';
        panel.append(button, message); document.body.append(panel);
        button.onclick = async () => {
          if (busy) return;
          busy = true; button.disabled = true; button.textContent = '正在下载安装…'; message.textContent = '';
          try {
            const result = await window.lunaEdgeStore.install(id);
            message.textContent = result.success ? '扩展已安装，点击浏览器工具栏的图标即可使用。' : '已取消安装';
            button.textContent = result.success ? '已安装到 luna' : '安装到 luna'; button.disabled = result.success;
          } catch (error) {
            message.textContent = String(error.message || '安装失败，请重试。').replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/, '').replace(/^(?:TypeError|Error):\s*/, '');
            button.textContent = '重试安装'; button.disabled = false;
          } finally { busy = false; }
        };
      }
      panel.hidden = false;
      if (id !== next && !busy) {
        id = next; message.textContent = '';
        const installed = await window.lunaEdgeStore.status(id);
        button.textContent = installed ? '已安装到 luna' : '安装到 luna'; button.disabled = installed;
      }
    };
    addEventListener('DOMContentLoaded', () => refresh().catch(() => {}));
    setInterval(() => refresh().catch(() => {}), 750);
    refresh().catch(() => {});
  }.toString()})()`).catch(() => {});
}
