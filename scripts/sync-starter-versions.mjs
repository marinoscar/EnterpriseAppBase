#!/usr/bin/env node
// =============================================================================
// scripts/sync-starter-versions.mjs — keep starter/ on the platform version
// being released (issue #741)
// =============================================================================
//
// The starter depends on PUBLISHED `@marinoscar/platform-*` versions through a
// caret range (`^0.1.0-next.3`), never a workspace path. The release workflow
// runs this after `changeset version` so the range moves with the platform:
//
//   node scripts/sync-starter-versions.mjs            # set every range to ^<version>
//   node scripts/sync-starter-versions.mjs --check    # CI: exit 1 when a range excludes <version>
//
// <version> is packages/platform-api/package.json's (the six packages share
// one version, a Changesets "fixed" group). Node built-ins only; importing it
// runs nothing.
// =============================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = '@marinoscar/platform-';

/** The starter manifests that may depend on a platform package. */
export const STARTER_MANIFESTS = ['starter/package.json', 'starter/apps/api/package.json', 'starter/apps/web/package.json', 'starter/apps/cli/package.json'];

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseVersion(version) {
  const m = SEMVER.exec(version);
  if (!m) throw new Error(`not a semver version: ${version}`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : [] };
}

function comparePre(a, b) {
  if (a.length === 0 || b.length === 0) return (b.length === 0 ? 0 : 1) - (a.length === 0 ? 0 : 1);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const na = /^\d+$/.test(a[i]) ? Number(a[i]) : null;
    const nb = /^\d+$/.test(b[i]) ? Number(b[i]) : null;
    if (na !== null && nb !== null && na !== nb) return na - nb;
    if (na !== null && nb === null) return -1;
    if (na === null && nb !== null) return 1;
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  return x.major - y.major || x.minor - y.minor || x.patch - y.patch || comparePre(x.pre, y.pre);
}

/**
 * Whether the caret range `^base` admits `version`, by npm's rules: at or
 * above the base, below the next breaking version (the first non-zero of
 * major, minor, patch), and a pre-release only on the base's own
 * major.minor.patch.
 */
export function caretSatisfies(range, version) {
  if (!range.startsWith('^')) return false;
  const base = range.slice(1);
  const b = parseVersion(base);
  const v = parseVersion(version);
  if (compareVersions(version, base) < 0) return false;
  const upper = b.major > 0 ? [b.major + 1, 0, 0] : b.minor > 0 ? [0, b.minor + 1, 0] : [0, 0, b.patch + 1];
  if (compareVersions(version, `${upper.join('.')}-0`) >= 0) return false;
  if (v.pre.length > 0 && !(v.major === b.major && v.minor === b.minor && v.patch === b.patch && b.pre.length > 0)) return false;
  return true;
}

export function platformVersion(root = REPO_ROOT) {
  return JSON.parse(readFileSync(join(root, 'packages', 'platform-api', 'package.json'), 'utf8')).version;
}

/** `[{ manifest, field, name, range }]` for every platform dependency of the starter. */
export function starterPlatformRanges(root = REPO_ROOT) {
  const out = [];
  for (const manifest of STARTER_MANIFESTS) {
    const json = JSON.parse(readFileSync(join(root, manifest), 'utf8'));
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [name, range] of Object.entries(json[field] ?? {})) {
        if (name.startsWith(PREFIX)) out.push({ manifest, field, name, range });
      }
    }
  }
  return out;
}

/** Problems with the ranges: a non-caret spec (workspace:, file:, a path, a tag) or one that excludes `version`. */
export function checkRanges(ranges, version) {
  const problems = [];
  for (const { manifest, name, range } of ranges) {
    if (!/^\^\d/.test(range)) problems.push(`${manifest}: ${name} is "${range}"; the starter depends on published versions only, as a caret range`);
    else if (!caretSatisfies(range, version)) problems.push(`${manifest}: ${name} "${range}" does not include the platform version ${version}`);
  }
  return problems;
}

/** Sets every platform range to `^version`, editing only those values; returns the files changed. */
export function syncRanges(root, version) {
  const changed = [];
  for (const manifest of STARTER_MANIFESTS) {
    const path = join(root, manifest);
    const before = readFileSync(path, 'utf8');
    const after = before.replace(/("@marinoscar\/platform-[a-z-]+":\s*)"[^"]*"/g, `$1"^${version}"`);
    if (after !== before) {
      writeFileSync(path, after);
      changed.push(manifest);
    }
  }
  return changed;
}

function main(argv) {
  const check = argv.includes('--check');
  const version = platformVersion();
  if (check) {
    const ranges = starterPlatformRanges();
    const problems = checkRanges(ranges, version);
    if (ranges.length === 0) problems.push('starter/ declares no @marinoscar/platform-* dependency');
    if (problems.length > 0) {
      for (const problem of problems) console.error(`sync-starter-versions: ${problem}`);
      console.error('Run `node scripts/sync-starter-versions.mjs` to set them.');
      return 1;
    }
    console.log(`sync-starter-versions: ${ranges.length} starter range(s) include ${version}.`);
    return 0;
  }
  const changed = syncRanges(REPO_ROOT, version);
  console.log(changed.length > 0 ? `sync-starter-versions: set ^${version} in ${changed.join(', ')}` : `sync-starter-versions: already ^${version}`);
  return 0;
}

const isDirectExecution = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) process.exitCode = main(process.argv.slice(2));
