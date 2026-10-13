const { contextBridge } = require('electron');

function alignExtensionAPIs() {
  const chrome = globalThis.chrome;
  if (!chrome?.runtime?.id) return;
  // Electron exposes a native `browser` namespace as well as `chrome`. The
  // extension bridge augments chrome, so Firefox-style/polyfill users must see
  // the same augmented APIs rather than the original incomplete namespace.
  try { Object.defineProperty(globalThis, 'browser', { value: chrome, configurable: true, enumerable: true }); }
  catch {
    const browser = globalThis.browser;
    if (!browser) return;
    for (const name of Object.keys(chrome)) {
      try { Object.defineProperty(browser, name, { value: chrome[name], configurable: true, enumerable: true }); } catch { /* native non-configurable field */ }
    }
  }
}
if (process.contextIsolated) {
  try { contextBridge.executeInMainWorld({ func: alignExtensionAPIs }); } catch { /* unrelated web content */ }
} else alignExtensionAPIs();
