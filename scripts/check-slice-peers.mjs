#!/usr/bin/env node
// Slice peer-dependency check (issue #914), run by the `package-docs` job in
// .github/workflows/packages.yml and by `npm run check:slice-peers`.
//
// WHY
// -----------------------------------------------------------------------------
// A platform package is ONE npm package whose slices are subpath exports, so
// its `peerDependencies` are the union of what every slice needs. A project
// that wants only `otel-core` and `telemetry` must not have to install
// NestJS's JWT module, Passport and Prisma for slices it never imports.
// Therefore:
//   - every slice declares the peers it imports DIRECTLY
//     (packages/platform-slice-peers.json, beside the slice graph);
//   - only the peers the universal slices ("$universal": core and friends)
//     need, directly or through their slice dependencies, are required;
//     every other peer is `optional` in `peerDependenciesMeta`.
//
// THE RULES (each failure names the package, slice, file and specifier)
// -----------------------------------------------------------------------------
// 1. coverage     A non-test file's bare import is covered by the slice's
//                 declared peers, the declared peers of its slice dependencies
//                 (packages/platform-slices.json, transitively), a node
//                 builtin, the package's own `dependencies`, or the package
//                 itself. Anything else fails.
// 2. unknown      A declared entry must be a `peerDependencies` key of the
//                 package; a slice directory with no entry fails.
// 3. stale        A declared entry the slice does not import directly fails
//                 (the list is the slice's direct needs, not a wish list).
// 4. orphan       A `peerDependencies` key that no slice declares, or implies,
//                 fails.
// 5. optionality  A peer is required (not `optional`) exactly when a
//                 universal slice needs it (effective set). A peer needed only
//                 by other slices must be `optional`; a universal one must not.
//
// Three refinements keep the data honest rather than long:
//   - `$implies`: a peer of a peer (`@nestjs/common` needs `reflect-metadata`
//     and `rxjs`; `nestjs-zod` needs `zod`). Declaring the outer peer covers
//     the inner one, so a slice does not list what it never imports.
//   - `$runtime`: a peer loaded by name at run time (`createRequire(...)('pg')`)
//     is invisible to an import scan; it is declared here per slice and must
//     still appear as a string literal in the slice's sources.
//   - `<slice>/testing`: the files under `src/<slice>/testing/` are the
//     slice's separate `./<slice>/testing` entry point (conformance suites,
//     test helpers). They are scanned as the sub-slice `<slice>/testing`, which
//     inherits its slice, so a test runner never becomes a peer of the slice.
//
// "Non-test" = not under `__tests__`, `__fixtures__`, `test` or `tests`, not
// `*.spec.*` / `*.test.*`, not a `.d.ts`. A `testing/` folder is published
// source (the conformance harnesses) and IS scanned.
//
// Usage: node scripts/check-slice-peers.mjs [--root <dir>] [--derive] [--table]
//   --derive   print each slice's direct peers as JSON (to start or refresh
//              packages/platform-slice-peers.json) and exit 0.
//   --table    print each slice's effective peers (own + inherited) as Markdown.
// Exit:  0 clean, 1 violations, 2 usage error.
//
// Uses the `typescript` scanner (a root devDependency) so comments and
// template strings never yield a false import; otherwise Node built-ins only.
// Importing this module runs nothing: `main()` is behind `isDirectExecution`,
// so apps/cli/src/slice-peers-script.test.ts imports the functions directly
// (same pattern as check-single-instance.mjs).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '..');

const SOURCE_EXT = /\.(?:ts|tsx|mts|cts|mjs|cjs|js|jsx)$/;
const TEST_DIRS = new Set(['__tests__', '__fixtures__', 'test', 'tests', 'node_modules', 'dist']);
const TEST_FILE = /\.(?:spec|test)\.[cm]?[jt]sx?$/;
const BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, '').split('/')[0]));

/** Reads a JSON file. */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * The npm package name of a bare specifier: `@scope/name/sub` -> `@scope/name`,
 * `name/sub` -> `name`. Returns `null` for a relative or absolute path and for
 * a node builtin (`node:fs`, `fs`, `fs/promises`).
 */
export function packageOfSpecifier(spec) {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('#')) return null;
  if (spec.startsWith('node:')) return null;
  const parts = spec.split('/');
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  if (!spec.startsWith('@') && BUILTINS.has(name)) return null;
  return name;
}

