// `npm run dev` for the dual build: one full build (so both dist/ halves and
// their package.json stubs exist), then a tsc watcher per half. Two watchers
// rather than a shell `&` so it behaves the same on Windows (scripts/dev.ps1).
import { spawn, spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const first = spawnSync(npm, ['run', 'build'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (first.status !== 0) process.exit(first.status ?? 1);

const tsc = process.platform === 'win32' ? 'tsc.cmd' : 'tsc';
const watchers = ['tsconfig.cjs.json', 'tsconfig.esm.json'].map((project) =>
  spawn(tsc, ['-p', project, '--watch', '--preserveWatchOutput'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }),
);
const stop = () => watchers.forEach((w) => w.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
