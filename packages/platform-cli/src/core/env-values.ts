import { randomBytes } from 'node:crypto';

import type { GenerateKind } from './env-spec-registry.js';

// =============================================================================
// Pure helpers for environment values  (PP-4.5, #706)
// =============================================================================
//
// Moved verbatim from the reference CLI's `deploy/env-metadata.ts`, which
// re-exports them so no import site in the app changes. They hold no state and
// read no file: generating a value, recognising a template placeholder and
// validating the few shapes the metadata asks for.
// =============================================================================

/**
 * 32 bytes from the CSPRNG, standard base64 (AES-256 keys, JWT secrets).
 *
 * Never `Math.random`, and never a shelled-out `openssl`: a CLI cannot assume
 * what is installed, and this must behave identically on a minimal container.
 *
 * @returns 44 base64 characters.
 * @stability experimental
 */
export function generateBase64Key(): string {
  return randomBytes(32).toString('base64');
}

/**
 * 32 bytes from the CSPRNG as 64 lowercase hex characters: `[0-9a-f]` only.
 *
 * @returns 64 hex characters.
 * @stability experimental
 */
export function generateHexKey(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Generates a value of the given kind.
 *
 * @param kind - `hex-32` or `base64-32`.
 * @returns A fresh random value.
 * @stability experimental
 */
export function generateValue(kind: GenerateKind): string {
  return kind === 'hex-32' ? generateHexKey() : generateBase64Key();
}

/**
 * True when a value is still a template placeholder rather than something
 * anybody chose: the template's own default for the key, or the `change-me` /
 * `your-` spellings `.env.example` uses for credentials.
 *
 * @param value - The current value.
 * @param templateDefault - The template's default for the key, if any.
 * @returns Whether the value is a placeholder.
 * @stability experimental
 */
export function isPlaceholderValue(value: string, templateDefault?: string): boolean {
  if (templateDefault !== undefined && templateDefault !== '' && value === templateDefault) {
    return true;
  }
  return /^change-me|^your-/i.test(value);
}

/**
 * Whether an `autoGenerate` key's current value must be replaced: it is
 * missing, blank or still a placeholder. A real value is never replaced.
 *
 * @param current - The current value, `undefined` when the key is absent.
 * @param templateDefault - The template's default for the key, if any.
 * @returns Whether to generate a new value.
 * @stability experimental
 */
export function needsAutoGenerate(current: string | undefined, templateDefault?: string): boolean {
  return current === undefined || current === '' || isPlaceholderValue(current, templateDefault);
}

/**
 * AES-256 needs exactly 32 bytes. A key that merely LOOKS like base64 passes
 * startup and then fails the first time a credential is saved, which is a long
 * way from where the mistake was made. Empty is allowed: the API boots without
 * the key and only refuses to SAVE a credential.
 *
 * @param value - The candidate key.
 * @returns A message when the value is unusable, `undefined` when it is fine.
 * @stability experimental
 */
export function validateBase64Key32(value: string): string | undefined {
  if (value === '') return undefined;

  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, 'base64');
  } catch {
    return 'must be base64';
  }
  // Buffer.from is lenient, so round-trip to catch input that is not base64 at
  // all rather than silently accepting a truncated decode.
  if (decoded.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) {
    return 'must be valid base64 (generate with: openssl rand -base64 32)';
  }
  if (decoded.length !== 32) {
    return `must decode to exactly 32 bytes for AES-256 (got ${decoded.length})`;
  }
  return undefined;
}

/**
 * Accepts an email address.
 *
 * @param value - The candidate address.
 * @returns A message when the value is not an address, `undefined` when it is.
 * @stability experimental
 */
export function validateEmail(value: string): string | undefined {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? undefined : 'must be an email address';
}

/**
 * Accepts a TCP port number, 1 to 65535.
 *
 * @param value - The candidate port.
 * @returns A message when the value is not a port, `undefined` when it is.
 * @stability experimental
 */
export function validatePort(value: string): string | undefined {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536
    ? undefined
    : 'must be a port number between 1 and 65535';
}
