// =============================================================================
// platform-infra sync: materialise infra fragments into the app repository
// =============================================================================
//
// WHY COPY, NOT REFERENCE. An app's VPS deploy runs `docker compose` from the
// cloned repository (`<deployRoot>/repo/infra/compose`), where no
// `node_modules` exists. A compose `-f node_modules/...` would not resolve
// there, so every fragment file is copied into the app's `infra/` and
// committed. This module is the copy, and `--check` is what keeps the copy
// honest: a hand edit to a generated file fails CI with the fix spelled out.
//
// THREE KINDS OF FILE:
//
//   - Generated (`fragment.files`): rewritten on every sync, with a header in
//     the file's own comment syntax. Never edited in the app.
//   - App-owned (`fragment.appOwnedFiles`): created from a package template
//     only when absent; never overwritten, never checked for content.
//   - The lock (`infra/platform-infra.lock.json`): the platform version and
//     the sha256 of each generated file's body (its content after the header),
//     so a reviewer sees an upgrade's effect as a lock diff.
//
// Line endings are normalised to `\n` before hashing and comparing, so a
// Windows checkout with `core.autocrlf` does not read as drift.
// =============================================================================

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLATFORM_PACKAGE } from './index.js';
import { telemetryInfraFragment, type InfraFile, type InfraFragment } from './telemetry/index.js';

/**
 * Every fragment the package ships, in sync order.
 *
 * @internal
 */
export const INFRA_FRAGMENTS: readonly InfraFragment[] = [telemetryInfraFragment];

/**
 * Where the lock file lives, relative to the app's repository root.
 *
 * @internal
 */
export const LOCK_PATH = 'infra/platform-infra.lock.json';

/**
 * The command that re-materialises the files, as printed in headers and errors.
 *
 * @internal
 */
export const SYNC_COMMAND = 'npx platform-infra sync';

/**
 * Shape of `infra/platform-infra.lock.json`.
 *
 * @internal
 */
export interface InfraLock {
  /** The `@marinoscar/platform-infra` version the files were materialised from. */
  version: string;
  /** Per fragment id: app path of each generated file to the sha256 (hex) of its body. */
  fragments: Record<string, { files: Record<string, string> }>;
}

/**
 * Inputs shared by {@link syncInfra} and {@link checkInfra}.
 *
 * @internal
 */
export interface SyncOptions {
  /** The app's repository root; every `to` path is relative to it. */
  root: string;
  /** The package root to read fragment files from. Defaults to this package. */
  packageRoot?: string;
  /** The package version written into headers and the lock. Defaults to this package's `version`. */
  version?: string;
  /** The fragments to materialise. Defaults to {@link INFRA_FRAGMENTS}. */
  fragments?: readonly InfraFragment[];
}

/**
 * What a sync did, as app-relative paths.
 *
 * @internal
 */
export interface SyncResult {
  /** Generated files written because they were missing or differed. */
  written: string[];
  /** Generated files already identical to what sync would write. */
  unchanged: string[];
  /** App-owned files created from their template because they were absent. */
  created: string[];
  /** App-owned files left alone because they already exist. */
  kept: string[];
  /** Whether the lock file was (re)written. */
  lockWritten: boolean;
}

/**
 * One finding of {@link checkInfra}.
 *
 * @internal
 */
export interface CheckFinding {
  /** App-relative path the finding is about. */
  file: string;
  /** What is wrong and how to fix it, in one line. */
  message: string;
}

/**
 * The outcome of {@link checkInfra}: `problems` fail the check, `warnings` do not.
 *
 * @internal
 */
export interface CheckResult {
  /** The installed package version the files were compared against. */
  version: string;
  problems: CheckFinding[];
  warnings: CheckFinding[];
  /** Generated files that matched the package and the lock. */
  checked: string[];
}

