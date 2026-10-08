import { createHmac, timingSafeEqual } from 'node:crypto';

import { deriveSigningKey } from '../../core/index';

// =============================================================================
// Signed download tokens (#746; MemoriaHub's format)
// =============================================================================
//
// `<base64url(payload)>.<base64url(mac)>`: payload = version (1 byte) ||
// releaseId (16) || userId (16) || expiresAt (uint32 BE, epoch seconds); mac =
// the first 24 bytes of HMAC-SHA256 over the payload. Bound to the release
// and the requesting user, valid for ten minutes. Never logged: the token IS
// the capability.
//
// The key is the core's `deriveSigningKey(DOWNLOAD_TOKEN_KEY_PURPOSE)`, a
// sub-key of SECRETS_ENCRYPTION_KEY (no new environment variable). Changing
// the purpose label, or rotating the master key, invalidates every
// outstanding link, which is acceptable: links live ten minutes.
// =============================================================================

/**
 * The signing domain of download tokens. Permanent in practice: changing it
 * invalidates the links in flight (harmless, they are short-lived).
 *
 * @stability experimental
 */
export const DOWNLOAD_TOKEN_KEY_PURPOSE = 'android-app-download';

const VERSION = 0x01;
const PAYLOAD_BYTES = 1 + 16 + 16 + 4;
const MAC_BYTES = 24;
const MAX_TOKEN_LENGTH = 128;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What a token proves.
 *
 * @stability experimental
 */
export interface DownloadTokenClaims {
  /** The release. */
  releaseId: string;
  /** The user it was issued to. */
  userId: string;
  /** Expiry, epoch seconds. */
  expiresAt: number;
}

/**
 * A verification outcome.
 *
 * @stability experimental
 */
export type DownloadTokenVerdict =
  | {
      /** Valid and unexpired. */
      ok: true;
      /** What the token names. */
      claims: DownloadTokenClaims;
    }
  | {
      /** Refused. */
      ok: false;
      /** `invalid` (malformed or tampered) or `expired`. */
      reason: 'invalid' | 'expired';
    };

function uuidToBytes(value: string): Buffer {
  if (!UUID.test(value)) throw new Error('Download token ids must be UUIDs');
  return Buffer.from(value.replace(/-/g, ''), 'hex');
}

function bytesToUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function mac(key: Buffer, payload: Buffer): Buffer {
  return createHmac('sha256', key).update(payload).digest().subarray(0, MAC_BYTES);
}

/**
 * The key tokens are signed with.
 *
 * @returns the 32-byte sub-key.
 *
 * @stability experimental
 */
export function downloadTokenKey(): Buffer {
  return deriveSigningKey(DOWNLOAD_TOKEN_KEY_PURPOSE);
}

/**
 * Signs a token.
 *
 * @param key - the signing key.
 * @param claims - what it grants.
 * @returns the token.
 * @throws Error when an id is not a UUID.
 *
 * @stability experimental
 */
export function signDownloadToken(key: Buffer, claims: DownloadTokenClaims): string {
  const payload = Buffer.alloc(PAYLOAD_BYTES);
  payload.writeUInt8(VERSION, 0);
  uuidToBytes(claims.releaseId).copy(payload, 1);
  uuidToBytes(claims.userId).copy(payload, 17);
  payload.writeUInt32BE(claims.expiresAt, 33);
  return `${payload.toString('base64url')}.${mac(key, payload).toString('base64url')}`;
}

/**
 * Verifies a token in constant time.
 *
 * @param key - the signing key.
 * @param token - the token from the URL.
 * @param nowSeconds - the clock, epoch seconds.
 * @returns the claims, or why it is refused.
 *
 * @stability experimental
 */
export function verifyDownloadToken(key: Buffer, token: string, nowSeconds: number): DownloadTokenVerdict {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: 'invalid' };
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'invalid' };
  const payload = Buffer.from(parts[0], 'base64url');
  const given = Buffer.from(parts[1], 'base64url');
  if (payload.length !== PAYLOAD_BYTES || given.length !== MAC_BYTES) return { ok: false, reason: 'invalid' };
  if (!timingSafeEqual(given, mac(key, payload))) return { ok: false, reason: 'invalid' };
  if (payload.readUInt8(0) !== VERSION) return { ok: false, reason: 'invalid' };
  const expiresAt = payload.readUInt32BE(33);
  if (expiresAt <= nowSeconds) return { ok: false, reason: 'expired' };
  return {
    ok: true,
    claims: { releaseId: bytesToUuid(payload.subarray(1, 17)), userId: bytesToUuid(payload.subarray(17, 33)), expiresAt },
  };
}
