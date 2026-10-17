import { packager } from '@electron/packager';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { packageIgnore, trimDependencies } from './package-common.mjs';

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Apple Silicon 成品须在 macOS arm64 构建，以保留符号链接、可执行权限和有效代码签名。可运行 GitHub Actions 的 Build macOS arm64。');
const require = createRequire(import.meta.url), metadata = require('../package.json');
const channel = metadata.version.includes('-') ? 'beta' : 'release';
const out = path.resolve('dist', channel), assets = path.resolve('artifacts/macos-icon');
await fs.mkdir(assets, { recursive: true });
execFileSync(require('electron'), ['scripts/create-icon.js'], { stdio: 'inherit' });
const iconset = path.join(assets, 'luna.iconset'); await fs.mkdir(iconset, { recursive: true });
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) execFileSync('/usr/bin/sips', ['-z', String(size * scale), String(size * scale), 'src/ui/assets/app.png', '--out', path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)], { stdio: 'ignore' });
}
const icon = path.join(assets, 'luna.icns');
execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', icon]);
const output = await packager({
  dir: '.', name: 'luna', platform: 'darwin', arch: 'arm64', out, overwrite: true, asar: true, prune: true,
  icon, appBundleId: 'com.enderman939.luna', appCategoryType: 'public.app-category.productivity', darwinDarkModeSupport: true,
  download: { checksums: require('electron/checksums.json') },
  protocols: [{ name: 'Web URL', schemes: ['http', 'https'] }],
  extendInfo: {
    CFBundleDocumentTypes: [{ CFBundleTypeName: 'HTML document', CFBundleTypeRole: 'Viewer', LSHandlerRank: 'Alternate', LSItemContentTypes: ['public.html', 'public.xhtml'] }],
  },
  usageDescription: { Camera: '仅向你明确授权的网站提供摄像头。', Microphone: '仅向你明确授权的网站提供麦克风。', LocationWhenInUse: '仅向你明确授权的网站提供位置。', Location: '仅向你明确授权的网站提供位置。' },
  osxSign: { identity: '-', identityValidation: false, preAutoEntitlements: false, preEmbedProvisioningProfile: false, continueOnError: false,
    optionsForFile: () => ({ hardenedRuntime: false, timestamp: 'none' }) },
  afterPrune: [trimDependencies], ignore: packageIgnore,
});
const app = path.join(output[0], 'luna.app');
const info = require('plist').parse(await fs.readFile(path.join(app, 'Contents/Info.plist'), 'utf8'));
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
const stem = `luna-${metadata.version}-darwin-arm64`, zip = path.join(out, stem + '.zip');
execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip + '.tmp']);
const AdmZip = require('adm-zip'); if (!new AdmZip(zip + '.tmp').test()) throw new Error('macOS ZIP CRC failed');
await fs.rename(zip + '.tmp', zip);
const dmgStage = path.resolve('artifacts/macos-dmg'); await fs.rm(dmgStage, { recursive: true, force: true }); await fs.mkdir(dmgStage, { recursive: true });
execFileSync('/usr/bin/ditto', [app, path.join(dmgStage, 'luna.app')]);
await fs.symlink('/Applications', path.join(dmgStage, 'Applications'));
const dmg = path.join(out, stem + '.dmg');
execFileSync('/usr/bin/hdiutil', ['create', '-volname', 'luna', '-srcfolder', dmgStage, '-ov', '-format', 'UDZO', dmg + '.tmp.dmg'], { stdio: 'inherit' });
execFileSync('/usr/bin/hdiutil', ['verify', dmg + '.tmp.dmg'], { stdio: 'inherit' });
await fs.rename(dmg + '.tmp.dmg', dmg);
const sums = [];
for (const file of [zip, dmg]) { const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); sums.push(hash.digest('hex') + '  ' + path.basename(file)); }
await fs.writeFile(path.join(out, 'SHA256SUMS-macos-arm64.txt'), sums.join('\n') + '\n');
await fs.writeFile('artifacts/macos-package-result.json', JSON.stringify({ version: metadata.version, electron: metadata.devDependencies.electron, platform: 'darwin', arch: 'arm64', minimumMacOS: info.LSMinimumSystemVersion, app, zip, dmg, signing: 'ad-hoc', notarized: false, testedAt: new Date().toISOString() }, null, 2));
console.log('Built Apple Silicon app, ZIP and DMG:', zip, dmg);
