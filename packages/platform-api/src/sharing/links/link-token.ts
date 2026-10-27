// =============================================================================
// Link-share tokens: minting, hashing, the cipher domain (issue #730). Internal.
// =============================================================================
//
//   token       `lnk_` + base64url(32 random bytes): 47 characters. The prefix
//               follows the `nod_` / `pat_` convention so secret scanning can
//               recognise a leaked one.
//   hash        SHA-256 hex of the whole token: the lookup key
//               (`grants.link_token_hash`, unique), like a PAT's `tokenHash`.
//   ciphertext  `encryptSecret(token, 'sharing.link:' + grantId)`: lets the
//               grantor copy the link again. The grant id is chosen BEFORE the
//               insert, so the cipher domain binds the row: a ciphertext copied
//               onto another row fails authentication.
//
// None of these values is ever logged, put on a span, an audit row or an
// error body.
// =============================================================================

import { createHash, randomBytes } from 'node:crypto';

import { LINK_TOKEN_PATTERN, LINK_TOKEN_PREFIX } from '@marinoscar/platform-contract/sharing';

/** Random bytes in a token. */
const TOKEN_BYTES = 32;

/** The cipher domain prefix of a link token's ciphertext. */
export const LINK_TOKEN_CIPHER_DOMAIN = 'sharing.link:';

/** A fresh token: `lnk_` and 43 base64url characters. */
export function mintLinkToken(): string {
  return `${LINK_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`;
}

/** Whether `value` is a well-formed token (checked before any lookup). */
export function isLinkToken(value: unknown): value is string {
  return typeof value === 'string' && LINK_TOKEN_PATTERN.test(value);
}

/** The lookup hash of a token: SHA-256, hex. */
export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** The cipher domain of one link grant's token. */
export function linkTokenPurpose(grantId: string): string {
  return `${LINK_TOKEN_CIPHER_DOMAIN}${grantId}`;
}
