#!/usr/bin/env node
// `npm run dev:packages`: rebuild the platform packages on change, alongside
// the app dev servers (run it in its own terminal).
//
// One full `build:packages` first, in dependency order (platform-contract
// first), so every dist/ exists before anything watches it; then each
// package's own `dev` script (tsc --watch) in parallel. `npm run dev -w a -w b`
// cannot do this: npm runs workspaces one after another, and a watcher never
// exits, so only the first package would ever be watched.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shell = process.platform === 'win32';
const npm = shell ? 'npm.cmd' : 'npm';

// The workspace list lives in one place: the root `build:packages` script.
const build = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts['build:packages'];
const packages = [...build.matchAll(/-w (\S+)/g)].map((m) => m[1]);

const first = spawnSync(npm, ['run', 'build:packages'], { cwd: root, stdio: 'inherit', shell });
if (first.status !== 0) process.exit(first.status ?? 1);

const watchers = packages.map((name) =>
  spawn(npm, ['run', 'dev', '-w', name], { cwd: root, stdio: 'inherit', shell }),
);
const stop = () => watchers.forEach((w) => w.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
