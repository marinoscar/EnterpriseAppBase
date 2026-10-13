// =============================================================================
// CORS policy from CORS_ORIGIN  (issue #517)
// =============================================================================
//
// The application is SAME-ORIGIN by design: nginx serves the web app at `/` and
// the API at `/api`, and the Vite dev server proxies `/api` the same way. The
// `appctl` CLI and worker nodes are not browsers, so CORS never applies to them.
// No first-party caller therefore needs a single CORS header.
//
// The previous `origin: process.env.CORS_ORIGIN || true` with
// `credentials: true` REFLECTED ANY ORIGIN with credentials allowed, because
// CORS_ORIGIN was set nowhere: every website on the internet was a trusted
// cross-origin caller of this API. This module replaces it with a closed
// default and an explicit allowlist.
//
//   unset / empty / only commas  -> `{ origin: false }`: no CORS headers at
//                                   all, so browsers enforce same-origin.
//   `https://a.example,https://b.example`
//                                -> `{ origin: [...], credentials: true }`:
//                                   exactly those origins, nothing reflected.
//
// Misconfiguration THROWS, and is meant to be called during bootstrap so the
// process exits before binding the port (the same posture as the
// TEST_AUTH_ENABLED guard and the SECRETS_ENCRYPTION_KEY check in main.ts):
//
//   - `*` anywhere in the list. A credentialed wildcard is never valid - browsers
//     refuse it - and "allow everyone with cookies" is the bug this replaces.
//   - An entry that is not exactly a serialized origin (`scheme://host[:port]`,
//     http or https, lowercase host, no default port, no path, no trailing
//     slash). The browser's `Origin` header is compared byte for byte, so
//     `https://app.example.com/` or `https://App.example.com` would silently
//     never match; failing loudly at startup beats a CORS error in a browser
//     console nobody connects to this variable.
//
// Pure: no process.env, no logging. main.ts passes the raw value in and logs
// the resulting mode.
// =============================================================================

/**
 * No CORS headers are emitted; the browser's same-origin policy applies.
 *
 * @stability experimental
 */
export interface SameOriginCorsOptions {
  /** `false`: emit no CORS headers. */
  origin: false;
}

/**
 * Exactly these origins may call the API cross-origin, with credentials.
 *
 * @stability experimental
 */
export interface AllowlistCorsOptions {
  /** The exact serialized origins allowed, deduplicated in first-seen order. */
  origin: string[];
  /** Always `true`: cookies and authorization headers are allowed for those origins. */
  credentials: true;
}

/**
 * The CORS settings an app may add to the allowlist policy (`buildCorsOptions`'s
 * second argument). Deliberately without `origin` and `credentials`: the origin
 * allowlist comes from `CORS_ORIGIN` alone, and a credentialed wildcard must not
 * be one argument away.
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface ExtraCorsOptions {
  /** `Access-Control-Allow-Methods`. */
  methods?: string | string[];
  /** `Access-Control-Allow-Headers`. */
  allowedHeaders?: string | string[];
  /** `Access-Control-Expose-Headers`, so a browser script may read these response headers. */
  exposedHeaders?: string | string[];
  /** `Access-Control-Max-Age`, in seconds (a non-negative integer). */
  maxAge?: number;
}

/**
 * Structurally assignable to `FastifyCorsOptions`, which
 * `NestFastifyApplication.enableCors` takes. Declared here rather than imported
 * because `@fastify/cors` is only a transitive dependency of this workspace.
 *
 * @stability experimental
 */
export type CorsOptions = (SameOriginCorsOptions | AllowlistCorsOptions) & ExtraCorsOptions;

/**
 * Raised for a CORS_ORIGIN value the API refuses to start with.
 *
 * @stability experimental
 */
export class InvalidCorsOriginError extends Error {
  constructor(message: string) {
    super(`Invalid CORS_ORIGIN: ${message}`);
    this.name = 'InvalidCorsOriginError';
  }
}

