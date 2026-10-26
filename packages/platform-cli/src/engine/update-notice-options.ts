import { UsageError } from './errors.js';

// =============================================================================
// The update notice's options: validation and the one setting  (issue #1033)
// =============================================================================
//
// Kept apart from `update-notice.ts` (the runtime: cache file, fetch, notice)
// ON PURPOSE. `registries.ts` must reach `resetUpdateNoticeForTests`, and
// `test-support.ts` (loaded by every test file's setup) imports `registries.ts`.
// Anything on that import chain is evaluated in the setup file, before a test
// file's `vi.mock`, so it can no longer be mocked there: when the runtime
// imported `config.js`, `config.test.ts`'s `vi.mock('node:fs')` silently stopped
// applying to it. This module imports nothing but `errors.js`.
// =============================================================================

/** One check per day. */
export const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** How long a command may be held back at its end waiting for the answer. */
export const DEFAULT_UPDATE_CHECK_TIMEOUT_MS = 1500;

/** Basename of the cache file in the CLI's state directory (`~/.<cli>/`). */
export const UPDATE_CHECK_CACHE_FILE = 'update-check.json';

/** The environment variable (suffix) that turns the check off: `<PREFIX>_NO_UPDATE_CHECK=1`. */
export const NO_UPDATE_CHECK_ENV_SUFFIX = 'NO_UPDATE_CHECK';

/**
 * What an app decides about the start-up update notice, for
 * {@link CreateCliOptions}: where the newest version comes from and how the
 * operator updates. Unset means no check at all.
 *
 * @stability experimental
 * @extensionPoint option
 */
export interface UpdateNoticeOptions {
  /**
   * Resolves the newest available version of this CLI, or `undefined` when it
   * is not known. Use {@link githubRawManifest} to read a `package.json` on
   * GitHub.
   *
   * It runs in parallel with the command and is bounded by `timeoutMs`; it
   * receives an `AbortSignal` that is aborted at that deadline, and a
   * function that ignores the signal is simply abandoned. A rejection, a throw
   * and a value that is not a valid semver string are all treated as "unknown".
   */
  latestVersion: (signal?: AbortSignal) => Promise<string | undefined>;
  /**
   * The text after `Update:` in the notice: how the operator updates this CLI
   * (`git pull && npm ci && npm run build`). One line, non-empty. Validated at
   * `createCli`.
   */
  upgradeHint: string;
  /** The least time between two network checks, in milliseconds. Default 24 hours. `0` checks on every run. */
  intervalMs?: number | undefined;
  /** The longest the end of a command waits for the answer, counted from when the CLI started, in milliseconds. Default 1500. */
  timeoutMs?: number | undefined;
}

/** {@link UpdateNoticeOptions} with the defaults applied. */
export interface ResolvedUpdateNotice {
  readonly latestVersion: UpdateNoticeOptions['latestVersion'];
  readonly upgradeHint: string;
  readonly intervalMs: number;
  readonly timeoutMs: number;
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/**
 * Validates `updateNotice` and applies the defaults.
 *
 * @throws UsageError when `latestVersion` is not a function, `upgradeHint` is
 *   empty or has a line break or control character, `intervalMs` is not a
 *   non-negative number, or `timeoutMs` is not a positive number.
 * @internal
 */
export function resolveUpdateNotice(options: UpdateNoticeOptions): ResolvedUpdateNotice {
  if (typeof options !== 'object' || options === null || typeof options.latestVersion !== 'function') {
    throw new UsageError('updateNotice.latestVersion must be a function returning the newest version (see githubRawManifest).');
  }
  if (typeof options.upgradeHint !== 'string' || options.upgradeHint.trim() === '') {
    throw new UsageError('updateNotice.upgradeHint must be a non-empty string telling the operator how to update.');
  }
  if (CONTROL_CHARACTERS.test(options.upgradeHint)) {
    throw new UsageError('updateNotice.upgradeHint must be a single line without control characters.');
  }
  const intervalMs = options.intervalMs ?? DEFAULT_UPDATE_CHECK_INTERVAL_MS;
  if (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new UsageError('updateNotice.intervalMs must be a non-negative number of milliseconds.');
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_UPDATE_CHECK_TIMEOUT_MS;
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new UsageError('updateNotice.timeoutMs must be a positive number of milliseconds.');
  }
  return Object.freeze({
    latestVersion: options.latestVersion,
    upgradeHint: options.upgradeHint.trim(),
    intervalMs,
    timeoutMs,
  });
}

let configured: ResolvedUpdateNotice | undefined;

/**
 * Sets the notice for this process; `createCli` calls it with
 * `options.updateNotice`. `undefined` turns the feature off.
 *
 * @throws UsageError on invalid options; nothing is changed then.
 * @internal
 */
export function setUpdateNotice(options: UpdateNoticeOptions | undefined): void {
  configured = options === undefined ? undefined : resolveUpdateNotice(options);
}

/** Turns the feature off. Tests only (`resetCliForTests` calls it). */
export function resetUpdateNoticeForTests(): void {
  configured = undefined;
}

/** The notice in force, or `undefined` when the app did not turn it on. @internal */
export function getUpdateNotice(): ResolvedUpdateNotice | undefined {
  return configured;
}

/** Whether `createCli` turned the notice on. @internal */
export function hasUpdateNotice(): boolean {
  return configured !== undefined;
}

