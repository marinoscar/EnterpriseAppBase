// =============================================================================
// Credentials constants (issue #735, PP-8.8): zod-free, so a client that needs
// only a tier list or the secret-bearing key list never bundles zod.
// =============================================================================

/**
 * The tiers a system or org credential purpose may be stored in: `system` is
 * the deployment's store, `org` an organization's.
 *
 * @stability experimental
 */
export const CREDENTIAL_TIERS = ['system', 'org'] as const;

/**
 * One of {@link CREDENTIAL_TIERS}.
 *
 * @stability experimental
 */
export type CredentialTierValue = (typeof CREDENTIAL_TIERS)[number];

/**
 * Who answered a credential resolution: the user's own key, their
 * organization's, the deployment's, or nobody's. Safe to show or log.
 *
 * @stability experimental
 */
export const CREDENTIAL_SOURCES = ['user', 'org', 'system', 'none'] as const;

/**
 * One of {@link CREDENTIAL_SOURCES}.
 *
 * @stability experimental
 */
export type CredentialSourceValue = (typeof CREDENTIAL_SOURCES)[number];

/**
 * Field names that would, or plausibly could, carry secret material. No
 * credential response schema may declare one; the credentials conformance
 * suite scans every `*InfoSchema` for them.
 *
 * @stability experimental
 */
export const SECRET_BEARING_KEYS = [
  'secret',
  'secretValue',
  'plaintext',
  'password',
  'value',
  'ciphertext',
  'encrypted',
  'payload',
] as const;
