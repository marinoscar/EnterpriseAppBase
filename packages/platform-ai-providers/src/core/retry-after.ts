// =============================================================================
// Retry-After parsing (moved from the platform's jobs/rate-limit.error.ts, #991)
// =============================================================================
//
// The provider error mappers read a throttle's `Retry-After` header with
// this. It lived in `@marinoscar/platform-api/jobs` (the queue reads the same
// header from errors it classifies); it moved here so the adapters run
// without the platform, and `@marinoscar/platform-api/jobs` re-exports this
// very function under the same name, so there is still exactly one
// implementation.
// =============================================================================

/**
 * Parses an HTTP `Retry-After` header value into milliseconds.
 *
 * RFC 9110 allows exactly two forms and this accepts both, because providers
 * genuinely use both:
 *
 *   - `Retry-After: 120`      — delta-seconds → 120000
 *   - `Retry-After: Wed, 21 Oct 2015 07:28:00 GMT` — an HTTP-date, converted
 *     to a delay RELATIVE TO `now` (which is a parameter so tests can pin it,
 *     and so a caller that already has a clock does not disagree with this
 *     function about what time it is).
 *
 * Returns `null` for absent, empty, unparseable, or nonsensical input —
 * INCLUDING a date already in the past, which is not an error but does not
 * describe a wait. `null` means "no opinion", and the caller falls back to
 * pure backoff; it never means zero, because a provider that said nothing
 * must not be read as a provider that said "retry immediately".
 *
 * A negative delta-seconds is also `null` for the same reason. A fractional
 * value (`0.5`) is rejected too: the grammar is DIGIT-only, so a fractional
 * value means the header is not what we think it is, and guessing at a
 * malformed header is how a 500ms wait gets read as a 500-second one.
  *
  * @stability experimental
 */
export function parseRetryAfterMs(
  header: string | number | null | undefined,
  now: number = Date.now()
): number | null {
  if (header === null || header === undefined) {
    return null;
  }

  const raw = String(header).trim();

  if (raw.length === 0) {
    return null;
  }

  // Form 1: delta-seconds. Anchored and digit-only, deliberately — `parseInt`
  // would happily read `30 minutes` as 30 and `1e3` as 1.
  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw);

    return Number.isFinite(seconds) ? seconds * 1000 : null;
  }

  // Form 2: HTTP-date.
  const timestamp = Date.parse(raw);

  if (Number.isNaN(timestamp)) {
    return null;
  }

  const delta = timestamp - now;

  // A date at or before `now` describes no wait at all. See the doc comment:
  // that is "no opinion", not "zero".
  return delta > 0 ? delta : null;
}
