import { packager } from '@electron/packager';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { compactPackage, diskSize } from './compact-package.mjs';
import { measurePackage } from './package-size.mjs';
const require = createRequire(import.meta.url);
const { values } = parseArgs({ options: {
  out: { type: 'string' },
  channel: { type: 'string' },
  compact: { type: 'boolean', default: false },
  zip: { type: 'boolean', default: false },
  'all-locales': { type: 'boolean', default: false },
} });
const version = require('../package.json').version;
const versionChannel = version.includes('-') ? 'beta' : 'release';
const channel = values.channel || versionChannel;
if (!['release', 'beta'].includes(channel) || channel !== versionChannel) throw new Error('正式版须使用稳定版本号；Beta 须使用预发布版本号。请先调整 package.json 的版本。');
const out = values.out || `dist/${channel}`;
for (const knownChannel of ['release', 'beta']) {
  if (path.resolve(out) === path.resolve('dist', knownChannel) && knownChannel !== channel) throw new Error('版本类型与输出目录不一致');
}
const baselineDirectory = path.resolve('dist/release/luna-win32-x64');
let baseline = null;
if (await fs.access(path.join(baselineDirectory, 'luna.exe')).then(() => true, () => false)) {
  baseline = {
    ...measurePackage(baselineDirectory),
    ...(process.platform === 'win32' ? await diskSize(baselineDirectory) : {}),
  };
}
const locales = new Set(['en-US.pak', 'zh-CN.pak', 'zh-TW.pak']);

async function trimRuntime({ buildPath }) {
  if (values['all-locales']) return;
  const directory = path.join(buildPath, 'locales');
  for (const file of await fs.readdir(directory)) {
    if (file.endsWith('.pak') && !locales.has(file)) await fs.rm(path.join(directory, file));
  }
}

async function trimDependencies({ buildPath }) {
  const modules = path.join(buildPath, 'node_modules');
  await fs.rm(path.join(modules, '@types'), { recursive: true, force: true });
  await fs.rm(path.join(modules, '.package-lock.json'), { force: true });
  // pngjs' Node entry uses lib/. Its coverage report and prebundled browser
  // distribution are not used by qrcode's Node PNG renderer.
  for (const file of ['pngjs/coverage', 'pngjs/browser.js']) {
    await fs.rm(path.join(modules, file), { recursive: true, force: true });
  }
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (/\.(?:map|d\.ts)$/.test(entry.name) || /^(?:readme|changelog|history)(?:\.[\w-]+)?$/i.test(entry.name) || /^\.(?:eslint|prettier)/.test(entry.name)) {
        await fs.rm(file);
      }
    }
  }
  await walk(modules);
}
// The pinned Electron npm package ships its release checksums. Supplying them
// verifies the cached runtime without fetching a fresh checksum file on every build.
const checksums = require('electron/checksums.json');
const output = await packager({
  dir: '.', name: 'luna', platform: 'win32', arch: 'x64',
  icon: 'src/ui/assets/app.ico', out, overwrite: true, asar: true, prune: true,
  download: { checksums },
  extraResource: ['src/native/luna-ie-host.exe', 'src/native/luna-private-cleanup.exe', 'src/native/luna-browser-import.exe'],
  afterExtract: [trimRuntime],
  afterPrune: [trimDependencies],
  ignore: [/^\/tests/, /^\/scripts/, /^\/docs/, /^\/artifacts/, /^\/dist/, /^\/package-lock\.json$/, /^\/README\.md$/, /^\/\.gitignore$/, /^\/start\.cmd$/, /^\/src\/native(?:\/|$)/,
    /^\/src\/ui\/assets\/[^/]+\.aip$/i, /^\/src\/ui\/assets\/Luna-(?:SetupFiles|cache)(?:\/|$)/i],
});
console.log('Built:', output.join(', '));
const reports = [];
for (const directory of output) {
  const packageSize = measurePackage(directory);
  const compression = values.compact ? await compactPackage(directory) : null;
  let archive = null;
  if (values.zip || !values.out) {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    zip.addLocalFolder(directory, path.basename(directory));
    const file = path.join(path.dirname(directory), `luna-${version}-win32-x64.zip`);
    console.log(`Creating ZIP: ${file}`);
    const temporary = file + '.tmp';
    await zip.writeZipPromise(temporary);
    if (!new AdmZip(temporary).test()) throw new Error('ZIP 校验失败，旧的压缩包已保留');
    await fs.rename(temporary, file);
    const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk);
    await fs.writeFile(path.join(path.dirname(directory), 'SHA256SUMS.txt'), hash.digest('hex') + '  ' + path.basename(file) + '\n');
    // Only prune recognized old archives after the new ZIP passed its CRC check.
    for (const name of await fs.readdir(path.dirname(directory))) {
      if (/^luna-[\w.+-]+-win32-x64\.zip$/.test(name) && name !== path.basename(file)) await fs.rm(path.join(path.dirname(directory), name));
    }
    archive = { path: path.resolve(file), bytes: (await fs.stat(file)).size };
  }
  reports.push({ version, baseline, package: packageSize, compression, archive, testedAt: new Date().toISOString() });
}
await fs.mkdir('artifacts', { recursive: true });
await fs.writeFile('artifacts/package-size-result.json', JSON.stringify(reports, null, 2));
