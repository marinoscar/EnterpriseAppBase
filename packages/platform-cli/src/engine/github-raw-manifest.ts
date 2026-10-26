import { UsageError } from './errors.js';
import { parseSemver } from './semver.js';

// =============================================================================
// githubRawManifest: where the newest version is read from  (issue #1033)
// =============================================================================
//
// The common source of "what is the newest CLI" is the `version` field of a
// `package.json` on the app's default branch. `githubRawManifest` builds the
// `latestVersion` function of `createCli({ updateNotice })` for that.
//
// WHAT IT WILL AND WILL NOT DO, each with the reason:
//   - HTTPS to `raw.githubusercontent.com` only. The host and scheme are
//     constants; no input chooses them.
//   - NO CREDENTIALS. No `Authorization`, no cookie, no token from the CLI's
//     config. A private repository answers 404 and the check stays silent:
//     sending the operator's token to a third-party host from a convenience
//     feature is not a trade this makes.
//   - NO REDIRECTS. `redirect: 'error'`, so a response can never move the
//     request to another host or to plain http.
//   - THE BODY IS CAPPED (256 KiB) while it is read, not after: a hostile or
//     broken endpoint cannot make a CLI start-up buffer megabytes.
//   - ONLY A VALID SEMVER `version` IS ACCEPTED. Anything else (bad JSON, a
//     missing or non-string version, `v1.2.3`, a version with control
//     characters) is `undefined`, because the value is printed on a terminal.
//   - IT NEVER THROWS. Offline, DNS failure, timeout, 404, 5xx, oversize and
//     garbage are all `undefined`; the notice is a convenience, not a gate.
//   - IT HONOURS THE CALLER'S SIGNAL AND ITS OWN TIMEOUT, and also stops
//     waiting at the deadline when a `fetch` replacement ignores both.
// =============================================================================

/** The largest response body read, in bytes. A package.json is a few KiB. */
export const MAX_MANIFEST_BYTES = 256 * 1024;

/** Default time allowed for the request and the body, in milliseconds. */
export const DEFAULT_MANIFEST_TIMEOUT_MS = 1500;

const RAW_HOST = 'https://raw.githubusercontent.com';

/** GitHub's own limits: an owner is alphanumeric and hyphens; a repository adds `.` and `_`. */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
/** A ref or path segment: plain characters, no separators, no space, no `%`. */
const SEGMENT = /^[A-Za-z0-9._@+-]+$/;

/**
 * Options of {@link githubRawManifest}.
 *
 * @stability experimental
 */
export interface GithubRawManifestOptions {
  /** The repository, `owner/name`. */
  repo: string;
  /** The branch, tag or commit to read. Default `main`. A branch with slashes (`release/1.x`) is allowed. */
  ref?: string | undefined;
  /** The manifest's path in the repository, e.g. `apps/cli/package.json`. */
  path: string;
  /** Time allowed for the request and the body. Default 1500 ms. */
  timeoutMs?: number | undefined;
  /** Replaces the global `fetch` (Node 18+). A seam for tests; the default is the real one. */
  fetch?: typeof fetch | undefined;
}

function assertSegments(label: string, value: string, what: string): void {
  const segments = value.split('/');
  if (
    value === '' ||
    value.startsWith('/') ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..' || !SEGMENT.test(segment))
  ) {
    throw new UsageError(`githubRawManifest ${label} ${JSON.stringify(value)} is not ${what}.`);
  }
}

/**
 * The URL a manifest is read from, after validating every part.
 *
 * @throws UsageError when `repo` is not `owner/name`, or `ref` / `path` is not a plain relative path.
 * @internal
 */
