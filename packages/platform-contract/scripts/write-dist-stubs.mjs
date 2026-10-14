// Writes the two package.json stubs that make the dual build load correctly.
//
// The package itself is `"type": "module"`, so without a stub Node would read
// every .js file under dist/cjs as ESM and `require('@marinoscar/platform-contract')`
// would fail on the first `exports.x =`. A nested package.json is the
// documented way to switch the module format for one directory. dist/esm gets
// an explicit stub too, so the format of each half never depends on the
// package root.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

for (const [dir, type] of [
  ['cjs', 'commonjs'],
  ['esm', 'module'],
]) {
  mkdirSync(join(dist, dir), { recursive: true });
  writeFileSync(join(dist, dir, 'package.json'), `${JSON.stringify({ type }, null, 2)}\n`);
}
