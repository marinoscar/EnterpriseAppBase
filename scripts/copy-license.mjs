#!/usr/bin/env node
// `prepack` of every @marinoscar/platform-* package (issue #691): copy the
// repository's root LICENSE into the package directory so the published
// tarball ships its licence. The packages are public and MIT; a tarball
// without the licence text is not an acceptable release.
//
// The copies are build output: `.gitignore` ignores packages/platform-*/LICENSE
// so they are never committed, and the root LICENSE stays the one source.
//
// Usage (from a package directory, which is what `npm pack`/`npm publish` do
// when they run lifecycle scripts):
//   node ../../scripts/copy-license.mjs [<repo root>] [<package dir>]
// Both arguments default to the repository that holds this script and the
// current working directory; the tests pass them to run against a temp dir.
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const packageDir = resolve(process.argv[3] ?? process.cwd());
const source = join(repoRoot, 'LICENSE');

if (!existsSync(source)) {
  console.error(`Root LICENSE missing (see the governance story): expected ${source}`);
  process.exit(1);
}

copyFileSync(source, join(packageDir, 'LICENSE'));
console.log(`copied ${source} -> ${join(packageDir, 'LICENSE')}`);
