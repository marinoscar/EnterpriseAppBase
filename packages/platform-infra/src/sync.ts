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
//     the file's own comment syntax. Never edited in the app. Rendered from
//     the app identity first (`@@PLATFORM_*@@` placeholders, identity.ts);
//     a file with `append` gets an app-owned file's content after it (the
//     app's own variables after the platform's, in `.env.example`).
//   - App-owned (`fragment.appOwnedFiles`): created from a package template
//     only when absent; never overwritten, never checked for content. A
//     `keep` file (`.gitkeep`) is created only in a missing or empty directory
//     and is never reported missing.
//   - The lock (`infra/platform-infra.lock.json`): the platform version, the
//     identity the files were rendered with, the sha256 of each generated
//     file's body (its content without the header), and per fragment the
//     generated files that are executable, so a reviewer sees an upgrade's
//     effect as a lock diff.
//
// EXECUTABLE SCRIPTS (`file.executable`, issue #869). A script such as
// `infra/compose/postgres-init/10-application-role.sh` is mounted into a
// container and run by path, so two things must survive the copy: the `#!`
// shebang on line 1 (the generated header goes AFTER it, never before) and the
// executable mode bit. Sync writes the file with mode 0755 (also when only the
// mode was lost), the lock lists it under `executable`, and `--check` fails
// when the bit is gone, so a `chmod -x` or a commit recording mode 100644 is
// caught in CI. Windows has no executable bit: there the mode is neither set
// nor checked.
//
// Line endings are normalised to `\n` before hashing and comparing, so a
// Windows checkout with `core.autocrlf` does not read as drift.
// =============================================================================

import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readAppIdentity } from './app-identity.js';
import type { InfraFile, InfraFragmentFiles } from './fragment.js';
import { composeInfraFragment, envInfraFragment, nginxInfraFragment } from './fragments.js';
import { hasPlaceholder, renderInfraText, type InfraIdentity } from './identity.js';
import { PLATFORM_PACKAGE } from './package-name.js';
import { telemetryInfraFragment } from './telemetry/index.js';

/**
 * Every fragment the package ships, in sync order.
 *
 * @internal
 */
export const INFRA_FRAGMENTS: readonly InfraFragmentFiles[] = [
  composeInfraFragment,
  nginxInfraFragment,
  envInfraFragment,
  telemetryInfraFragment,
];

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
  /** The app identity the placeholders were rendered with (absent when no file needed one). */
  identity?: InfraIdentity;
  /**
   * Per fragment id: app path of each generated file to the sha256 (hex) of
   * its body, and (only when there is one) the app paths of its executable
   * files, which sync writes with mode 0755.
   */
  fragments: Record<string, { files: Record<string, string>; executable?: string[] }>;
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
  fragments?: readonly InfraFragmentFiles[];
  /**
   * The app identity placeholders are rendered with. Defaults to the one read
   * from the app (`readAppIdentity`): `packages/shared/identity.json`, with
   * the CLI name from `apps/cli/package.json`'s `bin`.
   */
  identity?: InfraIdentity;
  /** The identity file to read instead, relative to `root` (the `--identity` option). */
  identityFile?: string;
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
  // `.env.example`, `.env.worker.example`: dotenv files.
  '.example': '# ',
};

const HEADER_MARK = `GENERATED from ${PLATFORM_PACKAGE}@`;

/** The mode sync gives an executable generated file. */
const EXECUTABLE_MODE = 0o755;

/** Whether the file system has an executable bit to set and check (Windows has none). */
const MODE_BITS = process.platform !== 'win32';

/** Whether a materialised file at `path` has lost its executable bit (the owner's, the one git records). */
function lostExecutableBit(path: string): boolean {
  return MODE_BITS && (statSync(path).mode & 0o100) === 0;
}

/** The `#!` line of a body, with its newline, or '' when the body does not start with one. */
function shebangOf(body: string): string {
  if (!body.startsWith('#!')) return '';
  const end = body.indexOf('\n');
  return end < 0 ? `${body}\n` : body.slice(0, end + 1);
}

