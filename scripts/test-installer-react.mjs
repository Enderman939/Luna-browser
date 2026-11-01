import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');
const root = path.resolve('.'), version = require('../package.json').version;
const release = path.join(root, 'dist', version.includes('-') ? 'beta' : 'release');
const outputRoot = [path.join(release, version, 'installer'), path.join(release, 'installer'), path.join(release, version), release].find(directory => existsSync(path.join(directory, `Luna-Setup-${version}-win32-x64.exe`)));
if (!outputRoot) throw new Error('Build the Luna installer before running this smoke test.');
const sfx = path.join(outputRoot, `Luna-Setup-${version}-win32-x64.exe`);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'luna-installer-test-'));
try {
  const bootstrap = spawnSync(process.execPath, [path.join(root, 'tests', 'installer-bootstrap-smoke.js'), sfx], { cwd: root, stdio: 'inherit', timeout: 60000 });
  if (bootstrap.status !== 0) throw new Error('Single-file installer bootstrap smoke test failed.');
  const bytes = await fs.readFile(sfx), footer = bytes.subarray(-16);
  if (footer.subarray(8).toString('ascii') !== 'LUNAZIP1') throw new Error('Invalid Luna installer footer.');
  const length = Number(footer.readBigInt64LE());
  if (length <= 0 || length > bytes.length - 16) throw new Error('Invalid Luna installer payload length.');
  await fs.writeFile(path.join(temp, 'installer-app.zip'), bytes.subarray(bytes.length - 16 - length, bytes.length - 16));
  const appRuntime = path.join(temp, 'runtime'); await fs.mkdir(appRuntime);
  new AdmZip(path.join(temp, 'installer-app.zip')).extractAllTo(appRuntime, true);
  const env = { ...process.env, LUNA_SETUP_RUNTIME: appRuntime };
  const result = spawnSync(process.execPath, [path.join(root, 'tests', 'installer-react-smoke.js')], { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 15 * 60 * 1000, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'React installer smoke test failed.');
  const reportPath = path.join(root, 'artifacts', 'installer-result.json');
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  const sha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
  if (report.sha256 !== sha256) throw new Error('Tested executable does not match the build report.');
  report.checks = ['final executable bootstrap', 'temporary runtime cleanup', 'silent install with Unicode/spaces/ampersand path', 'React UI and Amicro motion', 'reduced motion', 'occupied-folder rejection', 'installation across volumes', 'responsive installation and close protection', 'browser launch', 'running-browser upgrade rejection', 'failed upgrade rollback', 'upgrade preserving personal files', 'shortcuts', 'Windows uninstall registration in isolated key', 'uninstall preserving personal files', 'real registry unchanged by isolated tests'];
  report.testedAt = new Date().toISOString();
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
} finally { await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
