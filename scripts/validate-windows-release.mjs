import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const version = require('../package.json').version;
const root = path.resolve('.');
const directory = path.resolve(process.argv[2] || `dist/release/${version}/luna-win32-x64`);
const reportFile = path.join(root, `artifacts/release-${version}-validation.json`);
const report = { version, directory, running: true, passed: false, results: [], startedAt: new Date().toISOString() };
const suites = ['tab-window-smoke.js', 'workspace-smoke.js', 'features-smoke.js', 'context-menu-smoke.js', 'private-security-smoke.js', 'essentials-smoke.js', 'appearance-smoke.js', 'download-retry-ui-smoke.js', 'modal-background-smoke.js', 'ie-visibility-smoke.js', 'import-search-smoke.js', 'updates-smoke.js', 'download-delete-smoke.js', 'download-notifications-smoke.js', 'backup-pwa-smoke.js'];
async function run(script, args = []) {
  report.current = path.basename(script);
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log('Running:', report.current);
  const env = { ...process.env };
  if (['modal-background-smoke.js', 'ie-visibility-smoke.js'].includes(path.basename(script))) delete env.LUNA_EXECUTABLE;
  else env.LUNA_EXECUTABLE = path.join(directory, 'luna.exe');
  const child = spawn(process.execPath, [script, ...args], { cwd: root, env, stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  report.results.push({ suite: report.current, code, finishedAt: new Date().toISOString() });
  if (code !== 0) throw new Error(report.current + ' failed: ' + code);
}
try {
  await run(path.join(root, 'tests/runtime-smoke.js'));
  await run(path.join(root, 'tests/session-restore-smoke.js'));
  for (const suite of suites) await run(path.join(root, 'tests', suite));
  await run(path.join(root, 'scripts/verify-package.mjs'), [directory]);
  await run(path.join(root, 'scripts/test-installer-react.mjs'));
  report.passed = true;
} catch (error) {
  report.error = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  report.running = false;
  if (report.passed) delete report.current;
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
}
