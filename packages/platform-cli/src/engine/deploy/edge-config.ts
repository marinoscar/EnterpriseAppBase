import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createCliRegistry } from '../../core/index.js';
import { UsageError } from '../errors.js';

// =============================================================================
// Is the running nginx serving the checkout's config?
// =============================================================================
//
// base.compose.yml bind-mounts two SINGLE FILES into the app's nginx:
//
//   ../nginx/nginx.conf -> /etc/nginx/nginx.conf
//   ../nginx/csp.conf   -> /etc/nginx/csp.conf
//
// ⚠ A SINGLE-FILE BIND MOUNT PINS AN INODE, NOT A PATH. `git checkout` does not
// edit a tracked file in place: it writes a new file and renames it over the
// old one. The container keeps the OLD inode, so after an update the host shows
// the new config and the container keeps serving the one it started with --
// for ever, because `compose restart` restarts the same container with the same
// mounts, and `compose up -d` sees no change in the compose model (the file's
// CONTENT is not part of it) and does nothing. Only recreating the container
// re-resolves the path.
//
// So a release that changes a header (a `Permissions-Policy` entry, the CSP)
// can leave production answering with the header of the initial commit while
// the repository says otherwise. Nothing fails; the site simply never picks
// the change up.
//
// So the question is asked directly, on every update: hash what the checkout
// holds, hash what the container reads, and compare. The pure parts live here
// so they can be tested without docker; `update.ts` wires them to compose.
// =============================================================================

/**
 * One config file: where the checkout holds it, where the container reads it.
 *
 * @stability experimental
 */
export interface EdgeConfigFile {
  /** Relative to the checkout root. */
  checkout: string;
  /** Absolute, inside the nginx container. */
  container: string;
}

/** Must match the nginx service's `volumes:` in infra/compose/base.compose.yml. */
export const EDGE_CONFIG_FILES: readonly EdgeConfigFile[] = [
  { checkout: 'infra/nginx/nginx.conf', container: '/etc/nginx/nginx.conf' },
  { checkout: 'infra/nginx/csp.conf', container: '/etc/nginx/csp.conf' },
];

// An app that mounts ANOTHER single file into nginx (an overlay mounting its
// own `ssl.conf` or `maps.conf`) gets the stale-inode bug described above,
// unchecked, because the list is the platform's two files. `registerEdgeConfigFile`
// adds the app's file to the same comparison: hashed in the checkout and in the
// container on every update, the container recreated when they differ.

/** Container paths are handed to `sha256sum` as argv (no shell), but stay plain anyway. */
const CONTAINER_PATH = /^\/[A-Za-z0-9._+/-]+$/;
/** Checkout paths are relative, inside the checkout. */
const CHECKOUT_PATH = /^[A-Za-z0-9._+-][A-Za-z0-9._+/-]*$/;

const registry = createCliRegistry<EdgeConfigFile>({
  name: 'edge config file',
  registerFn: 'registerEdgeConfigFile',
  idOf: (file) => file.container,
  validate: (file) => {
    if (typeof file?.container !== 'string' || !CONTAINER_PATH.test(file.container) || file.container.includes('//')) {
      throw new UsageError(`Edge config container path ${JSON.stringify(file?.container)} must be an absolute path of plain characters.`);
    }
    if (
      typeof file.checkout !== 'string' ||
      !CHECKOUT_PATH.test(file.checkout) ||
      file.checkout.split('/').includes('..') ||
      file.checkout.includes('//')
    ) {
      throw new UsageError(
        `Edge config checkout path ${JSON.stringify(file.checkout)} must be relative to the checkout root, without ".." segments.`,
      );
    }
    if (EDGE_CONFIG_FILES.some((builtin) => builtin.container === file.container)) {
      throw new UsageError(`${file.container} is already checked by the platform.`);
    }
  },
});

/**
 * Adds a single-file bind mount of the app's nginx to the stale-inode check
 * `deploy update` runs: the file is hashed in the checkout and inside the
 * nginx container, and the container is recreated once when they differ.
 *
 * Only SINGLE-FILE mounts need this. A directory mount (`app.d/`) follows a
 * rename and never goes stale.
 *
 * @param file - Where the checkout holds the file (relative) and where the container reads it (absolute).
 * @throws UsageError on a path that is not plain, or one the platform already checks.
 * @throws Error on a duplicate container path, or after `createCli` built the CLI.
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * registerEdgeConfigFile({ checkout: 'infra/nginx/ssl-extra.conf', container: '/etc/nginx/ssl-extra.conf' });
 * ```
 */
export function registerEdgeConfigFile(file: EdgeConfigFile): void {
  registry.register(Object.freeze({ checkout: file.checkout, container: file.container }));
}

/**
 * The platform's edge config files followed by the app's registered ones.
 *
 * @returns The files `deploy update` compares, in order.
 * @stability experimental
 */
export function edgeConfigFiles(): readonly EdgeConfigFile[] {
  const registered = registry.list();
  return registered.length === 0 ? EDGE_CONFIG_FILES : [...EDGE_CONFIG_FILES, ...registered];
}

/** Refuses later registrations; `createCli` calls it. */
export function freezeEdgeConfigRegistry(by: string): void {
  registry.freeze(by);
}

