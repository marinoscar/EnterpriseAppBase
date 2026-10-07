import { Logger } from '@nestjs/common';

// =============================================================================
// `AUTH_PRINCIPAL_CACHE_TTL_SECONDS` (PP-1.12, issue #683)
// =============================================================================
//
// A DEPLOYMENT-LEVEL PERFORMANCE KNOB, not a runtime-configured feature: it
// trades a bounded staleness window (only when the event bus is down) for one
// fewer four-level join per JWT request. It must be known at boot, before the
// first request, so it is an environment variable like `JWT_ACCESS_TTL_MINUTES`.
//
//   - unset            → the default, 30 seconds;
//   - a whole number   → that many seconds; `0` disables the cache entirely,
//                        which is exactly the behaviour before this cache;
//   - anything else    → 30, with ONE warning. A typo must not silently turn
//                        the cache off (or into a day-long TTL); the default
//                        is the safe, documented value.
// =============================================================================

/**
 * The principal cache's TTL when `AUTH_PRINCIPAL_CACHE_TTL_SECONDS` is unset or invalid.
 *
 * @stability stable
 */
export const DEFAULT_PRINCIPAL_CACHE_TTL_SECONDS = 30;

const logger = new Logger('PrincipalCache');

/**
 * Pure apart from the one warning: the TTL, in seconds, for a configured value.
 *
 * @param raw - `AUTH_PRINCIPAL_CACHE_TTL_SECONDS`.
 * @returns a non-negative whole number of seconds (0 disables the cache).
 *
 * @stability stable
 */
export function parsePrincipalCacheTtlSeconds(raw: unknown): number {
  if (raw === undefined || raw === null) {
    return DEFAULT_PRINCIPAL_CACHE_TTL_SECONDS;
  }

  const configured = String(raw).trim();
  if (configured === '') {
    return DEFAULT_PRINCIPAL_CACHE_TTL_SECONDS;
  }

  if (/^\d+$/.test(configured)) {
    const seconds = Number(configured);
    if (Number.isSafeInteger(seconds)) {
      return seconds;
    }
  }

  logger.warn(
    `Invalid AUTH_PRINCIPAL_CACHE_TTL_SECONDS "${configured}"; expected a non-negative whole ` +
      `number of seconds (0 disables the cache). Using ${DEFAULT_PRINCIPAL_CACHE_TTL_SECONDS}.`,
  );
  return DEFAULT_PRINCIPAL_CACHE_TTL_SECONDS;
}
