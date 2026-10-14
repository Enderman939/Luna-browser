import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as asar from '@electron/asar';
import { diskSize } from './compact-package.mjs';

const require = createRequire(import.meta.url), AdmZip = require('adm-zip');
const workspace = fileURLToPath(new URL('../', import.meta.url)), dist = path.join(workspace, 'dist');
const apply = process.argv.includes('--apply');
const exists = file => fs.access(file).then(() => true, () => false);
async function digest(file) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
async function packageInfo(directory) {
  const archive = path.join(directory, 'resources/app.asar');
  const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  return { version: metadata.version, name: metadata.name, asarSHA256: await digest(archive) };
}
async function validateChannel(source, channel) {
  const directory = path.join(dist, source, 'luna-win32-x64'), info = await packageInfo(directory);
  if (info.name !== 'luna-browser' || (channel === 'beta') !== info.version.includes('-')) throw new Error(`Unexpected ${channel} package in ${source}`);
  const zipFile = path.join(dist, source, `luna-${info.version}-win32-x64.zip`), zip = new AdmZip(zipFile);
  if (!zip.test()) throw new Error(`ZIP CRC failed: ${zipFile}`);
  const zipped = zip.getEntry('luna-win32-x64/resources/app.asar')?.getData();
  if (!zipped || createHash('sha256').update(zipped).digest('hex') !== info.asarSHA256) throw new Error(`ZIP and runtime differ: ${source}`);
  return { channel, source, directory, ...info, zipName: path.basename(zipFile), zipSHA256: await digest(zipFile), zipBytes: (await fs.stat(zipFile)).size };
}
async function noLinksOrProfiles(directory) {
  if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error(`Refusing directory link: ${directory}`);
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Refusing linked content: ${path.join(directory, entry.name)}`);
    if (/^(?:user data|userdata|browser-data\.json|password-vault\.json|extensions-data\.json|download-jobs\.json)$/i.test(entry.name)) throw new Error(`Possible browsing data, retained: ${path.join(directory, entry.name)}`);
    if (entry.isDirectory()) await noLinksOrProfiles(path.join(directory, entry.name));
  }
}
const before = await diskSize(dist);
const releaseSource = await exists(path.join(dist, 'release')) ? 'release' : 'compact';
const betaSource = await exists(path.join(dist, 'beta')) ? 'beta' : await exists(path.join(dist, 'preview-update')) ? 'preview-update' : 'preview';
const channels = [await validateChannel(releaseSource, 'release'), await validateChannel(betaSource, 'beta')];
const obsoleteDirectories = [];
for (const name of ['Luma-win32-x64', 'luna-win32-x64', 'preview', 'preview-update', 'compact']) {
  if (channels.some(channel => channel.source === name) || !await exists(path.join(dist, name))) continue;
  const root = path.join(dist, name);
  const runtime = name.endsWith('win32-x64') ? root : path.join(root, 'luna-win32-x64');
  const info = await packageInfo(runtime); await noLinksOrProfiles(root);
  obsoleteDirectories.push({ name, version: info.version });
}
const obsoleteArchives = [];
for (const channel of channels) {
  await noLinksOrProfiles(path.join(dist, channel.source));
  for (const file of await fs.readdir(path.join(dist, channel.source))) {
    if (/^luna-[\w.+-]+-win32-x64\.zip$/.test(file) && file !== channel.zipName) obsoleteArchives.push({ source: channel.source, file });
  }
}
console.log(JSON.stringify({ apply, before, keep: channels, removeDirectories: obsoleteDirectories, removeArchives: obsoleteArchives }, null, 2));
if (apply) {
  const running = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:LUNA_DIST_GUARD, [StringComparison]::OrdinalIgnoreCase) } | Select-Object ProcessId,Name,ExecutablePath) | ConvertTo-Json -Compress"], { encoding: 'utf8', windowsHide: true, timeout: 15000, env: { ...process.env, LUNA_DIST_GUARD: dist + path.sep } }).trim();
  if (running && running !== '[]') throw new Error('Close programs running from dist before organizing: ' + running);
  // Paths are fixed known build outputs; the validation above runs before any
  // deletion. Rename on the same volume retains the NTFS LZX compression.
  for (const channel of channels) {
    if (channel.source !== channel.channel) await fs.rename(path.join(dist, channel.source), path.join(dist, channel.channel));
    channel.directory = path.join(dist, channel.channel, 'luna-win32-x64');
    for (const obsolete of obsoleteArchives.filter(item => item.source === channel.source)) await fs.rm(path.join(dist, channel.channel, obsolete.file));
    await fs.writeFile(path.join(dist, channel.channel, 'SHA256SUMS.txt'), `${channel.zipSHA256}  ${channel.zipName}\n`);
    if ((await packageInfo(channel.directory)).asarSHA256 !== channel.asarSHA256) throw new Error(`Application archive changed during move: ${channel.channel}`);
  }
  for (const { name } of obsoleteDirectories) await fs.rm(path.join(dist, name), { recursive: true });
  const after = await diskSize(dist);
  const report = { passed: true, channels, before, after, reclaimedBytes: before.allocatedBytes - after.allocatedBytes, testedAt: new Date().toISOString() };
  await fs.mkdir(path.join(workspace, 'artifacts'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'artifacts/dist-cleanup-result.json'), JSON.stringify(report, null, 2));
  // Keep the existing functional-validation timestamp when correcting paths.
  const sizeReport = path.join(workspace, 'artifacts/package-size-result.json');
  if (await exists(sizeReport)) {
    const reports = JSON.parse(await fs.readFile(sizeReport, 'utf8'));
    for (const record of reports) {
      const channel = channels.find(channel => channel.version === record.version); if (!channel) continue;
      record.package.directory = channel.directory;
      if (record.archive) record.archive.path = path.join(dist, channel.channel, channel.zipName);
      for (const measurement of [record.compression?.before, record.compression?.after]) if (measurement) measurement.directory = channel.directory;
      if (record.baseline && !await exists(record.baseline.directory)) record.baseline.historical = true;
    }
    await fs.writeFile(sizeReport, JSON.stringify(reports, null, 2));
  }
  console.log(JSON.stringify({ passed: true, after, reclaimedMiB: +(report.reclaimedBytes / 1048576).toFixed(2) }, null, 2));
}