/** Is this path (relative to the package `src/`) a test or fixture file? */
export function isTestPath(relPath) {
  const segments = relPath.split(/[\\/]/);
  const file = segments[segments.length - 1];
  if (file.endsWith('.d.ts') || TEST_FILE.test(file)) return true;
  return segments.slice(0, -1).some((s) => TEST_DIRS.has(s));
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!TEST_DIRS.has(entry.name)) walk(full, out);
    } else if (entry.isFile() && SOURCE_EXT.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

let tsCache;
function loadTypeScript(root) {
  if (tsCache) return tsCache;
  const require = createRequire(join(root, 'package.json'));
  try {
    tsCache = require('typescript');
  } catch {
    tsCache = createRequire(import.meta.url)('typescript');
  }
  return tsCache;
}

/** Bare specifiers a source text imports, requires or re-exports (type-only included). */
export function importedSpecifiers(text, root = DEFAULT_ROOT) {
  const ts = loadTypeScript(root);
  const info = ts.preProcessFile(text, true, true);
  return info.importedFiles.map((f) => f.fileName);
}

/**
 * Every non-test source file of a package, grouped by slice:
 * `{ slice: { file(relative to the repo root): { names: Set<package name>, text } } }`.
 * Files directly under `src/` belong to the pseudo-slice `.` (the package root);
 * files under `src/<slice>/testing/` to the sub-slice `<slice>/testing`.
 */
export function scanPackage(root, pkgDir) {
  const src = join(pkgDir, 'src');
  const slices = {};
  if (!existsSync(src)) return slices;
  for (const file of walk(src)) {
    const rel = relative(src, file);
    if (isTestPath(rel)) continue;
    const segments = rel.split(sep);
    const slice =
      segments.length === 1 ? '.' : segments.length > 2 && segments[1] === 'testing' ? `${segments[0]}/testing` : segments[0];
    const text = readFileSync(file, 'utf8');
    const names = new Set();
    for (const spec of importedSpecifiers(text, root)) {
      const name = packageOfSpecifier(spec);
      if (name) names.add(name);
    }
    (slices[slice] ??= {})[relative(root, file).split(sep).join('/')] = { names, text };
  }
  return slices;
}

/** The names plus everything they imply (`$implies`), transitively. */
export function closeOver(names, implies = {}) {
  const out = new Set(names);
  const queue = [...out];
  while (queue.length > 0) {
    for (const next of implies[queue.pop()] ?? []) {
      if (!out.has(next)) {
        out.add(next);
        queue.push(next);
      }
    }
  }
  return out;
}

/**
 * The peers a slice needs: its declared and run-time peers plus those of its
 * slice dependencies, transitively, closed over `implies`. A `<slice>/testing`
 * sub-slice depends on its slice.
 */
export function effectivePeers(slice, graph, declared, implies = {}, runtime = {}) {
  const names = new Set();
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const peer of declared[name] ?? []) names.add(peer);
    for (const peer of runtime[name] ?? []) names.add(peer);
    if (name.endsWith('/testing')) visit(name.slice(0, -'/testing'.length));
    for (const dep of graph[name] ?? []) visit(dep);
  };
  visit(slice);
  return closeOver(names, implies);
}

/** The universal slices of a package (`"*"` means every slice of the graph). */
export function universalSlices(pkg, universal, graph) {
  const entry = universal?.[pkg];
  if (entry === '*') return Object.keys(graph);
  return entry ?? [];
}

/** The string-literal test behind `$runtime`: does the slice's source name the package in quotes? */
function mentionsPackage(files, name) {
  return Object.values(files).some((entry) => entry.text.includes(`'${name}'`) || entry.text.includes(`'${name}/`) || entry.text.includes(`"${name}"`) || entry.text.includes(`"${name}/`));
}

/**
 * Checks one package. Returns `{ violations: [{ rule, pkg, slice, file, specifier, message }], derived, required }`
 * where `derived` is each slice's direct imports that are `peerDependencies` of the package.
 */