const DEFAULT_PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Comment prefix per file extension. JSON has none, so a JSON fragment cannot be generated with a header. */
const COMMENT_PREFIX: Record<string, string> = {
  '.yml': '# ',
  '.yaml': '# ',
  '.conf': '# ',
  '.sh': '# ',
  '.env': '# ',
};

const HEADER_MARK = `GENERATED from ${PLATFORM_PACKAGE}@`;

function normaliseEol(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

/**
 * sha256 (hex) of a body, after normalising line endings.
 *
 * @internal
 */
export function bodyChecksum(body: string): string {
  return createHash('sha256').update(normaliseEol(body), 'utf8').digest('hex');
}

function commentPrefix(path: string): string {
  const prefix = COMMENT_PREFIX[extname(path).toLowerCase()];
  if (prefix === undefined) {
    throw new Error(`platform-infra: cannot write a generated header into "${path}" (no comment syntax known for its extension)`);
  }
  return prefix;
}

/**
 * The generated-file header for one file, as complete lines ending in `\n`.
 *
 * @internal
 */
export function generatedHeader(fragment: InfraFragment, file: InfraFile, version: string): string {
  const c = commentPrefix(file.to);
  return (
    `${c}${HEADER_MARK}${version} (${fragment.id}) — do not edit; extend through ${fragment.collectorConfigs.app} or a compose overlay\n` +
    `${c}Source of truth: ${PLATFORM_PACKAGE}/${file.from}; re-materialise with \`${SYNC_COMMAND}\`\n`
  );
}

/**
 * Splits a materialised file into its generated header (two lines) and body.
 * `header` is `undefined` when the file does not start with one.
 *
 * @internal
 */
export function splitGenerated(text: string): { header: string | undefined; version: string | undefined; body: string } {
  const normalised = normaliseEol(text);
  const lines = normalised.split('\n');
  const first = lines[0] ?? '';
  const second = lines[1] ?? '';
  const at = first.indexOf(HEADER_MARK);
  if (at < 0 || !/^\S+ /.test(first) || !second.includes(`Source of truth: ${PLATFORM_PACKAGE}/`)) {
    return { header: undefined, version: undefined, body: normalised };
  }
  const version = /^(\S+) \(/.exec(first.slice(at + HEADER_MARK.length))?.[1];
  const header = `${first}\n${second}\n`;
  return { header, version, body: normalised.slice(header.length) };
}

function readPackageVersion(packageRoot: string): string {
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version?: unknown };
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    throw new Error(`platform-infra: ${join(packageRoot, 'package.json')} has no version`);
  }
  return manifest.version;
}

/** Resolves an app-relative path, refusing one that is absolute or leaves the root. */
function appPath(root: string, to: string): string {
  if (to.trim() === '' || isAbsolute(to) || /^[a-zA-Z]:/.test(to)) {
    throw new Error(`platform-infra: "${to}" must be a path relative to the app root`);
  }
  const target = resolve(root, ...to.split('/'));
  const rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`platform-infra: "${to}" resolves outside the app root`);
  }
  return target;
}

/** Reads a fragment file from the package, refusing one that leaves the package. */
function packageText(packageRoot: string, from: string): string {
  const target = resolve(packageRoot, ...from.split('/'));
  const rel = relative(packageRoot, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`platform-infra: "${from}" resolves outside ${PLATFORM_PACKAGE}`);
  }
  return normaliseEol(readFileSync(target, 'utf8'));
}

/** Refuses a manifest that would make sync overwrite an app-owned file, or write one path twice. */
function assertConsistent(fragments: readonly InfraFragment[]): void {
  const generated = new Map<string, string>();
  const owned = new Set<string>();
  for (const fragment of fragments) {
    for (const file of fragment.appOwnedFiles) owned.add(file.to);
  }
  for (const fragment of fragments) {
    for (const file of fragment.files) {
      if (owned.has(file.to)) {
        throw new Error(`platform-infra: ${fragment.id} would generate "${file.to}", which is app-owned and never overwritten`);
      }
      const other = generated.get(file.to);
      if (other !== undefined) {
        throw new Error(`platform-infra: "${file.to}" is generated by both ${other} and ${fragment.id}`);
      }
      generated.set(file.to, fragment.id);
    }
  }
}