/**
 * A generated file as written: the header first, or right after the shebang
 * when the body starts with one, so the kernel still finds the interpreter.
 *
 * @internal
 */
export function materialise(header: string, body: string): string {
  const shebang = shebangOf(body);
  return shebang === '' ? header + body : shebang + header + body.slice(shebang.length);
}

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
export function generatedHeader(fragment: InfraFragmentFiles, file: InfraFile, version: string): string {
  const c = commentPrefix(file.to);
  return (
    `${c}${HEADER_MARK}${version} (${fragment.id}) — do not edit; extend through ${fragment.extendThrough}\n` +
    `${c}Source of truth: ${PLATFORM_PACKAGE}/${file.from}; re-materialise with \`${SYNC_COMMAND}\`\n`
  );
}

/**
 * Splits a materialised file into its generated header (two lines) and body.
 * The header is the file's first two lines, or the two after a `#!` shebang
 * (which stays part of the body). `header` is `undefined` when the file
 * carries none.
 *
 * @internal
 */
export function splitGenerated(text: string): { header: string | undefined; version: string | undefined; body: string } {
  const normalised = normaliseEol(text);
  const shebang = shebangOf(normalised);
  const rest = normalised.slice(shebang.length);
  const lines = rest.split('\n');
  const first = lines[0] ?? '';
  const second = lines[1] ?? '';
  const at = first.indexOf(HEADER_MARK);
  if (at < 0 || !/^\S+ /.test(first) || !second.includes(`Source of truth: ${PLATFORM_PACKAGE}/`)) {
    return { header: undefined, version: undefined, body: normalised };
  }
  const version = /^(\S+) \(/.exec(first.slice(at + HEADER_MARK.length))?.[1];
  const header = `${first}\n${second}\n`;
  return { header, version, body: shebang + rest.slice(header.length) };
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
function assertConsistent(fragments: readonly InfraFragmentFiles[]): void {
  const generated = new Map<string, string>();
  const owned = new Set<string>();
  for (const fragment of fragments) {
    for (const file of fragment.appOwnedFiles) {
      if (file.executable === true) {
        throw new Error(`platform-infra: ${fragment.id} marks the app-owned "${file.to}" executable; only a generated file can be`);
      }
      owned.add(file.to);
    }
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

interface Resolved {
  root: string;
  packageRoot: string;
  version: string;
  fragments: readonly InfraFragmentFiles[];
  /** Read lazily: only an app whose files carry a placeholder needs an identity. */
  identity: () => InfraIdentity | undefined;
}

function resolved(options: SyncOptions): Resolved {
  const packageRoot = options.packageRoot ?? DEFAULT_PACKAGE_ROOT;
  const fragments = options.fragments ?? INFRA_FRAGMENTS;
  assertConsistent(fragments);
  const root = resolve(options.root);
  let identity: InfraIdentity | undefined = options.identity;
  let read = identity !== undefined;
  return {
    root,
    packageRoot,
    version: options.version ?? readPackageVersion(packageRoot),
    fragments,
    identity: () => {
      if (!read) {
        read = true;
        identity = readAppIdentity(root, options.identityFile);
      }
      return identity;
    },
  };
}

/**
 * The body sync writes for one generated file (after the header): the package
 * file rendered with the app identity, then the app-owned file it appends.
 * `appended` is the app-owned file's content, or undefined to read it.
 */
function expectedBody(context: Resolved, file: InfraFile, appended?: string): { body: string; rendered: boolean } {
  const raw = packageText(context.packageRoot, file.from);
  let body = raw;
  let rendered = false;
  if (hasPlaceholder(raw)) {
    const identity = context.identity();
    if (identity === undefined) {
      throw new Error(
        `platform-infra: ${file.from} is rendered with the app identity, and none was found: ` +
          `add packages/shared/identity.json ({ "productName", "cliName" }) or pass --identity <file>`,
      );
    }
    body = renderInfraText(raw, identity, `${PLATFORM_PACKAGE}/${file.from}`);
    rendered = true;
  }
  if (file.append !== undefined) {
    const extra = appended ?? appOwnedText(context, file.append);
    if (extra !== undefined && extra !== '') body = `${body.endsWith('\n') ? body : `${body}\n`}\n${extra}`;
  }
  if (file.executable === true && shebangOf(body) === '') {
    throw new Error(`platform-infra: ${PLATFORM_PACKAGE}/${file.from} is executable, so its first line must be a #! shebang`);
  }
  return { body, rendered };
}

/** An app-owned file's current content, or its template when absent (what sync would create). */
function appOwnedText(context: Resolved, to: string): string | undefined {
  const target = appPath(context.root, to);
  if (existsSync(target)) return normaliseEol(readFileSync(target, 'utf8'));
  const template = context.fragments.flatMap((fragment) => fragment.appOwnedFiles).find((file) => file.to === to);
  return template === undefined ? undefined : packageText(context.packageRoot, template.from);
}

/** Whether a `keep` placeholder is due: its directory is missing or empty. */
function keepDue(target: string): boolean {
  const dir = dirname(target);
  return !existsSync(dir) || readdirSync(dir).length === 0;
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

function writeIfChanged(path: string, content: string, executable = false): boolean {
  const same = existsSync(path) && readFileSync(path, 'utf8') === content;
  if (same && !(executable && lostExecutableBit(path))) return false;
  if (!same) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, executable ? { encoding: 'utf8', mode: EXECUTABLE_MODE } : 'utf8');
  }
  // `mode` above applies only to a new file, and through the umask: set it.
  if (executable && MODE_BITS) chmodSync(path, EXECUTABLE_MODE);
  return true;
}

/**
 * Materialises every fragment into the app: rewrites each generated file
 * (header plus the package's content; after the shebang, and with mode 0755,
 * for an executable one), creates each app-owned file from its
 * template only when absent, and writes the lock. Idempotent: a second run
 * writes nothing.
 *
 * @param options - The app root, and overrides for tests.
 * @returns What was written, created or left alone.
 * @internal
 */
export function syncInfra(options: SyncOptions): SyncResult {
  const context = resolved(options);
  const { root, packageRoot, version, fragments } = context;
  const result: SyncResult = { written: [], unchanged: [], created: [], kept: [], lockWritten: false };
  const lock: InfraLock = { version, fragments: {} };

  // Plan first, write after: a missing package file or a bad path must fail
  // the sync before it has touched anything in the app. App-owned files are
  // planned first, because a generated file may append one of them.
  const owned: { to: string; target: string; content: string | undefined; keep: boolean }[] = [];
  const ownedText = new Map<string, string>();
  for (const fragment of fragments) {
    for (const file of fragment.appOwnedFiles) {
      const target = appPath(root, file.to);
      const keep = file.keep === true;
      const create = keep ? keepDue(target) && !existsSync(target) : !existsSync(target);
      const content = create ? packageText(packageRoot, file.from) : undefined;
      owned.push({ to: file.to, target, content, keep });
      ownedText.set(file.to, content ?? (existsSync(target) ? normaliseEol(readFileSync(target, 'utf8')) : ''));
    }
  }
  const generated: { to: string; target: string; content: string; executable: boolean }[] = [];
  let rendered = false;
  for (const fragment of fragments) {
    const checksums: Record<string, string> = {};
    const executable: string[] = [];
    for (const file of fragment.files) {
      const appended = file.append === undefined ? undefined : (ownedText.get(file.append) ?? appOwnedText(context, file.append));
      const expected = expectedBody(context, file, appended);
      rendered ||= expected.rendered;
      generated.push({
        to: file.to,
        target: appPath(root, file.to),
        content: materialise(generatedHeader(fragment, file, version), expected.body),
        executable: file.executable === true,
      });
      checksums[file.to] = bodyChecksum(expected.body);
      if (file.executable === true) executable.push(file.to);
    }
    lock.fragments[fragment.id] = executable.length === 0 ? { files: checksums } : { files: checksums, executable };
  }
  const identity = rendered ? context.identity() : undefined;
  const lockOut: InfraLock = identity === undefined ? lock : { version, identity: { ...identity }, fragments: lock.fragments };

  for (const file of generated) {
    (writeIfChanged(file.target, file.content, file.executable) ? result.written : result.unchanged).push(file.to);
  }
  for (const file of owned) {
    if (file.content === undefined) {
      if (!file.keep) result.kept.push(file.to);
      continue;
    }
    mkdirSync(dirname(file.target), { recursive: true });
    // `wx`: never replace a file that appeared since the plan was made.
    writeFileSync(file.target, file.content, { encoding: 'utf8', flag: 'wx' });
    result.created.push(file.to);
  }
  result.lockWritten = writeIfChanged(appPath(root, LOCK_PATH), lockText(lockOut));
  return result;
}

/**
 * 1-based line of the first difference between two bodies, counted in the
 * materialised file: the two header lines come first, or right after the
 * body's shebang line when it has one.
 */
function firstDifference(actual: string, expected: string): number {
  const a = actual.split('\n');
  const e = expected.split('\n');
  const shebang = shebangOf(actual) !== '' ? 1 : 0;
  const max = Math.max(a.length, e.length);
  let line = 0;
  for (let i = 0; i < max; i++) {
    if (a[i] !== e[i]) {
      line = i;
      break;
    }
  }
  return line < shebang ? line + 1 : line + 3;
}

/**
 * Verifies the app's materialised files without writing anything. A problem
 * is a generated file that is missing, lacks its header, differs from the
 * package or from the lock, an executable one that lost its executable bit
 * (or that the lock does not record as executable), or a missing app-owned
 * file. A version-only
 * difference (same content, older header or lock version) is a warning.
 *
 * @param options - The app root, and overrides for tests.
 * @returns The problems (which fail `--check`) and warnings.
 * @internal
 */
export function checkInfra(options: SyncOptions): CheckResult {
  const context = resolved(options);
  const { root, version, fragments } = context;
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
    const overlay = `move your change into ${fragment.extendThrough}`;
    const known = new Set(fragment.files.map((file) => file.to));

    for (const file of fragment.files) {
      const target = appPath(root, file.to);
      if (!existsSync(target)) {
        result.problems.push({ file: file.to, message: `missing; it is generated by ${PLATFORM_PACKAGE} (${fragment.id}): ${restore}` });
        continue;
      }
      const expected = expectedBody(context, file).body;
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
          file: `${file.to}:${firstDifference(body, expected)}`,
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

      if (file.executable === true && lostExecutableBit(target)) {
        ok = false;
        result.problems.push({
          file: file.to,
          message:
            `is not executable; ${PLATFORM_PACKAGE} (${fragment.id}) ships it as a script (mode 755): ${restore}, ` +
            `then commit the mode (\`git add\` records it; \`git update-index --chmod=+x\` on a checkout without mode bits)`,
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

    if (lock !== undefined) {
      const expected = fragment.files.filter((file) => file.executable === true).map((file) => file.to);
      const recorded = lock.fragments[fragment.id]?.executable ?? [];
      const missing = expected.filter((to) => !recorded.includes(to));
      const extra = recorded.filter((to) => !expected.includes(to));
      if (missing.length > 0 || extra.length > 0) {
        const what = [
          ...missing.map((to) => `does not record ${to} as executable`),
          ...extra.map((to) => `records ${to} as executable, which ${fragment.id} does not generate as one`),
        ].join('; ');
        result.problems.push({ file: LOCK_PATH, message: `${what}; run \`${SYNC_COMMAND}\` to rewrite the lock` });
      }
    }

    for (const stale of Object.keys(lock?.fragments[fragment.id]?.files ?? {})) {
      if (!known.has(stale)) {
        result.warnings.push({ file: LOCK_PATH, message: `lists ${stale}, which ${fragment.id} no longer generates; run \`${SYNC_COMMAND}\`` });
      }
    }

    for (const file of fragment.appOwnedFiles) {
      if (file.keep !== true && !existsSync(appPath(root, file.to))) {
        result.problems.push({
          file: file.to,
          message: `missing; this app-owned file is used by the ${fragment.id} fragment. Run \`${SYNC_COMMAND}\` to create it from ${PLATFORM_PACKAGE}/${file.from}`,
        });
      }
    }
  }

  return result;
}
