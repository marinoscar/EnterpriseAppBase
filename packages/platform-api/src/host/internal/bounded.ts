// =============================================================================
// Bounded, secret-free values for surfaces an extension fills in
// =============================================================================
//
// The health probes are PUBLIC (no authentication) and the About report and the
// response envelope are read by far more people than a deployment's operators,
// while the code that fills them in is the APP's. So everything an extension
// hands to those surfaces passes through this file first: a fixed number of
// keys, a key shape, a value shape, a length cap, and a refusal of anything
// that is named like a credential or looks like a URL with a password in it.
//
// This is a safety net, not a licence: an extension must still not put a secret
// in a fact. The names are matched case-insensitively and by substring, so the
// net errs on the side of dropping a harmless `tokenCount`.
// =============================================================================

/** The shape of a fact or detail key. */
export const BOUNDED_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,47}$/;

/** Key names that look like credentials; such a key is dropped, whatever it holds. */
const SECRET_KEY_PATTERN = /(secret|token|password|passwd|credential|authorization|api[-_.]?key|private[-_.]?key|cookie)/i;

/** A `scheme://user:password@host` URL's userinfo, which is replaced. */
const URL_USERINFO_PATTERN = /\/\/[^/\s:@]+:[^/\s@]*@/g;

/** The most keys an extension may report on one surface. */
export const MAX_BOUNDED_FACTS = 16;

/** The longest string value kept; a longer one is truncated. */
export const MAX_BOUNDED_STRING = 200;

/**
 * A value an extension may report.
 *
 * @stability experimental
 */
export type BoundedFactValue = string | number | boolean;

/**
 * Bounded facts.
 *
 * @stability experimental
 */
export type BoundedFacts = Record<string, BoundedFactValue>;

/**
 * Whether `key` is an acceptable fact key (right shape, not credential-like).
 *
 * @param key - the candidate key.
 * @returns whether it may be reported.
 */
export function isReportableKey(key: string): boolean {
  return BOUNDED_KEY_PATTERN.test(key) && !SECRET_KEY_PATTERN.test(key);
}

/**
 * Keeps at most {@link MAX_BOUNDED_FACTS} entries of `raw` whose key is
 * reportable and whose value is a string (redacted and truncated), a finite
 * number or a boolean. Everything else is dropped. Never throws.
 *
 * @param raw - whatever the extension returned.
 * @param reserved - keys the surface owns, which are dropped.
 * @returns a fresh object.
 */
export function boundFacts(raw: unknown, reserved: readonly string[] = []): BoundedFacts {
  const out: BoundedFacts = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let kept = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (kept >= MAX_BOUNDED_FACTS) break;
    if (reserved.includes(key) || !isReportableKey(key)) continue;
    if (typeof value === 'string') {
      const redacted = value.replace(URL_USERINFO_PATTERN, '//***@');
      out[key] = redacted.length > MAX_BOUNDED_STRING ? `${redacted.slice(0, MAX_BOUNDED_STRING - 1)}…` : redacted;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === 'boolean') {
      out[key] = value;
    } else {
      continue;
    }
    kept += 1;
  }
  return out;
}

/** Thrown by {@link withTimeout}. */
export class BoundedTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`timed out after ${timeoutMs}ms`);
    this.name = 'BoundedTimeoutError';
  }
}

/**
 * Settles with `work` or rejects with {@link BoundedTimeoutError} after
 * `timeoutMs`, whichever comes first. The timer never keeps the process alive.
 *
 * @param work - the value or promise to wait for.
 * @param timeoutMs - the cap, in milliseconds.
 * @returns the value.
 */
export async function withTimeout<T>(work: T | Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new BoundedTimeoutError(timeoutMs)), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([Promise.resolve(work), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
