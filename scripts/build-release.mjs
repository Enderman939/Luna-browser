import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');
if (version.includes('-')) throw new Error('build:release requires a stable version.');
const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
if (!fs.existsSync(npmCli)) throw new Error('Could not find the npm CLI to build the release.');
const result = spawnSync(process.execPath, [npmCli, 'run', 'build', '--', '--channel=release', '--compact', '--zip', `--out=dist/release/${version}`], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
const installer = spawnSync(process.execPath, [npmCli, 'run', 'build:installer'], { stdio: 'inherit' });
if (installer.status !== 0) process.exit(installer.status || 1);
