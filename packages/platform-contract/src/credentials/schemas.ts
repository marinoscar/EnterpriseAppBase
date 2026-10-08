// =============================================================================
// Credentials: the presentation-safe wire shapes of a stored credential
// (issue #735, PP-8.8)
// =============================================================================
//
// What a feature returns when it presents a credential it owns (the AI
// provider card, the storage page, an app's own key page). There is no
// generic credentials route, on purpose: each owning feature exposes its own,
// and embeds one of these. None of them has a field able to carry a secret,
// the ciphertext, the row id or the owner id; the hint is the only
// derivative of the secret, and it is presentation-only. Dates are ISO
// strings, always present fields are `.nullable()`.
// =============================================================================

import { z } from 'zod';

import { CREDENTIAL_SOURCES } from './constants.js';

/**
 * A deployment credential, as the API presents it (`CredentialInfo`).
 *
 * @stability experimental
 */
export const credentialInfoSchema = z.object({
  purpose: z.string().describe('The purpose (and cipher sub-key domain): `smtp`, `storage`, ...'),
  name: z.string().describe('The discriminator within the purpose: `default`, a provider id, ...'),
  hint: z.string().nullable().describe('A non-secret display aid, `••••abcd`; null for a row written outside the store.'),
  label: z.string().nullable().describe('The admin-entered description.'),
  updatedByUserId: z.uuid().nullable().describe('Who last set it; null when that user was deleted.'),
  createdAt: z.string().describe('ISO 8601.'),
  updatedAt: z.string().describe('ISO 8601.'),
});

/**
 * The inferred type of {@link credentialInfoSchema}.
 *
 * @stability experimental
 */
export type CredentialInfoDto = z.infer<typeof credentialInfoSchema>;

/**
 * A user's own credential, as the API presents it to that user
 * (`UserCredentialInfo`): no owner id, no provenance.
 *
 * @stability experimental
 */
export const userCredentialInfoSchema = credentialInfoSchema.omit({ updatedByUserId: true });

/**
 * The inferred type of {@link userCredentialInfoSchema}.
 *
 * @stability experimental
 */
export type UserCredentialInfoDto = z.infer<typeof userCredentialInfoSchema>;

/**
 * An organization's credential, as the API presents it inside that
 * organization (`OrgCredentialInfo`): no organization id.
 *
 * @stability experimental
 */
export const orgCredentialInfoSchema = credentialInfoSchema;

/**
 * The inferred type of {@link orgCredentialInfoSchema}.
 *
 * @stability experimental
 */
export type OrgCredentialInfoDto = z.infer<typeof orgCredentialInfoSchema>;

/**
 * Which tier answered a credential resolution (never the secret).
 *
 * @stability experimental
 */
export const credentialSourceSchema = z.enum(CREDENTIAL_SOURCES).describe('`user`, `org`, `system` or `none`.');

/**
 * The inferred type of {@link credentialSourceSchema}.
 *
 * @stability experimental
 */
export type CredentialSourceDto = z.infer<typeof credentialSourceSchema>;