function resolved(options: SyncOptions): { root: string; packageRoot: string; version: string; fragments: readonly InfraFragment[] } {
  const packageRoot = options.packageRoot ?? DEFAULT_PACKAGE_ROOT;
  const fragments = options.fragments ?? INFRA_FRAGMENTS;
  assertConsistent(fragments);
  return {
    root: resolve(options.root),
    packageRoot,
    version: options.version ?? readPackageVersion(packageRoot),
    fragments,
  };
}

function lockText(lock: InfraLock): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

function readLock(root: string): InfraLock | undefined {
  const path = appPath(root, LOCK_PATH);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<InfraLock>;
    if (typeof parsed.version !== 'string' || typeof parsed.fragments !== 'object' || parsed.fragments === null) {
      return undefined;
    }
    return parsed as InfraLock;
  } catch {
    return undefined;
  }
}

function writeIfChanged(path: string, content: string): boolean {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  return true;
}

/**
 * Materialises every fragment into the app: rewrites each generated file
 * (header plus the package's content), creates each app-owned file from its
 * template only when absent, and writes the lock. Idempotent: a second run
 * writes nothing.
 *
 * @param options - The app root, and overrides for tests.
 * @returns What was written, created or left alone.
 * @internal
 */
export function syncInfra(options: SyncOptions): SyncResult {
  const { root, packageRoot, version, fragments } = resolved(options);
  const result: SyncResult = { written: [], unchanged: [], created: [], kept: [], lockWritten: false };
  const lock: InfraLock = { version, fragments: {} };

  // Plan first, write after: a missing package file or a bad path must fail
  // the sync before it has touched anything in the app.
  const generated: { to: string; target: string; content: string }[] = [];
  const owned: { to: string; target: string; content: string | undefined }[] = [];
  for (const fragment of fragments) {
    const checksums: Record<string, string> = {};
    for (const file of fragment.files) {
      const body = packageText(packageRoot, file.from);
      generated.push({ to: file.to, target: appPath(root, file.to), content: generatedHeader(fragment, file, version) + body });
      checksums[file.to] = bodyChecksum(body);
    }
    lock.fragments[fragment.id] = { files: checksums };
    for (const file of fragment.appOwnedFiles) {
      const target = appPath(root, file.to);
      owned.push({ to: file.to, target, content: existsSync(target) ? undefined : packageText(packageRoot, file.from) });
    }
  }

  for (const file of generated) {
    (writeIfChanged(file.target, file.content) ? result.written : result.unchanged).push(file.to);
  }
  for (const file of owned) {
    if (file.content === undefined) {
      result.kept.push(file.to);
      continue;
    }
    mkdirSync(dirname(file.target), { recursive: true });
    // `wx`: never replace a file that appeared since the plan was made.
    writeFileSync(file.target, file.content, { encoding: 'utf8', flag: 'wx' });
    result.created.push(file.to);
  }
  result.lockWritten = writeIfChanged(appPath(root, LOCK_PATH), lockText(lock));
  return result;
}

/** 1-based line of the first difference between two bodies, counted in the materialised file. */
function firstDifference(actual: string, expected: string, offset: number): number {
  const a = actual.split('\n');
  const e = expected.split('\n');
  const max = Math.max(a.length, e.length);
  for (let i = 0; i < max; i++) {
    if (a[i] !== e[i]) return i + 1 + offset;
  }
  return offset + 1;
}

/**
 * Verifies the app's materialised files without writing anything. A problem
 * is a generated file that is missing, lacks its header, differs from the
 * package or from the lock, or a missing app-owned file. A version-only
 * difference (same content, older header or lock version) is a warning.
 *
 * @param options - The app root, and overrides for tests.
 * @returns The problems (which fail `--check`) and warnings.
 * @internal
 */
