const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
let cleanupStarted = false;

function watchPrivateCleanup(root, script) {
  if (cleanupStarted || process.platform !== 'win32') return;
  const child = spawn(script, [root, String(process.pid)], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', error => { cleanupStarted = false; console.error('Private cleanup helper error:', error.message); });
  child.on('exit', code => { if (code) console.error('Private cleanup helper exited:', code); });
  child.unref(); cleanupStarted = true;
}

function cleanupPrivateDirectories(root) {
  if (!fs.existsSync(root)) return;
  for (const name of fs.readdirSync(root)) {
    const match = /^(\d+)-[a-f0-9-]{36}$/.exec(name);
    if (!match) continue;
    try { process.kill(Number(match[1]), 0); continue; } catch { /* owner is no longer running */ }
    try { fs.rmSync(path.join(root, name), { recursive: true, force: true }); } catch { /* retry on next startup */ }
  }
}
function createPrivateDirectory(root) {
  fs.mkdirSync(root, { recursive: true });
  const directory = path.join(root, process.pid + '-' + randomUUID());
  fs.mkdirSync(directory); return directory;
}
async function removePrivateDirectory(directory) {
  try { await fs.promises.rm(directory, { recursive: true, force: true }); return true; }
  catch { return false; } // Chromium can retain file handles until process exit.
}
module.exports = { cleanupPrivateDirectories, createPrivateDirectory, removePrivateDirectory, watchPrivateCleanup };