/** Empties the registry. Tests only. */
export function resetEdgeConfigRegistryForTests(): void {
  registry.reset();
}

/** The sha256 of a file's bytes, lowercase hex -- what `sha256sum` prints. */
export function sha256OfFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * The checkout's hashes, keyed by the CONTAINER path they are mounted at.
 *
 * A file the checkout does not have is left out rather than failing: a fork
 * that dropped csp.conf also dropped its mount, and there is nothing to
 * compare. The caller decides what an empty map means.
 */
export function checkoutEdgeHashes(
  checkoutPath: string,
  files: readonly EdgeConfigFile[] = edgeConfigFiles(),
): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const file of files) {
    const path = join(checkoutPath, file.checkout);
    if (existsSync(path)) hashes.set(file.container, sha256OfFile(path));
  }
  return hashes;
}

const SHA256_LINE = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/;

/**
 * Parses `sha256sum` output into path -\> hash.
 *
 * Tolerant on purpose: GNU prints `<hash>  <path>`, busybox (nginx:alpine) the
 * same, and binary mode puts a `*` before the path. Anything that is not a
 * hash line -- an error that reached stdout, compose's own chatter, a blank
 * line -- is ignored rather than trusted; a path missing from the result is
 * treated as "differs" by `compareEdgeConfig`, which is the safe direction.
 */
export function parseSha256sum(stdout: string): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const raw of stdout.split(/\r?\n/)) {
    const match = SHA256_LINE.exec(raw.trim());
    if (match === null) continue;
    hashes.set(match[2] as string, (match[1] as string).toLowerCase());
  }
  return hashes;
}

export interface EdgeConfigDrift {
  /** The container path. */
  file: string;
  expected: string;
  /** Undefined when the container did not report the file at all. */
  running: string | undefined;
}

/** Every file whose running hash is not the checkout's; empty means current. */
export function compareEdgeConfig(
  expected: ReadonlyMap<string, string>,
  running: ReadonlyMap<string, string>,
): EdgeConfigDrift[] {
  const drift: EdgeConfigDrift[] = [];
  for (const [file, hash] of expected) {
    const actual = running.get(file);
    if (actual !== hash) drift.push({ file, expected: hash, running: actual });
  }
  return drift;
}

/** One line per drifted file, short hashes, for the journal and the error. */
export function describeDrift(drift: readonly EdgeConfigDrift[]): string {
  return drift
    .map(
      (entry) =>
        `${entry.file}: checkout ${entry.expected.slice(0, 12)}, running ${
          entry.running === undefined ? 'unreadable' : entry.running.slice(0, 12)
        }`,
    )
    .join('; ');
}

/** What reading the container's hashes produced. */
export interface RunningRead {
  hashes: Map<string, string>;
  /** Set when the read itself failed -- typically nginx is not running. */
  error?: string | undefined;
}

export interface ReconcileEdgeConfigOptions {
  checkoutPath: string;
  files?: readonly EdgeConfigFile[] | undefined;
  /** Reads the running container's hashes. Never throws; reports `error`. */
  readRunning: () => Promise<RunningRead>;
  /** Recreates the nginx container. */
  recreate: () => Promise<void>;
  /** The command an operator can run by hand; quoted in the failure. */
  manualCommand: string;
  line: (text: string) => void;
  /** A notice worth surfacing beyond the journal (the recreate). */
  notice?: ((text: string) => void) | undefined;
}

export type ReconcileOutcome = 'current' | 'recreated' | 'nothing-to-check';

/**
 * Compare, recreate at most ONCE, compare again, and refuse if still stale.
 *
 * One recreate, not a loop: if a fresh container still reads the wrong bytes,
 * the cause is not a stale inode (a wrong mount, a compose file this CLI does
 * not know about, an override) and repeating the recreate would only hide it.
 */
export async function reconcileEdgeConfig(
  options: ReconcileEdgeConfigOptions,
): Promise<ReconcileOutcome> {
  const expected = checkoutEdgeHashes(options.checkoutPath, options.files);
  if (expected.size === 0) {
    options.line('No nginx config in the checkout; nothing to compare.');
    return 'nothing-to-check';
  }

  const first = await options.readRunning();
  const drift = compareEdgeConfig(expected, first.hashes);
  if (drift.length === 0) {
    options.line(`nginx config is current (${[...expected.keys()].join(', ')}).`);
    return 'current';
  }

  options.line(
    first.error === undefined
      ? `nginx is serving a stale config: ${describeDrift(drift)}`
      : `Could not read nginx's config (${first.error}); recreating it.`,
  );
  options.notice?.('nginx config drifted from the checkout; recreating nginx');
  await options.recreate();

  const second = await options.readRunning();
  const remaining = compareEdgeConfig(expected, second.hashes);
  if (remaining.length === 0) {
    options.line('nginx recreated; its config now matches the checkout.');
    return 'recreated';
  }

  throw new Error(
    `nginx still serves a config that differs from the checkout after being recreated: ` +
      `${describeDrift(remaining)}` +
      (second.error === undefined ? '' : ` (${second.error})`) +
      `. The running site is serving an OLD config (headers, CSP, routing). ` +
      `Recreate nginx by hand and check its mounts: ${options.manualCommand}`,
  );
}
