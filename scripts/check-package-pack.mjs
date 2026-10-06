#!/usr/bin/env node
// Pack check for the platform packages (issue #690), run by
// .github/workflows/packages.yml after `npm run build:packages`.
//
// For each package, `npm pack --dry-run --json` lists exactly what would be
// published. The tarball must contain:
//   - every file the `exports` map, `main` and `types` point at,
//   - package.json and README.md,
// and nothing outside `files` (+ package.json, README, LICENSE, which npm
// always adds), in particular no src/, test/, *.spec.*, *.test.* or
// tsconfig*.json.
//
// Release metadata (issue #691): the tarball must also contain LICENSE (copied
// from the root by each package's `prepack`, scripts/copy-license.mjs, so the
// pack runs lifecycle scripts), and every manifest must declare
// `license: MIT`, `publishConfig.access: public`, `repository.directory` equal
// to its own folder, and must not be `private`.
//
// Usage: node scripts/check-package-pack.mjs [<package name> ...]
//        (defaults to every workspace in the root `build:packages` script)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const names =
  process.argv.length > 2
    ? process.argv.slice(2)
    : [...rootManifest.scripts['build:packages'].matchAll(/-w (\S+)/g)].map((m) => m[1]);

const FORBIDDEN = [/^src\//, /^test\//, /\.spec\.[cm]?[jt]sx?$/, /\.test\.[cm]?[jt]sx?$/, /(^|\/)tsconfig[^/]*\.json$/];
const ALWAYS = new Set(['package.json', 'README.md']);
const REQUIRED_IN_TARBALL = ['LICENSE'];
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** Every file path an exports map (any nesting of conditions) points at. */
function exportTargets(value) {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(exportTargets);
  return [];
}

const strip = (p) => p.replace(/^\.\//, '');
let failed = false;

for (const name of names) {
  // Lifecycle scripts run (no --ignore-scripts): `prepack` is what puts
  // LICENSE into the package. `--silent` keeps their banners off stdout so it
  // stays parseable JSON.
  const out = execFileSync(npm, ['pack', '--dry-run', '--json', '--silent', '-w', name], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const [report] = JSON.parse(out.slice(out.indexOf('[')));
  const files = report.files.map((f) => f.path);
  const present = new Set(files);
  const folder = `packages/${name.replace('@marinoscar/', '')}`;
  const manifest = JSON.parse(readFileSync(join(root, folder, 'package.json'), 'utf8'));
  const problems = [];

  for (const file of REQUIRED_IN_TARBALL) if (!present.has(file)) problems.push(`missing ${file}`);
  if (manifest.license !== 'MIT') problems.push(`license must be "MIT", is ${JSON.stringify(manifest.license)}`);
  if (manifest.publishConfig?.access !== 'public') problems.push('publishConfig.access must be "public"');
  if (manifest.repository?.directory !== folder) {
    problems.push(`repository.directory must be "${folder}", is ${JSON.stringify(manifest.repository?.directory)}`);
  }
  if (manifest.private === true) problems.push('must not be "private": true');

  const required = new Set([...ALWAYS, ...exportTargets(manifest.exports).map(strip)]);
  for (const field of ['main', 'module', 'types']) if (manifest[field]) required.add(strip(manifest[field]));
  for (const file of required) if (!present.has(file)) problems.push(`missing ${file}`);

  const roots = (manifest.files ?? []).map((f) => strip(f).replace(/\/$/, ''));
  for (const file of files) {
    if (FORBIDDEN.some((re) => re.test(file))) problems.push(`must not ship ${file}`);
    const allowed =
      ALWAYS.has(file) || /^LICEN[CS]E/i.test(file) || roots.some((r) => file === r || file.startsWith(`${r}/`));
    if (!allowed) problems.push(`outside "files": ${file}`);
  }

  if (problems.length > 0) {
    failed = true;
    console.error(`FAIL ${name} (${files.length} files)\n  ${problems.join('\n  ')}`);
  } else {
    console.log(`ok   ${name} (${files.length} files: ${files.join(', ')})`);
  }
}

process.exit(failed ? 1 : 0);
