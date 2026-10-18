import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import * as asar from '@electron/asar';
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('macOS arm64 is required');
const require = createRequire(import.meta.url), report = JSON.parse(fs.readFileSync('artifacts/macos-package-result.json', 'utf8'));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-mac-archive-'));
try {
  const zip = new (require('adm-zip'))(report.zip); assert.equal(zip.test(), true);
  execFileSync('/usr/bin/ditto', ['-x', '-k', report.zip, directory]);
  const app = path.join(directory, 'luna.app'), contents = path.join(app, 'Contents'), archive = path.join(contents, 'Resources/app.asar');
  const plist = require('plist').parse(fs.readFileSync(path.join(contents, 'Info.plist'), 'utf8'));
  assert.equal(plist.CFBundleIdentifier, 'com.enderman939.luna'); assert.equal(plist.CFBundleShortVersionString, report.version);
  assert.equal(execFileSync('/usr/bin/lipo', ['-archs', path.join(contents, 'MacOS/luna')], { encoding: 'utf8' }).trim(), 'arm64');
  assert.ok(fs.statSync(path.join(contents, 'MacOS/luna')).mode & 0o111);
  assert.ok(fs.lstatSync(path.join(contents, 'Frameworks/Electron Framework.framework/Versions/Current')).isSymbolicLink());
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  assert.deepEqual(fs.readFileSync(archive), fs.readFileSync(path.join(report.app, 'Contents/Resources/app.asar')));
  const files = asar.listPackage(archive).map(file => file.replaceAll('\\', '/'));
  for (const file of ['/LICENSE', '/THIRD_PARTY_NOTICES.md', '/src/local-files.js', '/node_modules/electron-chrome-extensions/LICENSE-GPL']) assert.ok(files.includes(file));
  assert.equal(files.some(file => /^\/(?:\.github|tests|scripts|artifacts|src\/native)\//.test(file)), false);
  assert.equal(files.some(file => /^\/session-[^/]+\.md$/.test(file)), false);
  const sums = fs.readFileSync(path.join(path.dirname(report.zip), 'SHA256SUMS-macos-arm64.txt'), 'utf8');
  for (const file of [report.zip, report.dmg]) assert.ok(sums.includes(createHash('sha256').update(fs.readFileSync(file)).digest('hex') + '  ' + path.basename(file)));
  for (const file of ['macos-smoke-result.json', 'features-result.json', 'import-search-result.json', 'private-security-result.json']) {
    const result = JSON.parse(fs.readFileSync(path.join('artifacts', file), 'utf8')); assert.equal(result.passed, true); if (result.version) assert.equal(result.version, report.version);
    assert.ok(Date.parse(result.testedAt) >= Date.parse(report.testedAt));
  }
  const validation = { passed: true, version: report.version, platform: 'darwin', arch: 'arm64', signing: 'ad-hoc', notarized: false,
    checks: ['ZIP CRC and DMG integrity', 'extracted executable permissions and framework symlinks', 'arm64 Mach-O and bundle identity', 'deep signature verification', 'ASAR and license files', 'packaged app smoke tests and SHA256 files'], testedAt: new Date().toISOString() };
  fs.writeFileSync('artifacts/macos-validation-result.json', JSON.stringify(validation, null, 2)); console.log(JSON.stringify(validation, null, 2));
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
