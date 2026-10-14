import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as asar from '@electron/asar';
import { measurePackage } from './package-size.mjs';
import { diskSize } from './compact-package.mjs';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');
const channel = require('../package.json').version.includes('-') ? 'beta' : 'release';
const directory = path.resolve(process.argv[2] || `dist/${channel}/luna-win32-x64`);
const archive = path.join(directory, 'resources/app.asar');
const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString());
const packageFiles = asar.listPackage(archive).map(file => file.replaceAll('\\', '/'));
// The first public release is numbered 1.0.0. Check shipped capabilities so
// renumbering a release cannot silently skip its integration checks.
const privateSupported = packageFiles.includes('/src/private-protection.js');
const essentialsSupported = packageFiles.includes('/src/site-permissions.js');
const modalSupported = packageFiles.includes('/src/modal-layer.js');
const importSupported = packageFiles.includes('/src/browser-import.js');
const zipFile = path.join(path.dirname(directory), `luna-${metadata.version}-win32-x64.zip`);
const zip = new AdmZip(zipFile);
assert.equal(zip.test(), true, 'ZIP CRC checks pass for every entry');
const prefix = path.basename(directory) + '/';
const entries = new Set(zip.getEntries().map(entry => entry.entryName));
const required = ['luna.exe', 'resources/app.asar', 'resources/luna-ie-host.exe',
  'LICENSE', 'LICENSES.chromium.html', 'ffmpeg.dll', 'dxcompiler.dll', 'dxil.dll',
  'd3dcompiler_47.dll', 'vk_swiftshader.dll', 'vk_swiftshader_icd.json',
  'vulkan-1.dll', 'icudtl.dat', 'resources.pak', 'v8_context_snapshot.bin',
  'snapshot_blob.bin', 'locales/en-US.pak', 'locales/zh-CN.pak', 'locales/zh-TW.pak'];
