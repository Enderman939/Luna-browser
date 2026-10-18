import fs from 'node:fs/promises';
import path from 'node:path';

export const packageIgnore = [/^\/tests/, /^\/scripts/, /^\/docs/, /^\/artifacts/, /^\/dist/, /^\/\.github(?:\/|$)/,
  /^\/package-lock\.json$/, /^\/README\.md$/, /^\/session-[^/]+\.md$/, /^\/\.gitignore$/, /^\/start\.cmd$/, /^\/src\/native(?:\/|$)/,
  /^\/src\/ui\/assets\/[^/]+\.aip$/i, /^\/src\/ui\/assets\/Luna-(?:SetupFiles|cache)(?:\/|$)/i];

export async function trimDependencies({ buildPath }) {
  const modules = path.join(buildPath, 'node_modules');
  await fs.rm(path.join(modules, '@types'), { recursive: true, force: true });
  await fs.rm(path.join(modules, '.package-lock.json'), { force: true });
  for (const file of ['pngjs/coverage', 'pngjs/browser.js']) await fs.rm(path.join(modules, file), { recursive: true, force: true });
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (/\.(?:map|d\.ts)$/.test(entry.name) || /^(?:readme|changelog|history)(?:\.[\w-]+)?$/i.test(entry.name) || /^\.(?:eslint|prettier)/.test(entry.name)) await fs.rm(file);
    }
  }
  await walk(modules);
}
