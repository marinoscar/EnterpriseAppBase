// =============================================================================
// Webhook signing and verification (Standard Webhooks, scheme v1)
// =============================================================================
//
// HMAC-SHA256 over `${id}.${timestamp}.${body}` with the base64-decoded key of
// a `whsec_<base64>` secret. Web Crypto only (`globalThis.crypto.subtle`), so
// it runs in Node and in a browser. Zod-free.
// =============================================================================

import {
  WEBHOOK_DEFAULT_TOLERANCE_SECONDS,
  WEBHOOK_SECRET_PREFIX,
  WEBHOOK_SIGNATURE_VERSION,
} from './constants.js';

const encoder = new TextEncoder();

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const raw = secret.startsWith(WEBHOOK_SECRET_PREFIX) ? secret.slice(WEBHOOK_SECRET_PREFIX.length) : secret;
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    base64ToBytes(raw),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * Input of {@link signWebhookPayload}.
 *
 * @stability experimental
 */
export interface SignWebhookPayloadInput {
  /** The signing secret, `whsec_<base64>`. */
  secret: string;
  /** The `webhook-id` header value. */
  id: string;
  /** The `webhook-timestamp` header value (unix seconds). */
  timestamp: number | string;
  /** The exact request body. */
  body: string;
}

/**
 * Sign a body. Returns one `webhook-signature` entry, `v1,<base64>`.
 *
 * @stability experimental
 */
export async function signWebhookPayload(input: SignWebhookPayloadInput): Promise<string> {
  const mac = await hmac(input.secret, `${input.id}.${input.timestamp}.${input.body}`);
  return `${WEBHOOK_SIGNATURE_VERSION},${bytesToBase64(mac)}`;
}

/**
 * Input of {@link verifyWebhookSignature}. Give `secret`, or `secrets` to
 * accept several (a rotation overlap).
 *
 * @stability experimental
 */
export interface VerifyWebhookSignatureInput {
  secret?: string;
  secrets?: readonly string[];
  id: string;
  /** The `webhook-timestamp` header value. */
  timestamp: number | string;
  /** The exact, unparsed request body. */
  body: string;
  /** The `webhook-signature` header: space separated `v1,<base64>` entries. */
  signatureHeader: string;
  /** Allowed clock difference in seconds (default 300). */
  toleranceSeconds?: number;
  /** The current time in milliseconds (tests). */
  now?: number;
}

/**
 * Verify a delivery. True when the timestamp is within the tolerance and any
 * `v1` entry of the header matches a signature made with any given secret.
 * Comparison is constant time. Never throws on malformed input.
 *
 * @stability experimental
 */
export async function verifyWebhookSignature(input: VerifyWebhookSignatureInput): Promise<boolean> {
  try {
    const tolerance = input.toleranceSeconds ?? WEBHOOK_DEFAULT_TOLERANCE_SECONDS;
    const ts = Number(input.timestamp);
    if (!Number.isFinite(ts)) return false;
    const nowSeconds = (input.now ?? Date.now()) / 1000;
    if (Math.abs(nowSeconds - ts) > tolerance) return false;

    const secrets = [...(input.secrets ?? []), ...(input.secret ? [input.secret] : [])];
    if (secrets.length === 0) return false;

    const presented: Uint8Array[] = [];
    for (const entry of input.signatureHeader.split(' ')) {
      const comma = entry.indexOf(',');
      if (comma < 0 || entry.slice(0, comma) !== WEBHOOK_SIGNATURE_VERSION) continue;
      try {
        presented.push(base64ToBytes(entry.slice(comma + 1)));
      } catch {
        // ignore a malformed entry
      }
    }
    if (presented.length === 0) return false;

    let ok = false;
    for (const secret of secrets) {
      const expected = await hmac(secret, `${input.id}.${input.timestamp}.${input.body}`);
      for (const candidate of presented) {
        if (timingSafeEqual(expected, candidate)) ok = true;
      }
    }
    return ok;
  } catch {
    return false;
  }
}