if (privateSupported) required.push('resources/luna-private-cleanup.exe');
if (importSupported) required.push('resources/luna-browser-import.exe');
for (const file of required) assert.ok(entries.has(prefix + file), `ZIP includes ${file}`);
assert.deepEqual(zip.getEntry(prefix + 'resources/app.asar').getData(), fs.readFileSync(archive), 'ZIP contains the tested application archive');
assert.ok(packageFiles.includes('/LICENSE'), 'application GPL license is retained');
assert.ok(packageFiles.includes('/node_modules/electron-chrome-extensions/LICENSE-GPL'), 'GPL license is retained');
assert.ok(packageFiles.includes('/THIRD_PARTY_NOTICES.md'), 'third-party notices are retained');
assert.equal(packageFiles.some(file => file.startsWith('/node_modules/@types/')), false, 'development-only type packages are excluded');
assert.equal(packageFiles.some(file => /\/assets\/[^/]+\.aip$|\/assets\/Luna-(?:SetupFiles|cache)(?:\/|$)/i.test(file)), false, 'installer projects, outputs and caches are excluded');
const visibility = JSON.parse(fs.readFileSync('artifacts/ie-visibility-result.json', 'utf8'));
assert.equal(visibility.version, metadata.version);
assert.equal(visibility.passed, true);
assert.equal(visibility.defaultGPU.gpu_compositing, 'enabled');
const resultFile = 'artifacts/package-size-result.json';
const reports = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
const report = reports.find(report => report.version === metadata.version);
assert.ok(report, 'the package has a size report');
for (const file of ['features-result.json', 'context-result.json']) {
  const result = JSON.parse(fs.readFileSync(path.join('artifacts', file), 'utf8'));
  assert.equal(result.passed, true, `${file} passed`);
  assert.ok(Date.parse(result.testedAt) >= Date.parse(report.testedAt), `${file} was run after packaging`);
}
if (privateSupported) {
  const result = JSON.parse(fs.readFileSync('artifacts/private-security-result.json', 'utf8'));
  assert.equal(result.passed, true);
  assert.equal(result.version, metadata.version);
  assert.ok(Date.parse(result.testedAt) >= Date.parse(report.testedAt), 'private security was checked after packaging');
}
if (essentialsSupported) {
  const result = JSON.parse(fs.readFileSync('artifacts/essentials-result.json', 'utf8'));
  assert.equal(result.passed, true); assert.equal(result.version, metadata.version);
  assert.ok(Date.parse(result.testedAt) >= Date.parse(report.testedAt), 'browser essentials were checked after packaging');
}
if (modalSupported) {
  const result = JSON.parse(fs.readFileSync('artifacts/modal-background-result.json', 'utf8'));
  assert.equal(result.passed, true); assert.equal(result.version, metadata.version); assert.equal(result.defaultGPU.gpu_compositing, 'enabled');
  assert.ok(Date.parse(result.testedAt) >= Date.parse(report.testedAt), 'live dialog backgrounds were checked after packaging');
}
if (importSupported) {
  const result = JSON.parse(fs.readFileSync('artifacts/import-search-result.json', 'utf8'));
  assert.equal(result.passed, true); assert.equal(result.version, metadata.version);
  assert.ok(Date.parse(result.testedAt) >= Date.parse(report.testedAt), 'import, search and file deletion were checked after packaging');
}
assert.ok(Date.parse(visibility.testedAt) >= Date.parse(report.testedAt), 'IE visibility was checked after packaging');
if (report.baseline && path.resolve(report.baseline.directory) !== directory && fs.existsSync(path.join(report.baseline.directory, 'resources/app.asar'))) {
  report.baseline = { ...measurePackage(report.baseline.directory), ...await diskSize(report.baseline.directory) };
} else if (report.baseline) report.baseline.historical = true;
report.package = measurePackage(directory);
for (const measurement of [report.compression?.before, report.compression?.after].filter(Boolean)) {
  if ('files' in measurement) { measurement.fileCount = measurement.files; delete measurement.files; }
}
const currentDisk = await diskSize(directory);
if (report.compression) report.compression.after = currentDisk;
report.disk = currentDisk;
report.validation = {
  passed: true,
  checks: ['ZIP CRCs and runtime resources', 'application archive matches ZIP', 'licenses retained',
    'extensions and download integration', 'QR PNG and reading/page tools', 'default GPU and real desktop IE visibility'],
  artifacts: ['features-result.json', 'context-result.json', 'ie-visibility-result.json'],
  testedAt: new Date().toISOString(),
};
if (privateSupported) {
  report.validation.checks.push('private extension authorization and isolation; actual advertising/tracker requests blocked; temporary-data cleanup');
  report.validation.artifacts.push('private-security-result.json');
}
if (essentialsSupported) { report.validation.checks.push('website authorization, tab/view transfers, bookmark HTML migration, external URL dispatch and isolated Windows registration'); report.validation.artifacts.push('essentials-result.json'); }
if (modalSupported) { report.validation.checks.push('real desktop live Chromium/IE backgrounds below modal dialogs, click isolation and nested form input'); report.validation.artifacts.push('modal-background-result.json'); }
if (importSupported) { report.validation.checks.push('read-only browser import, DPAPI/AES-GCM password migration, search-first suggestions and confirmed recycle-bin deletion'); report.validation.artifacts.push('import-search-result.json'); }
fs.writeFileSync(resultFile, JSON.stringify(reports, null, 2));
console.log(JSON.stringify({
  version: metadata.version,
  logicalMiB: report.package.totalMiB,
  diskMiB: +(currentDisk.allocatedBytes / 1048576).toFixed(2),
  zipMiB: +(fs.statSync(zipFile).size / 1048576).toFixed(2),
  diskReductionPercent: report.baseline?.allocatedBytes ? +((1 - currentDisk.allocatedBytes / report.baseline.allocatedBytes) * 100).toFixed(1) : null,
  baselineHistorical: report.baseline?.historical === true,
  passed: true,
}, null, 2));
