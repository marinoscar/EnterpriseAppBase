import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { configDirPath, type ConfigContext } from './config.js';
import { cliName, cliVersion, envVar } from './identity.js';
import { isNewerVersion, parseSemver } from './semver.js';
import { NO_UPDATE_CHECK_ENV_SUFFIX, UPDATE_CHECK_CACHE_FILE, getUpdateNotice } from './update-notice-options.js';
import type { TtyLike } from './tui/tty.js';

// =============================================================================
// The start-up update notice  (issue #1033)
// =============================================================================
//
// Operators run an old app CLI on servers without knowing a newer one exists;
// several production failures were fixed in a newer CLI the server did not
// have. `createCli({ updateNotice })` turns this on: when the CLI starts it
// finds the newest version, and if it is newer than the running one, writes ONE
// line to stderr after the command's output.
//
// THE RULES THIS FILE EXISTS TO KEEP, each with the failure it prevents:
//
//   1. NEVER IN THE WAY OF THE COMMAND. The fetch starts BEFORE the command and
//      is not awaited until the command has finished; the command's runtime is
//      unchanged. After the command, the wait is bounded by what is LEFT of the
//      timeout (default 1.5 s from the start), so a slow command waits for
//      nothing and a fast one waits at most 1.5 s, once a day.
//   2. NEVER A CHANGED EXIT CODE OR STDOUT. The notice is a single stderr
//      write; `finish()` cannot throw; no code here returns a number.
//   3. SILENT ON EVERY FAILURE. Offline, timeout, a throwing or hanging
//      `latestVersion`, a corrupt cache, an unwritable home: all swallowed.
//   4. AT MOST ONE NETWORK CHECK PER INTERVAL (24 h). The answer is cached in
//      the CLI's state directory; a FAILED check is cached too (with the last
//      known version kept), so an offline server does not retry, and wait up to
//      the timeout, on every command.
//   5. ONLY WHERE A HUMAN WILL SEE IT. Not in CI, not when stderr is not a
//      terminal, not for machine-readable (`--json`) or informational
//      (`--version`, `--help`) runs, not for the worker-node daemon, and not
//      when the operator opted out with `<PREFIX>_NO_UPDATE_CHECK`.
//   6. WHAT IS PRINTED IS PROVEN. The latest version must parse as strict
//      semver whether it came from the network or from the cache file (a file
//      anyone with the home directory can edit), and the running version must
//      too. The hint is the app's own string, validated when the CLI is built.
//
// UNSET MEANS OFF: an app that does not pass `updateNotice` is byte for byte
// the CLI it was, and `beginUpdateCheck` returns before it reads anything.
// =============================================================================

// -----------------------------------------------------------------------------
// When NOT to check
// -----------------------------------------------------------------------------

/** Why a run does not check. Distinct values so a test asserts the cause. */
export type UpdateCheckSkipReason =
  | 'opted-out'
  | 'ci'
  | 'stderr-not-a-tty'
  | 'json'
  | 'version'
  | 'help'
  | 'node-daemon';

/** The same reading of a flag-like variable as the TUI gate: unset, empty, `0`, `false`, `no` are off. */
function isEnvFlagSet(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalised = value.trim().toLowerCase();
  return normalised.length > 0 && normalised !== '0' && normalised !== 'false' && normalised !== 'no';
}

/**
 * Decides whether this invocation must not check for an update.
 *
 * Order: the operator's own opt-out first (the most actionable cause), then
 * the environment, then what the command line asks for. Arguments after a
 * lone `--` belong to the command and are not read.
 *
 * `node start` is the worker daemon (also what the systemd unit runs, and what
 * `node start --daemon` re-spawns): long-running, unattended, and its stderr is
 * a log. The rest of the `node` group is interactive and does check.
 *
 * @returns The reason to skip, or `undefined` to check.
 * @internal
 */