/**
 * Parses the raw CORS_ORIGIN value into the options for `app.enableCors`.
 *
 * Comma-separated; each entry is trimmed and empty entries are dropped, so
 * `" https://a.example , ,https://b.example "` yields two origins. Duplicates
 * are collapsed, keeping first-seen order.
 *
 * @param raw - the raw `CORS_ORIGIN` value (`process.env.CORS_ORIGIN`).
 * @param extra - methods, headers and max age to add (see {@link ExtraCorsOptions}).
 *   Never the origin policy: that is `raw` alone, and an `origin` or `credentials`
 *   key here throws.
 * @returns the options for `app.enableCors`.
 * @throws InvalidCorsOriginError for a wildcard or a malformed origin, or an invalid `extra`.
 *
 * @example
 * ```ts
 * app.enableCors(buildCorsOptions(process.env.CORS_ORIGIN, { exposedHeaders: ['x-request-id'], maxAge: 600 }));
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export function buildCorsOptions(raw: string | undefined, extra?: ExtraCorsOptions): CorsOptions {
  const policy = buildOriginPolicy(raw);
  return extra === undefined ? policy : { ...policy, ...validateExtra(extra) };
}

function validateExtra(extra: ExtraCorsOptions): ExtraCorsOptions {
  const out: ExtraCorsOptions = {};
  for (const key of Object.keys(extra)) {
    if (key === 'origin' || key === 'credentials') {
      throw new InvalidCorsOriginError(
        `"${key}" cannot be passed as an extra CORS option: the origin policy comes from CORS_ORIGIN alone.`,
      );
    }
    if (key !== 'methods' && key !== 'allowedHeaders' && key !== 'exposedHeaders' && key !== 'maxAge') {
      throw new InvalidCorsOriginError(`"${key}" is not a supported extra CORS option (methods, allowedHeaders, exposedHeaders, maxAge).`);
    }
  }
  for (const key of ['methods', 'allowedHeaders', 'exposedHeaders'] as const) {
    const value = extra[key];
    if (value === undefined) continue;
    const list = Array.isArray(value) ? value : [value];
    if (list.length === 0 || list.some((entry) => typeof entry !== 'string' || entry.trim() === '' || /[\r\n]/.test(entry))) {
      throw new InvalidCorsOriginError(`${key} must be a non-empty string or an array of non-empty strings without line breaks.`);
    }
    out[key] = Array.isArray(value) ? [...value] : value;
  }
  if (extra.maxAge !== undefined) {
    if (!Number.isInteger(extra.maxAge) || extra.maxAge < 0) {
      throw new InvalidCorsOriginError('maxAge must be a non-negative integer (seconds).');
    }
    out.maxAge = extra.maxAge;
  }
  return out;
}

function buildOriginPolicy(raw: string | undefined): SameOriginCorsOptions | AllowlistCorsOptions {
  const entries = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');

  if (entries.length === 0) {
    return { origin: false };
  }

  for (const entry of entries) {
    assertSerializedOrigin(entry);
  }

  return { origin: [...new Set(entries)], credentials: true };
}

/**
 * True when the options leave the API same-origin only.
 *
 * @param options - the result of {@link buildCorsOptions}.
 * @returns whether no CORS headers are emitted.
 *
 * @stability experimental
 */
export function isSameOriginOnly(
  options: CorsOptions,
): options is SameOriginCorsOptions {
  return options.origin === false;
}

function assertSerializedOrigin(entry: string): void {
  if (entry.includes('*')) {
    throw new InvalidCorsOriginError(
      `"${entry}" is a wildcard. The API sends credentials (the refresh-token ` +
        'cookie), and a credentialed wildcard is never valid. List each ' +
        'trusted origin explicitly, comma-separated, or leave CORS_ORIGIN ' +
        'unset for same-origin only.',
    );
  }

  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    throw new InvalidCorsOriginError(
      `"${entry}" is not a URL. Expected an origin such as ` +
        'https://app.example.com (scheme and host, optional port, no path).',
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InvalidCorsOriginError(
      `"${entry}" must use http or https. Expected an origin such as ` +
        'https://app.example.com.',
    );
  }

  if (url.origin !== entry) {
    throw new InvalidCorsOriginError(
      `"${entry}" is not an exact origin; browsers would send ` +
        `"${url.origin}", which would never match. Use the scheme and host ` +
        'only (lowercase, optional non-default port, no path, no trailing slash).',
    );
  }
}
