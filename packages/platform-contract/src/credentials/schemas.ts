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

/**
 * A deployment credential, as the API presents it (`CredentialInfo`).
 *
 * @stability experimental
 */
export const credentialInfoSchema = z.object({
  /** The purpose (and cipher sub-key domain): `smtp`, `storage`, ... */
  purpose: z.string(),
  /** The discriminator within the purpose: `default`, a provider id, ... */
  name: z.string(),
  /** A non-secret display aid, `••••abcd`; `null` for a row written outside the store. */
  hint: z.string().nullable(),
  /** The admin-entered description, or `null`. */
  label: z.string().nullable(),
  /** Who last set it; `null` when that user was deleted. */
  updatedByUserId: z.uuid().nullable(),
  /** When it was first stored (ISO 8601). */
  createdAt: z.string(),
  /** When it last changed (ISO 8601). */
  updatedAt: z.string(),
});

/**
 * The inferred type of {@link credentialInfoSchema}.
 *
 * @stability experimental
 */
export type CredentialInfoDto = z.infer<typeof credentialInfoSchema>;

/**
 * A user's own credential, as the API presents it to that user
 * (`UserCredentialInfo`): no owner id and no provenance (the owner is the only
 * writer).
 *
 * @stability experimental
 */
export const userCredentialInfoSchema = z.object({
  /** The user credential purpose. */
  purpose: z.string(),
  /** The discriminator within the purpose: `default`, ... */
  name: z.string(),
  /** A non-secret display aid, `••••abcd`, or `null`. */
  hint: z.string().nullable(),
  /** The user-entered description, or `null`. */
  label: z.string().nullable(),
  /** When it was first stored (ISO 8601). */
  createdAt: z.string(),
  /** When it last changed (ISO 8601). */
  updatedAt: z.string(),
});

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
export const orgCredentialInfoSchema = z.object({
  /** A purpose registered with the `org` tier. */
  purpose: z.string(),
  /** The discriminator within the purpose: `default`, a provider id, ... */
  name: z.string(),
  /** A non-secret display aid, `••••abcd`, or `null`. */
  hint: z.string().nullable(),
  /** The admin-entered description, or `null`. */
  label: z.string().nullable(),
  /** Who last set it; `null` when that user was deleted. */
  updatedByUserId: z.uuid().nullable(),
  /** When it was first stored (ISO 8601). */
  createdAt: z.string(),
  /** When it last changed (ISO 8601). */
  updatedAt: z.string(),
});

/**
 * The inferred type of {@link orgCredentialInfoSchema}.
 *
 * @stability experimental
 */
export type OrgCredentialInfoDto = z.infer<typeof orgCredentialInfoSchema>;