export function updateCheckSkipReason(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  stderr: TtyLike,
): UpdateCheckSkipReason | undefined {
  if (isEnvFlagSet(env[envVar(NO_UPDATE_CHECK_ENV_SUFFIX)])) return 'opted-out';
  if (isEnvFlagSet(env.CI) || isEnvFlagSet(env.CONTINUOUS_INTEGRATION)) return 'ci';
  // `isTTY` is undefined, not false, on a pipe: compare with `!== true`.
  if (stderr.isTTY !== true) return 'stderr-not-a-tty';

  const end = argv.indexOf('--');
  const args = end === -1 ? argv : argv.slice(0, end);
  if (args.includes('--json')) return 'json';
  if (args.includes('--version') || args.includes('-V') || args.includes('-v')) return 'version';
  if (args.includes('--help') || args.includes('-h')) return 'help';

  const positionals = args.filter((arg) => !arg.startsWith('-'));
  if (positionals[0] === 'help') return 'help';
  if (positionals[0] === 'node' && positionals[1] === 'start') return 'node-daemon';
  return undefined;
}

// -----------------------------------------------------------------------------
// The cache
// -----------------------------------------------------------------------------

interface UpdateCheckCache {
  /** Epoch milliseconds of the last check, parsed from the file's ISO string. */
  readonly checkedAt: number;
  /** The newest version seen, a valid semver string, or `undefined` when none has been seen. */
  readonly latest: string | undefined;
}

/** The file is two short fields; anything larger is not ours. */
const MAX_CACHE_BYTES = 4096;

/** The cache file's path, `~/.<cli>/update-check.json`. */
export function updateCheckCachePath(ctx?: ConfigContext): string {
  return join(configDirPath(ctx), UPDATE_CHECK_CACHE_FILE);
}

/** Reads the cache; `undefined` when it is missing, unreadable, too large or not the expected shape. */
function readCache(path: string): UpdateCheckCache | undefined {
  try {
    if (statSync(path).size > MAX_CACHE_BYTES) return undefined;
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    const { checkedAt, latest } = parsed as { checkedAt?: unknown; latest?: unknown };
    if (typeof checkedAt !== 'string') return undefined;
    const time = Date.parse(checkedAt);
    if (!Number.isFinite(time)) return undefined;
    return { checkedAt: time, latest: parseSemver(latest) === undefined ? undefined : (latest as string) };
  } catch {
    return undefined;
  }
}

/**
 * Writes the cache atomically, owner-only: a temp file created exclusively with
 * mode 0600 and renamed over the target, so a reader never sees half a file and
 * a concurrent run cannot corrupt it. Best effort; a failure is swallowed.
 */
