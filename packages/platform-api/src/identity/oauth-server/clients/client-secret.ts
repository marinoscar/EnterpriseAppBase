// Client id and secret generation for dynamic and pre-registered clients (PP-15.5).
// The secret is shown once and stored as a SHA-256 hex digest, exactly as the
// token endpoint compares it (oauth-token.service.ts).

import { createHash, randomBytes } from 'node:crypto';

/** A new public `client_id`: `oc_` and 24 random characters. */
export function newClientId(): string {
  return `oc_${randomBytes(18).toString('base64url')}`;
}

/** A new client secret (256 bits). */
export function newClientSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** The stored form of a secret. */
export function hashClientSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
