import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let stdout = '', stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk; });
    child.stderr?.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`${command} exited ${code}: ${stderr || stdout}`)));
  });
}

export async function diskSize(directory) {
  const script = fileURLToPath(new URL('./windows-package-size.ps1', import.meta.url));
  return JSON.parse(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Directory', path.resolve(directory)]));
}

export async function compactPackage(directory) {
  if (process.platform !== 'win32') throw new Error('Package compression requires Windows 10 or later and NTFS.');
  const root = path.resolve(directory);
  for (const file of ['luna.exe', 'resources/app.asar', 'resources/luna-ie-host.exe']) {
    if (!fs.existsSync(path.join(root, file))) throw new Error(`Incomplete luna package: ${file}`);
  }
  const before = await diskSize(root);
  // WOF/LZX is transparent filesystem compression, not an executable packer.
  // Windows decompresses reads; no extraction or launcher is needed at startup.
  console.log(`Compressing package with Windows LZX: ${root}`);
  console.log((await run('compact.exe', ['/C', `/S:${root}`, '/A', '/EXE:LZX', '/Q'], { cwd: root })).trim());
  const after = await diskSize(root);
  console.log(`Disk allocation: ${(before.allocatedBytes / 1048576).toFixed(2)} -> ${(after.allocatedBytes / 1048576).toFixed(2)} MiB`);
  return { before, after };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const channel = fs.existsSync('dist/beta/luna-win32-x64/luna.exe') ? 'beta' : 'release';
  await compactPackage(process.argv[2] || `dist/${channel}/luna-win32-x64`);
}
