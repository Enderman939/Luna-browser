const { contextBridge } = require('electron');
function markPrivateContext() {
  if (!globalThis.chrome?.runtime?.id) return;
  try { Object.defineProperty(globalThis.chrome.extension, 'inIncognitoContext', { value: true, configurable: true }); } catch { /* native immutable API */ }
}
if (process.contextIsolated) {
  try { contextBridge.executeInMainWorld({ func: markPrivateContext }); } catch { /* unrelated webpage */ }
} else markPrivateContext();