export function githubRawManifestUrl(options: Pick<GithubRawManifestOptions, 'repo' | 'ref' | 'path'>): string {
  const repo = options.repo;
  const parts = typeof repo === 'string' ? repo.split('/') : [];
  if (
    parts.length !== 2 ||
    !OWNER.test(parts[0] as string) ||
    !REPO_NAME.test(parts[1] as string) ||
    parts[1] === '.' ||
    parts[1] === '..'
  ) {
    throw new UsageError(`githubRawManifest repo ${JSON.stringify(repo)} is not "owner/name".`);
  }
  const ref = options.ref ?? 'main';
  assertSegments('ref', ref, 'a branch, tag or commit name');
  assertSegments('path', options.path, 'a plain relative path such as "apps/cli/package.json"');
  return `${RAW_HOST}/${parts[0] as string}/${parts[1] as string}/${ref}/${options.path}`;
}

/** Reads at most `MAX_MANIFEST_BYTES` of the body; `undefined` when it is larger or unreadable. */
async function readCappedText(response: Response): Promise<string | undefined> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_MANIFEST_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  const body = response.body;
  if (body === null) return undefined;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_MANIFEST_BYTES) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/** The `version` of a manifest's JSON text, only when it is a valid semver string. */
function versionOf(text: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const version = (parsed as { version?: unknown }).version;
  return parseSemver(version) === undefined ? undefined : (version as string);
}

/**
 * Builds the `latestVersion` function of `createCli({ updateNotice })` that
 * reads `version` from a JSON manifest in a GitHub repository:
 * `https://raw.githubusercontent.com/<repo>/<ref>/<path>`.
 *
 * The returned function resolves the manifest's `version` when it is a valid
 * semver string, and `undefined` for everything else (offline, timeout, a
 * non-200 status, an oversized or malformed body, a missing or invalid
 * version). It never rejects. It sends no credentials, follows no redirect and
 * reads at most 256 KiB. See the file header for the reasons.
 *
 * @param options - The repository, ref, path, timeout and the `fetch` seam.
 * @returns A `latestVersion` function; it takes an optional `AbortSignal` that
 *   `createCli` aborts at the update-check deadline.
 * @throws UsageError when `repo` is not `owner/name`, or `ref` or `path` is not
 *   a plain relative path (no `..`, no empty segment, no space or `%`), or
 *   `timeoutMs` is not a positive number.
 * @example
 * ```ts
 * createCli({
 *   ...APP_CLI_OPTIONS,
 *   updateNotice: {
 *     latestVersion: githubRawManifest({ repo: 'acme/coach', path: 'apps/cli/package.json' }),
 *     upgradeHint: 'git pull && npm ci && npm run build',
 *   },
 * });
 * ```
 * @stability experimental
 */
export function githubRawManifest(options: GithubRawManifestOptions): (signal?: AbortSignal) => Promise<string | undefined> {
  const url = githubRawManifestUrl(options);
  const timeoutMs = options.timeoutMs ?? DEFAULT_MANIFEST_TIMEOUT_MS;
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new UsageError('githubRawManifest timeoutMs must be a positive number of milliseconds.');
  }

  return async (signal?: AbortSignal): Promise<string | undefined> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onCallerAbort = (): void => controller.abort();
    try {
      if (signal?.aborted === true) return undefined;
      signal?.addEventListener('abort', onCallerAbort, { once: true });

      // Resolves `undefined` at the deadline or on abort, so a `fetch`
      // replacement that ignores the signal cannot hold this function open.
      const stopped = new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(undefined);
        }, timeoutMs);
        controller.signal.addEventListener('abort', () => resolve(undefined), { once: true });
      });

      const work = (async (): Promise<string | undefined> => {
        const doFetch = options.fetch ?? globalThis.fetch;
        const response = await doFetch(url, {
          method: 'GET',
          redirect: 'error',
          credentials: 'omit',
          headers: { accept: 'application/json, text/plain;q=0.9' },
          signal: controller.signal,
        });
        if (response.status !== 200) {
          await response.body?.cancel().catch(() => undefined);
          return undefined;
        }
        const text = await readCappedText(response);
        return text === undefined ? undefined : versionOf(text);
      })();
      // The losing branch must not become an unhandled rejection.
      work.catch(() => undefined);

      return await Promise.race([work, stopped]);
    } catch {
      return undefined;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onCallerAbort);
    }
  };
}