export function checkInfra(options: SyncOptions): CheckResult {
  const { root, packageRoot, version, fragments } = resolved(options);
  const result: CheckResult = { version, problems: [], warnings: [], checked: [] };
  const lock = readLock(root);
  const restore = `run \`${SYNC_COMMAND}\` to restore it`;

  if (lock === undefined) {
    result.problems.push({ file: LOCK_PATH, message: `missing or unreadable; run \`${SYNC_COMMAND}\` to write it` });
  } else if (lock.version !== version) {
    result.warnings.push({
      file: LOCK_PATH,
      message: `records ${PLATFORM_PACKAGE}@${lock.version}, installed is ${version}; run \`${SYNC_COMMAND}\` to refresh it`,
    });
  }

  for (const fragment of fragments) {
    const overlay = `move your change into ${fragment.collectorConfigs.app} (collector) or a compose overlay of your own (compose services)`;
    const known = new Set(fragment.files.map((file) => file.to));

    for (const file of fragment.files) {
      const target = appPath(root, file.to);
      if (!existsSync(target)) {
        result.problems.push({ file: file.to, message: `missing; it is generated by ${PLATFORM_PACKAGE} (${fragment.id}): ${restore}` });
        continue;
      }
      const expected = packageText(packageRoot, file.from);
      const { header, version: headerVersion, body } = splitGenerated(readFileSync(target, 'utf8'));
      let ok = true;

      if (header === undefined) {
        ok = false;
        result.problems.push({
          file: file.to,
          message: `has no generated header; it is generated by ${PLATFORM_PACKAGE} (${fragment.id}): ${restore}`,
        });
      } else if (body !== expected) {
        ok = false;
        result.problems.push({
          file: `${file.to}:${firstDifference(body, expected, 2)}`,
          message:
            `differs from ${PLATFORM_PACKAGE}@${version} (${fragment.id}). This file is generated: ${restore}, ` +
            `then ${overlay}`,
        });
      } else if (headerVersion !== version) {
        result.warnings.push({
          file: file.to,
          message: `header names ${PLATFORM_PACKAGE}@${headerVersion ?? '?'}, installed is ${version}; run \`${SYNC_COMMAND}\` to refresh it`,
        });
      }

      // Only once the body matches the package: a hand edit is reported once,
      // above, not a second time as a checksum mismatch.
      if (ok && lock !== undefined) {
        const recorded = lock.fragments[fragment.id]?.files[file.to];
        if (recorded === undefined) {
          ok = false;
          result.problems.push({ file: LOCK_PATH, message: `has no checksum for ${file.to}; run \`${SYNC_COMMAND}\` to rewrite the lock` });
        } else if (recorded !== bodyChecksum(body)) {
          ok = false;
          result.problems.push({
            file: LOCK_PATH,
            message: `records a different checksum for ${file.to} than its content; the lock was edited by hand or not rewritten: run \`${SYNC_COMMAND}\` to rewrite it`,
          });
        }
      }
      if (ok) result.checked.push(file.to);
    }

    for (const stale of Object.keys(lock?.fragments[fragment.id]?.files ?? {})) {
      if (!known.has(stale)) {
        result.warnings.push({ file: LOCK_PATH, message: `lists ${stale}, which ${fragment.id} no longer generates; run \`${SYNC_COMMAND}\`` });
      }
    }

    for (const file of fragment.appOwnedFiles) {
      if (!existsSync(appPath(root, file.to))) {
        result.problems.push({
          file: file.to,
          message: `missing; this app-owned file is mounted by the ${fragment.id} fragment. Run \`${SYNC_COMMAND}\` to create it from ${PLATFORM_PACKAGE}/${file.from}`,
        });
      }
    }
  }

  return result;
}
