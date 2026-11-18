// =============================================================================
// PKCE (RFC 7636), S256 only (PP-15.4)
// =============================================================================
//
// Helpers from `node:crypto`; no OAuth library (it would own storage and HTTP and
// fight the guard and the Prisma models). `plain` is never accepted.
// =============================================================================

import { createHash, timingSafeEqual } from 'node:crypto';

/** RFC 7636 §4.1: 43 to 128 characters of `[A-Za-z0-9-._~]`. */
const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

/** A base64url SHA-256 digest is exactly 43 characters. */
const CHALLENGE_PATTERN = /^[A-Za-z0-9\-_]{43}$/;

/**
 * `BASE64URL(SHA256(verifier))`, the S256 challenge.
 *
 * @param verifier - the code verifier.
 * @returns the challenge.
 *
 * @stability experimental
 */
export function s256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/**
 * Whether `value` is a well-formed code verifier.
 *
 * @param value - the candidate.
 * @returns `true` for 43 to 128 unreserved characters.
 *
 * @stability experimental
 */
export function isWellFormedVerifier(value: string): boolean {
  return VERIFIER_PATTERN.test(value);
}

/**
 * Whether `value` is a well-formed S256 code challenge (43 base64url characters).
 *
 * @param value - the candidate.
 * @returns `true` when it can be the digest of a verifier.
 *
 * @stability experimental
 */
export function isWellFormedChallenge(value: string): boolean {
  return CHALLENGE_PATTERN.test(value);
}

/**
 * Whether `verifier` matches `challenge`: `BASE64URL(SHA256(verifier))` compared
 * in constant time. A malformed verifier never matches.
 *
 * @param verifier - the verifier the client sent.
 * @param challenge - the challenge stored with the code.
 * @returns `true` when they match.
 *
 * @stability experimental
 */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!isWellFormedVerifier(verifier)) return false;
  const expected = Buffer.from(challenge, 'utf8');
  const actual = Buffer.from(s256Challenge(verifier), 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