function writeCache(path: string, cache: { checkedAt: number; latest: string | undefined }): void {
  const dir = dirname(path);
  const tmp = `${path}.${String(process.pid)}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const body = {
      checkedAt: new Date(cache.checkedAt).toISOString(),
      ...(cache.latest !== undefined ? { latest: cache.latest } : {}),
    };
    writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    renameSync(tmp, path);
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // Nothing useful to do.
    }
  }
}

// -----------------------------------------------------------------------------
// The run integration
// -----------------------------------------------------------------------------

/**
 * Seams for the update check that `run` starts; every field defaults to the real
 * process. A test passes these instead of mutating `process.env`, `HOME` or
 * the clock.
 *
 * @stability experimental
 */
export interface UpdateCheckContext {
  /** Defaults to `process.env` (`CI`, `<PREFIX>_NO_UPDATE_CHECK`). */
  env?: NodeJS.ProcessEnv | undefined;
  /** The home directory the cache lives under. Defaults to `os.homedir()`. */
  home?: string | undefined;
  /** Where the notice is written, and whose `isTTY` is read. Defaults to `process.stderr`. */
  stderr?:
    | (TtyLike & {
        /** Writes the one-line notice. */
        write(chunk: string): unknown;
      })
    | undefined;
  /** The clock, in epoch milliseconds. Defaults to `Date.now`. */
  now?: (() => number) | undefined;
}

/**
 * What {@link beginUpdateCheck} returns.
 *
 * @internal
 */
export interface UpdateCheckHandle {
  /**
   * Call once, after the command has finished. Waits at most what is left of
   * the timeout for the fetch, stores the answer and writes the notice when a
   * newer version exists. Resolves always; never throws.
   */
  finish(): Promise<void>;
}

const NOOP_HANDLE: UpdateCheckHandle = Object.freeze({ finish: async () => undefined });

/** The one line. `latest` and `current` are proven semver by the caller. */
export function formatUpdateNotice(latest: string, current: string, upgradeHint: string): string {
  return `${cliName()} ${latest} is available (you have ${current}). Update: ${upgradeHint}\n`;
}

/**
 * Starts the update check for one `run()`. Call it before the command runs and
 * `finish()` after; in between nothing waits on the network.
 *
 * Returns a no-op handle (reading nothing, starting nothing) when the feature
 * is off, when the invocation is one of the skipped kinds, or on any error.
 *
 * @param argv - The arguments of this run.
 * @param ctx - Seams; defaults to the real process.
 * @internal
 */
export function beginUpdateCheck(argv: readonly string[], ctx?: UpdateCheckContext): UpdateCheckHandle {
  try {
    const notice = getUpdateNotice();
    if (notice === undefined) return NOOP_HANDLE;

    const env = ctx?.env ?? process.env;
    const stderr = ctx?.stderr ?? process.stderr;
    const now = ctx?.now ?? Date.now;
    if (updateCheckSkipReason(argv, env, stderr) !== undefined) return NOOP_HANDLE;

    const current = cliVersion();
    if (parseSemver(current) === undefined) return NOOP_HANDLE;

    const cachePath = updateCheckCachePath(ctx?.home !== undefined ? { home: ctx.home } : {});
    const cache = readCache(cachePath);

    const announce = (latest: string | undefined): void => {
      try {
        if (latest !== undefined && isNewerVersion(latest, current)) {
          stderr.write(formatUpdateNotice(latest, current, notice.upgradeHint));
        }
      } catch {
        // A closed or broken stderr must not fail a command that succeeded.
      }
    };

    const started = now();
    // A cache dated in the future (a clock set back, an edited file) is stale:
    // trusting it would suppress the check until that date.
    const fresh = cache !== undefined && cache.checkedAt <= started && started - cache.checkedAt < notice.intervalMs;
    if (fresh) {
      return { finish: async () => announce(cache.latest) };
    }

    // THE FETCH STARTS NOW, in parallel with the command, and is not awaited here.
    const controller = new AbortController();
    const work: Promise<string | undefined> = (async () => {
      try {
        const value = await notice.latestVersion(controller.signal);
        return parseSemver(value) === undefined ? undefined : value;
      } catch {
        return undefined;
      }
    })();

    // The deadline is counted from the start, so a command that ran longer than
    // the timeout leaves nothing to wait for. The timer is NOT unref'd: while
    // `finish` awaits a promise that no handle backs (a `latestVersion` that
    // never settles), an unref'd timer would let Node exit mid-await and drop
    // the exit code. It is cleared in `finish`.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const TIMED_OUT = Symbol('timed out');
    const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(TIMED_OUT);
      }, notice.timeoutMs);
    });

    return {
      finish: async () => {
        try {
          // `work` first: when both are settled, the answer wins over the deadline.
          const outcome = await Promise.race([work, deadline]);
          const fetched = outcome === TIMED_OUT ? undefined : outcome;
          // A failed check keeps the last known version: it is stale, but still
          // true, and recording the attempt is what stops an offline server from
          // retrying on every command.
          const latest = fetched ?? cache?.latest;
          writeCache(cachePath, { checkedAt: started, latest });
          announce(latest);
        } catch {
          // Swallowed: see rule 3.
        } finally {
          if (timer !== undefined) clearTimeout(timer);
          controller.abort();
        }
      },
    };
  } catch {
    return NOOP_HANDLE;
  }
}
