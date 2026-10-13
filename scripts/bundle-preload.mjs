import { build } from 'esbuild';
await build({ entryPoints: ['src/preload.js'], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: 'src/preload.bundle.js', logLevel: 'warning' });
