import fs from 'node:fs';
import path from 'node:path';
import * as asar from '@electron/asar';
import { fileURLToPath } from 'node:url';

export function measurePackage(directory) {
  const root = path.resolve(directory);
  const files = [];
  function measure(directory) {
    let total = 0;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const bytes = entry.isDirectory() ? measure(file) : fs.statSync(file).size;
      total += bytes;
      if (directory === root || directory === path.join(root, 'resources')) {
        files.push({ path: path.relative(root, file), bytes });
      }
    }
    return total;
  }
  const totalBytes = measure(root);
  const archive = path.join(root, 'resources/app.asar');
  const groups = new Map();
  for (const file of asar.listPackage(archive)) {
    const relative = file.replace(/^[\\/]/, '');
    const item = asar.statFile(archive, relative);
    if (item.files) continue;
    const parts = file.replaceAll('\\', '/').replace(/^\//, '').split('/');
    const group = parts[0] === 'node_modules'
      ? parts.slice(0, parts[1]?.startsWith('@') ? 3 : 2).join('/')
      : parts[0];
    groups.set(group, (groups.get(group) || 0) + (item.size || 0));
  }
  const withSize = (item) => ({ ...item, MiB: +(item.bytes / 1048576).toFixed(2) });
  return {
    directory: root,
    totalBytes,
    totalMiB: +(totalBytes / 1048576).toFixed(2),
    files: files.sort((a, b) => b.bytes - a.bytes).map(withSize),
    archiveGroups: [...groups].map(([name, bytes]) => ({ name, bytes }))
      .sort((a, b) => b.bytes - a.bytes).map(withSize),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const metadata = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const channel = metadata.version.includes('-') ? 'beta' : 'release';
  let directory = process.argv[2];
  if (!directory) {
    const channelRoot = path.resolve('dist', channel);
    const direct = path.join(channelRoot, 'luna-win32-x64');
    if (fs.existsSync(direct)) directory = direct;
    else {
      const candidates = fs.readdirSync(channelRoot, { withFileTypes: true }).filter(entry => entry.isDirectory() && fs.existsSync(path.join(channelRoot, entry.name, 'luna-win32-x64'))).map(entry => entry.name).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      if (!candidates.length) throw new Error('找不到 Windows x64 成品目录，请先运行构建');
      directory = path.join(channelRoot, candidates[0], 'luna-win32-x64');
    }
  }
  console.log(JSON.stringify(measurePackage(directory), null, 2));
}
