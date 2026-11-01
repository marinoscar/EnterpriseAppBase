// Turning a failed sharing call into something a person can read (issue #731).
//
// kvox's `shareErrorMessage` approach: show the API's own `message` (it is
// written for people and safe to show), except where the UI can say something
// more useful for a known reason (a 429's wait, a stale version).

import { isPlatformApiError } from '../../core/index.js';
import type { SharingError } from './types.js';

function reasonOf(details: unknown, code: string | undefined): string | null {
  if (details !== null && typeof details === 'object') {
    const reason = (details as { reason?: unknown }).reason;
    if (typeof reason === 'string' && reason.length > 0) return reason;
  }
  return code ?? null;
}

function retryAfterOf(details: unknown): number | null {
  if (details !== null && typeof details === 'object') {
    const ms = (details as { retryAfterMs?: unknown }).retryAfterMs;
    if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) return Math.ceil(ms / 1000);
  }
  return null;
}

/**
 * A wait in plain language: "a few seconds", "about a minute", "about 3 minutes".
 *
 * @param seconds - the wait, in seconds.
 * @returns the phrase.
 *
 * @stability experimental
 */
export function describeRetryAfter(seconds: number): string {
  if (seconds < 45) return 'a few seconds';
  const minutes = Math.round(seconds / 60);
  if (minutes <= 1) return 'about a minute';
  if (minutes < 60) return `about ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours <= 1 ? 'about an hour' : `about ${hours} hours`;
}

/**
 * Normalises whatever a sharing call rejected with into a {@link SharingError}.
 *
 * @param error - the rejection (a `PlatformApiError`, a network failure, anything).
 * @param fallback - the message when the error carries none.
 * @returns the normalised error.
 *
 * @example
 * ```ts
 * try { await actions.revoke(id); } catch (err) { setError(toSharingError(err).message); }
 * ```
 *
 * @stability experimental
 */
export function toSharingError(error: unknown, fallback = 'Something went wrong. Try again.'): SharingError {
  if (isSharingError(error)) return error;
  if (isPlatformApiError(error)) {
    const reason = reasonOf(error.details, error.code);
    const retryAfterSeconds = error.status === 429 ? (retryAfterOf(error.details) ?? null) : null;
    let message = error.message || fallback;
    if (error.status === 429) {
      message =
        retryAfterSeconds === null
          ? 'Too many attempts. Wait a little, then try again.'
          : `Too many attempts. Try again in ${describeRetryAfter(retryAfterSeconds)}.`;
    } else if (reason === 'VERSION_CONFLICT') {
      message = 'Someone else changed this since you opened it. Reload to see the latest version, then try again.';
    }
    return { message, status: error.status, reason, retryAfterSeconds, details: error.details };
  }
  return { message: fallback, status: null, reason: null, retryAfterSeconds: null, details: undefined };
}

/**
 * Whether `value` is already a {@link SharingError} (the shape the hooks' actions reject with).
 *
 * @param value - anything.
 * @returns `true` for a normalised sharing error.
 *
 * @stability experimental
 */
export function isSharingError(value: unknown): value is SharingError {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<SharingError>;
  return (
    typeof candidate.message === 'string' &&
    'reason' in candidate &&
    'retryAfterSeconds' in candidate &&
    (candidate.status === null || typeof candidate.status === 'number')
  );
}
