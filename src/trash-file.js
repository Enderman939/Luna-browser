const { spawn } = require('node:child_process');
const { fileIdentity } = require('./download-history');

// Windows shell extensions and the Recycle Bin can stall the calling thread.
// Run the shell operation in a separate Electron process, not browser chrome.
function trashFile(identity, { executable, appPath, spawnProcess = spawn }) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, LUNA_TRASH_REQUEST: JSON.stringify(identity) };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawnProcess(executable, [...(appPath ? [appPath] : []), '--luna-trash-helper'], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env,
    });
    let output = '', settled = false;
    const fail = error => { if (!settled) { settled = true; reject(error); } };
    child.on('error', fail);
    child.stdout.on('data', data => {
      output += data;
      if (output.length > 65536) { child.kill(); fail(new Error('回收站返回数据异常，请检查文件是否已移入回收站。')); }
    });
    child.once('close', code => {
      if (settled) return;
      try {
        const result = JSON.parse(output.trim());
        if (code !== 0 || result.ok !== true) throw new Error(result.error || '无法移入回收站，请稍后重试。');
        settled = true; resolve();
      } catch (error) { fail(new Error(error instanceof SyntaxError ? '回收站进程未能完成操作，请检查文件后重试。' : error.message)); }
    });
  });
}

async function runTrashHelper() {
  const { app, shell } = require('electron');
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-recycle-'));
  app.setPath('userData', directory); app.disableHardwareAcceleration();
  let result, code = 0;
  try {
    const text = process.env.LUNA_TRASH_REQUEST;
    delete process.env.LUNA_TRASH_REQUEST;
    if (!text || text.length > 16384) throw new Error('删除请求无效。');
    const expected = JSON.parse(text);
    await app.whenReady();
    if (process.platform === 'darwin') app.dock?.hide();
    const current = await fileIdentity(expected.real);
    if (['real', 'dev', 'ino', 'size', 'mtime'].some(key => current[key] !== expected[key])) throw new Error('文件已变化，请重新确认删除。');
    await shell.trashItem(current.real);
    result = { ok: true };
  } catch (error) { code = 1; result = { ok: false, error: String(error.message || error).slice(0, 300) }; }
  process.stdout.write(JSON.stringify(result), () => {
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* The OS can briefly retain a helper profile handle. */ }
    app.exit(code);
  });
}

module.exports = { trashFile, runTrashHelper };
