const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const AdmZip = require('adm-zip');
const exec = promisify(execFile);

function validateArchive(zip, platform) {
  const root = platform === 'darwin' ? 'luna.app' : 'luna-win32-x64';
  const entries = zip.getEntries(), seen = new Set(); let expanded = 0;
  if (!entries.length || entries.length > 30000) throw new Error('更新包的文件数量无效。');
  for (const entry of entries) {
    const name = entry.entryName, parts = name.replace(/\/$/, '').split('/');
    const macMetadata = platform === 'darwin' && parts[0] === '__MACOSX' && (parts.length === 1 || parts[1] === root || parts[1] === '._' + root);
    if (parts[0] !== root && !macMetadata || parts.some(part => !part || part === '.' || part === '..' || /[\\:\x00-\x1f]/.test(part) || platform === 'win32' && (/[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))) throw new Error('更新包包含无效的文件路径。');
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error('更新包包含重复路径。');
    seen.add(key); expanded += entry.header.size;
    if (expanded > 2 * 1024 * 1024 * 1024 || entry.header.flags & 1) throw new Error('更新包过大或含加密文件。');
    const type = (entry.attr >>> 16) & 0xf000;
    if (type === 0xa000) {
      if (platform !== 'darwin' || macMetadata) throw new Error('更新包在此位置不允许文件链接。');
      const target = entry.getData().toString('utf8');
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), target));
      if (target.startsWith('/') || /[\\\x00-\x1f]/.test(target) || !resolved.startsWith(root + '/')) throw new Error('更新包中的文件链接越过了应用目录。');
    } else if (type && type !== 0x8000 && type !== 0x4000) throw new Error('更新包包含不支持的文件类型。');
  }
  const required = platform === 'darwin'
    ? ['Contents/MacOS/luna', 'Contents/Resources/app.asar', 'Contents/Info.plist']
    : ['luna.exe', 'resources/app.asar', 'icudtl.dat', 'resources.pak'];
  for (const name of required) if (!seen.has((root + '/' + name).toLowerCase())) throw new Error('更新包缺少应用运行文件。');
  return root;
}
function windowsScript(config) {
  const encoded = Buffer.from(JSON.stringify(config)).toString('base64');
  return `$ErrorActionPreference = 'Stop'
$c = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json
if ($c.started) { [string]$PID | Set-Content -LiteralPath $c.started -Encoding UTF8 }
function Move-Retry($source, $target) {
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try { Move-Item -LiteralPath $source -Destination $target -ErrorAction Stop; return } catch { if ($attempt -eq 59) { throw }; Start-Sleep -Milliseconds 500 }
  }
}
$moved = $false
try {
  Write-Output ('Waiting for browser PID ' + $c.pid)
  $deadline = [DateTime]::UtcNow.AddSeconds(120)
  while (Get-Process -Id $c.pid -ErrorAction SilentlyContinue) {
    if ([DateTime]::UtcNow -gt $deadline) { throw 'Browser did not exit' }
    Start-Sleep -Milliseconds 200
  }
  Write-Output 'Browser exited; replacing application'
  Move-Retry $c.destination $c.backup
  $moved = $true
  Move-Retry $c.staged $c.destination
  $exe = Join-Path $c.destination 'luna.exe'
  Start-Process -FilePath $exe -WorkingDirectory $c.destination
  'Updated successfully; previous application: ' + $c.backup | Set-Content -LiteralPath $c.log -Encoding UTF8
} catch {
  $failure = $_.Exception.Message
  if ($moved) {
    if (Test-Path -LiteralPath $c.destination) { Remove-Item -LiteralPath $c.destination -Recurse -Force }
    if (Test-Path -LiteralPath $c.backup) { Move-Retry $c.backup $c.destination }
    Start-Process -FilePath (Join-Path $c.destination 'luna.exe') -WorkingDirectory $c.destination
  }
  $failure | Set-Content -LiteralPath $c.log -Encoding UTF8
} finally {
  if (Test-Path -LiteralPath $c.staging) { Remove-Item -LiteralPath $c.staging -Recurse -Force }
}
`;
}
const shellQuote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
function macScript(config) {
  return `#!/bin/sh
destination=${shellQuote(config.destination)}
staged=${shellQuote(config.staged)}
backup=${shellQuote(config.backup)}
staging=${shellQuote(config.staging)}
log=${shellQuote(config.log)}
${config.started ? 'echo ready > ' + shellQuote(config.started) : ''}
attempt=0
while kill -0 ${config.pid} 2>/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 120 ]; then echo 'Browser did not exit' > "$log"; exit 1; fi
  sleep 1
done
if /bin/mv "$destination" "$backup"; then
  if /bin/mv "$staged" "$destination" && /usr/bin/open "$destination"; then
    echo "Updated successfully; previous application: $backup" > "$log"
  else
    /bin/rm -rf "$destination"
    /bin/mv "$backup" "$destination"
    /usr/bin/open "$destination"
    echo 'Installation failed; previous application restored' > "$log"
  fi
else
  echo 'Unable to replace application; original application preserved' > "$log"
fi
/bin/rm -rf "$staging"
`;
}
async function prepareUpdate({ file, release, executable = process.execPath, directory, platform = process.platform, pid = process.pid }) {
  if (!['win32', 'darwin'].includes(platform) || !Number.isSafeInteger(pid) || pid < 1) throw new Error('此平台暂不支持自动安装。');
  const destination = platform === 'darwin' ? path.dirname(path.dirname(path.dirname(executable))) : path.dirname(executable);
  const stat = await fs.lstat(destination);
  if (!stat.isDirectory() || stat.isSymbolicLink() || platform === 'darwin' && !destination.endsWith('.app') || platform === 'win32' && path.basename(executable).toLowerCase() !== 'luna.exe') throw new Error('应用安装位置无效。');
  const parent = path.dirname(destination), id = randomUUID();
  const staging = path.join(parent, '.luna-update-' + id), backup = path.join(parent, '.luna-backup-' + id);
  // Fail before closing windows if the installation directory is not writable.
  try { await fs.mkdir(staging); } catch { throw new Error('无法写入应用所在目录。请将 Luna 移到当前账号可写的位置后重试更新。'); }
  try {
    const zip = new AdmZip(file, { fs: process.versions.electron ? require('original-fs') : require('node:fs') }), root = validateArchive(zip, platform);
    if (platform === 'darwin') await exec('/usr/bin/ditto', ['-x', '-k', file, staging], { timeout: 120000 });
    else zip.extractAllTo(staging, false);
    const staged = path.join(staging, root);
    if (platform === 'darwin') await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', staged], { timeout: 120000 });
    const archive = path.join(staged, platform === 'darwin' ? 'Contents/Resources/app.asar' : 'resources/app.asar');
    // Electron's filesystem reads ASAR paths while preserving the archive itself.
    const metadata = JSON.parse(await fs.readFile(path.join(archive, 'package.json'), 'utf8'));
    if (metadata.name !== 'luna-browser' || metadata.version !== release.version) throw new Error('更新包中的应用身份或版本与 Release 不符。');
    await fs.mkdir(directory, { recursive: true });
    const started = path.join(directory, 'installer-' + id + '.ready');
    const config = { destination, staged, backup, staging, pid, started, log: path.join(directory, 'install-result.log') };
    const script = path.join(directory, 'install-' + id + (platform === 'darwin' ? '.sh' : '.ps1'));
    await fs.writeFile(script, platform === 'darwin' ? macScript(config) : '\ufeff' + windowsScript(config), { mode: 0o700 });
    let launchedChild, helperPid;
    return {
      async launch() {
        const program = platform === 'darwin' ? '/bin/sh' : path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
        const outputFile = path.join(directory, 'installer-output.log');
        const psQuote = value => "'" + value.replaceAll("'", "''") + "'";
        const invocation = Buffer.from('& ' + psQuote(script), 'utf16le').toString('base64');
        // A short-lived launcher lets the helper outlive the browser's process tree.
        const launcher = `Start-Process -FilePath ${psQuote(program)} -ArgumentList '-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${invocation}' -WindowStyle Hidden -RedirectStandardOutput ${psQuote(outputFile)} -RedirectStandardError ${psQuote(path.join(directory, 'installer-error.log'))}`;
        const args = platform === 'darwin' ? [script] : ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(launcher, 'utf16le').toString('base64')];
        const output = platform === 'darwin' ? await fs.open(outputFile, 'a') : null;
        try {
          const child = spawn(program, args, { detached: platform === 'darwin', stdio: output ? ['ignore', output.fd, output.fd] : 'ignore', windowsHide: true, cwd: directory });
          launchedChild = child;
          await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
          child.unref();
          const deadline = Date.now() + 15000;
          while (!await fs.stat(started).then(() => true, () => false) || platform === 'win32' && child.exitCode === null) {
            if (Date.now() > deadline || platform === 'darwin' && child.exitCode !== null) throw new Error('更新安装程序未能启动，请重试。');
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          if (platform === 'win32') helperPid = Number((await fs.readFile(started, 'utf8')).replace(/^\ufeff/, '').trim());
          await fs.rm(started, { force: true });
        } finally { await output?.close(); }
      },
      async cancel() {
        if (launchedChild?.exitCode === null) launchedChild.kill();
        if (Number.isSafeInteger(helperPid) && helperPid > 0) { try { process.kill(helperPid); } catch {} }
        await fs.rm(staging, { recursive: true, force: true }); await fs.rm(script, { force: true }); await fs.rm(started, { force: true });
      },
    };
  } catch (error) { await fs.rm(staging, { recursive: true, force: true }); throw error; }
}
module.exports = { prepareUpdate, validateArchive, windowsScript, macScript };