export function checkPackage({ root, pkg, pkgDir, graph, declared, universal, implies = {}, runtime = {} }) {
  const manifest = readJson(join(pkgDir, 'package.json'));
  const peers = manifest.peerDependencies ?? {};
  const optional = new Set(
    Object.entries(manifest.peerDependenciesMeta ?? {})
      .filter(([, v]) => v?.optional)
      .map(([k]) => k),
  );
  const dependencies = new Set(Object.keys(manifest.dependencies ?? {}));
  const scanned = scanPackage(root, pkgDir);
  const violations = [];
  const derived = {};
  const add = (rule, slice, file, specifier, message) =>
    violations.push({ rule, pkg, slice, file, specifier, message: `${pkg}: slice '${slice}'${file ? ` ${file}` : ''}${specifier ? ` '${specifier}'` : ''}: ${message}` });

  // `<slice>/testing` sub-slices exist where files do; each inherits its slice.
  const fullGraph = { ...graph };
  for (const name of Object.keys(scanned)) {
    if (name.endsWith('/testing')) fullGraph[name] = [];
  }
  const eff = (slice) => effectivePeers(slice, fullGraph, declared, implies, runtime);

  for (const slice of Object.keys(scanned)) {
    if (slice === '.') continue;
    const parent = slice.endsWith('/testing') ? slice.slice(0, -'/testing'.length) : slice;
    if (!(parent in graph)) {
      add('unknown', slice, null, null, `has source under src/${parent}/ but no entry in packages/platform-slices.json`);
    }
  }
  for (const slice of Object.keys(fullGraph)) {
    // A <slice>/testing folder that adds no peer to its slice needs no entry.
    if (!(slice in declared) && !slice.endsWith('/testing')) {
      add('unknown', slice, null, null, `has no peer declaration in packages/platform-slice-peers.json (use [] for none)`);
    }
  }
  for (const slice of Object.keys(declared)) {
    if (!(slice in fullGraph)) {
      add('unknown', slice, null, null, `is declared in packages/platform-slice-peers.json but is neither a slice in packages/platform-slices.json nor a <slice>/testing folder with source`);
    }
  }

  // Every name the data mentions must be a peer of the package.
  const mentioned = [
    ...Object.entries(declared).flatMap(([slice, names]) => names.map((n) => [slice, n])),
    ...Object.entries(runtime).flatMap(([slice, names]) => names.map((n) => [slice, n])),
    ...Object.entries(implies).flatMap(([outer, names]) => [['$implies', outer], ...names.map((n) => ['$implies', n])]),
  ];
  for (const [slice, name] of mentioned) {
    if (!(name in peers)) add('unknown', slice, null, name, `names '${name}', which is not in ${pkg}/package.json peerDependencies`);
  }

  for (const slice of Object.keys(fullGraph)) {
    const files = scanned[slice] ?? {};
    const covered = eff(slice);
    const direct = new Set();
    for (const [file, { names }] of Object.entries(files)) {
      for (const name of names) {
        if (name === manifest.name || dependencies.has(name)) continue;
        if (name in peers) direct.add(name);
        if (!covered.has(name)) {
          add('coverage', slice, file, name, `is imported but is not a declared peer of the slice or of its slice dependencies (declare it in packages/platform-slice-peers.json and package.json peerDependencies, or make it a dependency)`);
        }
      }
    }
    // A <slice>/testing sub-slice lists only what its slice does not already bring.
    const parentPeers = slice.endsWith('/testing') ? eff(slice.slice(0, -'/testing'.length)) : new Set();
    derived[slice] = [...direct].filter((n) => !parentPeers.has(n)).sort();
    for (const name of declared[slice] ?? []) {
      if (!direct.has(name)) add('stale', slice, null, name, `declares '${name}' but no non-test file of the slice imports it`);
    }
    for (const name of runtime[slice] ?? []) {
      if (!mentionsPackage(files, name)) add('stale', slice, null, name, `is declared in $runtime but no non-test file of the slice names '${name}' as a string`);
    }
  }

  // The package root files (`src/*.ts`) may use any peer or dependency; they only must not use an undeclared name.
  for (const [file, { names }] of Object.entries(scanned['.'] ?? {})) {
    for (const name of names) {
      if (name === manifest.name || dependencies.has(name) || name in peers) continue;
      add('coverage', '.', file, name, `is imported by a package root file but is neither a dependency nor a peer of the package`);
    }
  }

  const needed = closeOver([...Object.values(declared).flat(), ...Object.values(runtime).flat()], implies);
  for (const name of Object.keys(peers)) {
    if (!needed.has(name)) add('orphan', '*', null, name, `is a peerDependency of ${pkg} that no slice declares or implies; remove it, or declare it on the slice that needs it`);
  }

  const universalNames = universalSlices(pkg, universal, graph);
  const required = new Set();
  for (const slice of universalNames) for (const name of eff(slice)) required.add(name);
  for (const name of Object.keys(peers)) {
    if (!needed.has(name)) continue;
    const isOptional = optional.has(name);
    if (required.has(name) && isOptional) {
      add('optionality', '*', null, name, `is needed by a universal slice (${universalNames.join(', ')}) so it must not be optional in peerDependenciesMeta`);
    } else if (!required.has(name) && !isOptional) {
      add('optionality', '*', null, name, `is not needed by any universal slice (${universalNames.join(', ') || 'none'}) so it must be marked optional in peerDependenciesMeta`);
    }
  }
  return { violations, derived, required: [...required].sort(), fullGraph, eff };
}

