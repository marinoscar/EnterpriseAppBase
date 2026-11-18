// Display rules shared by the OAuth pages (PP-15.7, #1185). Slice-internal.
//
// Everything a client sent is SELF-ASSERTED (its name, its logo): the pages
// lead with the host, which the server derived, and render the rest as plain
// text only. Nothing here builds markup from a string.

/** An exact lower-case host name (the `allowedClientHosts` rule of the `oauthServer` settings schema). */
const HOST_PATTERN = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

/**
 * Whether `value` is an exact host name the server accepts in
 * `allowedClientHosts`: lower case, no scheme, port, path or wildcard.
 *
 * @param value - the candidate.
 * @returns `true` for a valid host.
 */
export function isValidClientHost(value: string): boolean {
  return HOST_PATTERN.test(value);
}

/**
 * Why `value` is not a host the settings accept, or `null` when it is.
 *
 * @param value - what the administrator typed (trimmed).
 * @returns the sentence to show, or `null`.
 */
export function clientHostProblem(value: string): string | null {
  if (value === '') return 'Enter a host name.';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return 'Enter the host only, without https://.';
  if (value.includes('*')) return 'Wildcards are not allowed. Enter one exact host.';
  if (/[/:?#@]/.test(value)) return 'Enter the host only, without a port or a path.';
  if (value !== value.toLowerCase()) return 'Use lower case.';
  if (!isValidClientHost(value)) return 'Enter a host name such as app.example.test.';
  return null;
}

/**
 * The client's logo URL when it may be shown: an `https:` URL on the client's
 * own host, with no credentials in it. Anything else is `null` and no image is
 * requested.
 *
 * @param logoUri - the self-asserted logo URL.
 * @param host - the client's host (the server derived it).
 * @returns the URL to render, or `null`.
 */
export function displayableClientLogo(logoUri: string | null | undefined, host: string): string | null {
  if (!logoUri) return null;
  let url: URL;
  try {
    url = new URL(logoUri);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.hostname.toLowerCase() !== host.toLowerCase()) return null;
  return url.href;
}

/** A client first seen less than this long ago is "new here". */
export const NEW_CLIENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Whether the client is new on this deployment: first seen under 24 hours ago.
 *
 * @param firstSeenAt - ISO 8601.
 * @param now - the clock.
 * @returns `true` when new.
 */
export function isNewClient(firstSeenAt: string, now: number = Date.now()): boolean {
  const seen = Date.parse(firstSeenAt);
  if (Number.isNaN(seen)) return false;
  return now - seen < NEW_CLIENT_WINDOW_MS;
}

const UNITS: { limit: number; ms: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { limit: 3_600_000, ms: 60_000, unit: 'minute' },
  { limit: 86_400_000, ms: 3_600_000, unit: 'hour' },
  { limit: 604_800_000, ms: 86_400_000, unit: 'day' },
  { limit: 2_629_800_000, ms: 604_800_000, unit: 'week' },
  { limit: 31_557_600_000, ms: 2_629_800_000, unit: 'month' },
  { limit: Infinity, ms: 31_557_600_000, unit: 'year' },
];

/**
 * "3 minutes ago": the fallback when the platform host gives no
 * `formatRelativeTime` (the same rules as the reference app's helper).
 *
 * @param iso - ISO 8601.
 * @param now - the clock.
 * @returns the phrase, or the input when unparseable.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  const elapsed = now - time;
  if (elapsed < 60_000) return 'Just now';
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const { limit, ms, unit } of UNITS) {
    if (elapsed < limit) return formatter.format(-Math.floor(elapsed / ms), unit);
  }
  return iso;
}
