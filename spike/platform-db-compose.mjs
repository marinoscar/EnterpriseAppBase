#!/usr/bin/env node
// Prototype CLI for `platform db compose` (the real one is #709).
//
//   node spike/platform-db-compose.mjs --package <dir> [--app <dir>] --out <dir> [--check]
//
// <dir> holds fragment *.prisma files (recursive). --check writes nothing and
// exits 1 when the files in --out are not byte-identical to a fresh compose
// (the CI drift check, like `npm run openapi:dump` + git diff).

import { existsSync, readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { ComposeError, compose } from './lib/compose.mjs';

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.prisma') ? [join(dir, e.name)] : []));
}

export function loadInputs({ packageDir, appDir }) {
  const mk = (dir, origin) => walk(dir).map((p) => {
    const rel = relative(dir, p).split('\\').join('/');
    return { rel, origin, source: `${origin}:${rel}`, text: readFileSync(p, 'utf8') };
  });
  return [...mk(packageDir, 'package'), ...(appDir ? mk(appDir, 'app') : [])];
}

export function composeDirs({ packageDir, appDir, outDir, check = false }) {
  const { files, extensible, extensions } = compose(loadInputs({ packageDir, appDir }));
  if (check) {
    const stale = [];
    const onDisk = existsSync(outDir) ? readdirSync(outDir).filter((f) => f.endsWith('.prisma')) : [];
    for (const [name, text] of files) {
      if (!onDisk.includes(name) || readFileSync(join(outDir, name), 'utf8') !== text) stale.push(name);
    }
    for (const f of onDisk) if (!files.has(f)) stale.push(`${f} (no longer produced)`);
    return { stale, files, extensible, extensions };
  }
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (f.endsWith('.prisma')) rmSync(join(outDir, f));
  for (const [name, text] of files) writeFileSync(join(outDir, name), text);
  return { stale: [], files, extensible, extensions };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? undefined : process.argv[i + 1]; };
  try {
    const res = composeDirs({ packageDir: arg('package'), appDir: arg('app'), outDir: arg('out'), check: process.argv.includes('--check') });
    if (res.stale.length) { console.error(`stale generated files: ${res.stale.join(', ')}\nrun: node spike/platform-db-compose.mjs ...`); process.exit(1); }
    console.log(`composed ${res.files.size} files; extensible: ${res.extensible.join(', ')}; ${res.extensions.length} extension fields`);
  } catch (e) {
    if (e instanceof ComposeError) { console.error(e.message); process.exit(2); }
    throw e;
  }
}