/** Runs the check over every package that has an entry in the slice graph. */
export function checkRepository(root = DEFAULT_ROOT) {
  const graphFile = readJson(join(root, 'packages', 'platform-slices.json'));
  const peersFile = readJson(join(root, 'packages', 'platform-slice-peers.json'));
  const violations = [];
  const derived = {};
  const effective = {};
  for (const [pkg, graph] of Object.entries(graphFile)) {
    if (pkg.startsWith('$')) continue;
    const pkgDir = join(root, 'packages', pkg);
    if (!existsSync(join(pkgDir, 'package.json'))) {
      violations.push({ rule: 'unknown', pkg, slice: '*', file: null, specifier: null, message: `${pkg}: listed in platform-slices.json but packages/${pkg}/package.json does not exist` });
      continue;
    }
    if (!peersFile[pkg]) {
      violations.push({ rule: 'unknown', pkg, slice: '*', file: null, specifier: null, message: `${pkg}: has no entry in packages/platform-slice-peers.json` });
    }
    const result = checkPackage({
      root,
      pkg,
      pkgDir,
      graph,
      declared: peersFile[pkg] ?? {},
      universal: peersFile.$universal ?? {},
      implies: peersFile.$implies?.[pkg] ?? {},
      runtime: peersFile.$runtime?.[pkg] ?? {},
    });
    violations.push(...result.violations);
    derived[pkg] = result.derived;
    effective[pkg] = Object.fromEntries(Object.keys(result.fullGraph).map((s) => [s, [...result.eff(s)].sort()]));
  }
  for (const pkg of Object.keys(peersFile)) {
    if (pkg.startsWith('$')) continue;
    if (!(pkg in graphFile)) {
      violations.push({ rule: 'unknown', pkg, slice: '*', file: null, specifier: null, message: `${pkg}: has peer declarations but no entry in platform-slices.json` });
    }
  }
  return { violations, derived, effective };
}

/** Markdown table of every slice's effective peers, for docs/PACKAGES.md. */
export function effectiveTable(effective, pkg) {
  const rows = Object.entries(effective[pkg] ?? {}).map(([slice, names]) => `| \`${slice}\` | ${names.map((n) => `\`${n}\``).join(', ') || 'none'} |`);
  return ['| Slice | Peers to install (own and inherited) |', '|---|---|', ...rows].join('\n');
}

function main(argv) {
  let root = DEFAULT_ROOT;
  let mode = 'check';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') root = resolve(argv[++i] ?? '');
    else if (argv[i] === '--derive') mode = 'derive';
    else if (argv[i] === '--table') mode = 'table';
    else {
      console.error(`check-slice-peers: unknown argument ${argv[i]}\nUsage: node scripts/check-slice-peers.mjs [--root <dir>] [--derive] [--table]`);
      return 2;
    }
  }
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`check-slice-peers: ${root} is not a directory`);
    return 2;
  }
  const peersPath = join(root, 'packages', 'platform-slice-peers.json');
  if (mode === 'derive' && !existsSync(peersPath)) {
    // Bootstrapping: derive against an empty declaration.
    return deriveFresh(root);
  }
  const { violations, derived, effective } = checkRepository(root);
  if (mode === 'derive') {
    console.log(JSON.stringify(derived, null, 2));
    return 0;
  }
  if (mode === 'table') {
    for (const pkg of Object.keys(effective)) console.log(`### ${pkg}\n\n${effectiveTable(effective, pkg)}\n`);
    return 0;
  }
  if (violations.length > 0) {
    console.error(`check-slice-peers: ${violations.length} violation(s)\n`);
    for (const v of violations) console.error(`  [${v.rule}] ${v.message}`);
    console.error('\nSee docs/PACKAGES.md#peer-dependencies-per-slice.');
    return 1;
  }
  console.log('check-slice-peers: every slice import is covered, no declared peer is stale or orphaned, optionality matches the universal slices.');
  return 0;
}

function deriveFresh(root) {
  const graphFile = readJson(join(root, 'packages', 'platform-slices.json'));
  const out = {};
  for (const [pkg, graph] of Object.entries(graphFile)) {
    if (pkg.startsWith('$')) continue;
    const pkgDir = join(root, 'packages', pkg);
    out[pkg] = checkPackage({ root, pkg, pkgDir, graph, declared: {}, universal: {} }).derived;
  }
  console.log(JSON.stringify(out, null, 2));
  return 0;
}

const isDirectExecution =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  process.exitCode = main(process.argv.slice(2));
}
