import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import * as asar from '@electron/asar';

const require = createRequire(import.meta.url);
const root = path.resolve('.');
const metadata = require('../package.json');
const channel = metadata.version.includes('-') ? 'beta' : 'release';
const channelRoot = path.join(root, 'dist', channel);
const direct = path.join(channelRoot, 'luna-win32-x64');
const currentVersion = path.join(channelRoot, metadata.version, 'luna-win32-x64');
let browserDirectory = fsSync.existsSync(path.join(currentVersion, 'luna.exe')) ? currentVersion : direct;
let outputRoot = browserDirectory === currentVersion ? path.dirname(currentVersion) : channelRoot;
if (!fsSync.existsSync(path.join(browserDirectory, 'luna.exe'))) {
  const candidates = (await fs.readdir(channelRoot, { withFileTypes: true })).filter(entry => entry.isDirectory() && fsSync.existsSync(path.join(channelRoot, entry.name, 'luna-win32-x64', 'luna.exe'))).map(entry => entry.name).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  if (!candidates.length) throw new Error('找不到 Windows x64 成品，请先运行 Windows 打包。');
  outputRoot = path.join(channelRoot, candidates[0]); browserDirectory = path.join(outputRoot, 'luna-win32-x64');
}
const existingZip = path.join(outputRoot, `luna-${metadata.version}-win32-x64.zip`);
if (!fsSync.existsSync(existingZip)) throw new Error('找不到浏览器 ZIP，请先运行 Windows 打包。');
const installerRoot = path.join(outputRoot, 'installer');
await fs.mkdir(installerRoot, { recursive: true });
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'luna-react-installer-'));
const stage = path.join(temp, 'app'), resources = path.join(temp, 'resources'), uninstaller = path.join(resources, 'Luna-Uninstall.exe');
await fs.mkdir(path.join(stage, 'ui'), { recursive: true }); await fs.mkdir(resources, { recursive: true });
try {
  await fs.copyFile(path.join(root, 'scripts/installer-react/index.html'), path.join(stage, 'ui/index.html'));
  await fs.copyFile(path.join(root, 'scripts/installer-react/renderer.css'), path.join(stage, 'ui/renderer.css'));
  await fs.copyFile(path.join(root, 'scripts/installer-react/preload.js'), path.join(stage, 'preload.js'));
   const notices = [await fs.readFile(path.join(root, 'scripts/installer-react/THIRD_PARTY_NOTICES.txt'), 'utf8')];
   for (const dependency of ['react', 'react-dom', 'scheduler', 'framer-motion', 'motion-dom', 'motion-utils']) {
     const licenseName = dependency.startsWith('motion-') || dependency === 'framer-motion' ? 'LICENSE.md' : 'LICENSE';
     notices.push(`\n\n${dependency}\n${'-'.repeat(dependency.length)}\n` + await fs.readFile(path.join(root, 'node_modules', dependency, licenseName), 'utf8'));
   }
   await fs.writeFile(path.join(stage, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n'));
  await fs.copyFile(path.join(root, 'src/ui/assets/app.png'), path.join(stage, 'ui/app.png'));
  await fs.copyFile(path.join(root, 'src/ui/assets/app.ico'), path.join(stage, 'app.ico'));
  await fs.copyFile(path.join(root, 'scripts/installer-react/main.cjs'), path.join(stage, 'main.cjs'));
  await build({ entryPoints: [path.join(root, 'scripts/installer-react/renderer.jsx')], bundle: true, platform: 'browser', format: 'iife', target: 'es2020', outfile: path.join(stage, 'ui/renderer.js'), minify: true, sourcemap: false, logLevel: 'warning' });
  await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify({ name: 'luna-setup', productName: 'Luna Browser Setup', version: metadata.version, main: 'main.cjs', private: true }, null, 2));
  const csc = path.join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const assemblyInfo = path.join(temp, 'UninstallerInfo.cs');
  const assemblyVersion = metadata.version.split('-')[0] + '.0';
  await fs.writeFile(assemblyInfo, `using System.Reflection;\n[assembly: AssemblyTitle("Luna Browser Uninstaller") ]\n[assembly: AssemblyDescription("Luna Browser uninstaller") ]\n[assembly: AssemblyCompany("Enderman939") ]\n[assembly: AssemblyProduct("Luna Browser") ]\n[assembly: AssemblyVersion("${assemblyVersion}") ]\n[assembly: AssemblyFileVersion("${assemblyVersion}") ]\n`);
  execFileSync(csc, ['/nologo', '/optimize+', '/platform:x64', '/target:winexe', '/win32icon:' + path.join(root, 'src/ui/assets/app.ico'), '/out:' + uninstaller, '/r:System.Windows.Forms.dll', assemblyInfo, path.join(root, 'scripts/LunaUninstall.cs')], { stdio: 'inherit' });
  const appDirectory = path.join(temp, 'luna-setup-runtime');
  await fs.cp(browserDirectory, appDirectory, { recursive: true });
  await fs.copyFile(uninstaller, path.join(appDirectory, 'resources', 'Luna-Uninstall.exe'));
  await fs.copyFile(existingZip, path.join(appDirectory, 'resources', 'payload.zip'));
  const payloadHash = (await import('node:crypto')).createHash('sha256').update(await fs.readFile(existingZip)).digest('hex');
  await fs.writeFile(path.join(appDirectory, 'resources', 'payload.sha256'), payloadHash + '\n', 'ascii');
  const installerAsar = path.join(appDirectory, 'resources', 'app.asar');
  await fs.rm(installerAsar, { force: true }); await asar.createPackage(stage, installerAsar);
  execFileSync(process.execPath, [path.join(root, 'tests/installer-react-smoke.js')], { cwd: root, env: { ...process.env, LUNA_SETUP_RUNTIME: appDirectory }, stdio: 'inherit', timeout: 15 * 60 * 1000 });
  const bootstrap = path.join(temp, 'luna-bootstrap.exe'), bootstrapInfo = path.join(temp, 'BootstrapInfo.cs');
  await fs.writeFile(bootstrapInfo, `using System.Reflection;\n[assembly: AssemblyTitle("Luna Browser Setup") ]\n[assembly: AssemblyDescription("Luna Browser Setup") ]\n[assembly: AssemblyCompany("Enderman939") ]\n[assembly: AssemblyProduct("Luna Browser Setup") ]\n[assembly: AssemblyVersion("${assemblyVersion}") ]\n[assembly: AssemblyFileVersion("${assemblyVersion}") ]\n`);
  const bootstrapCsc = path.join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  execFileSync(bootstrapCsc, ['/nologo', '/optimize+', '/platform:x64', '/target:winexe', '/win32icon:' + path.join(root, 'src/ui/assets/app.ico'), '/out:' + bootstrap, '/r:System.IO.Compression.dll', '/r:System.IO.Compression.FileSystem.dll', '/r:System.Core.dll', bootstrapInfo, path.join(root, 'scripts/InstallerBootstrap.cs')], { stdio: 'inherit' });
  const archive = path.join(temp, 'installer-app.zip');
  execFileSync('C:\\Program Files\\7-Zip\\7z.exe', ['a', '-tzip', '-mx=1', archive, '.'], { cwd: appDirectory, stdio: 'inherit' });
   const output = path.join(installerRoot, `Luna-Setup-${metadata.version}-win32-x64.exe`);
   const payloadBytes = await fs.readFile(archive), footer = Buffer.alloc(16);
   footer.writeBigInt64LE(BigInt(payloadBytes.length)); footer.write('LUNAZIP1', 8, 'ascii');
   await fs.writeFile(output, Buffer.concat([await fs.readFile(bootstrap), payloadBytes, footer]));
  const hash = (await import('node:crypto')).createHash('sha256').update(await fs.readFile(output)).digest('hex');
   const sums = path.join(installerRoot, 'SHA256SUMS.txt'); const old = fsSync.existsSync(sums) ? (await fs.readFile(sums, 'utf8')).split(/\r?\n/).filter(line => line && !/Luna-Setup-[\w.+-]+-win32-x64\.exe$/.test(line)) : [];
  old.push(hash + '  ' + path.basename(output)); await fs.writeFile(sums, old.join('\n') + '\n', 'ascii');
   await fs.mkdir(path.join(root, 'artifacts'), { recursive: true }); await fs.writeFile(path.join(root, 'artifacts/installer-result.json'), JSON.stringify({ passed: true, checks: ['React UI', 'Amicro motion', 'payload installation', 'shortcuts', 'uninstall'], version: metadata.version, installer: output, bytes: (await fs.stat(output)).size, sha256: hash, ui: 'React + Amicro FadeUp/MorphLoader/GlowButton', testedAt: new Date().toISOString() }, null, 2));
  console.log('Built React Luna installer:', output);
} finally { await fs.rm(temp, { recursive: true, force: true }); }
