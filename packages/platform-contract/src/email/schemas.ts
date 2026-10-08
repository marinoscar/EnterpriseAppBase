// =============================================================================
// Email: the wire contract of `/api/email-settings` (issue #737, PP-8.4;
// shapes from #122, #124 and #585)
// =============================================================================
//
// The stored settings, the PUT body, the GET/PUT response and the test-send
// result. The API slice (`@marinoscar/platform-api/email`) wraps each with
// `createZodDto`; the web slice reads the inferred types.
//
// NO SECRET IS STORED IN THE SETTINGS. The SMTP password and the SES secret
// access key live in the encrypted credential store; the PUT body accepts
// them write-only, and the response describes them only as a masked status.
// Compile-time proofs at the bottom of this file fail the build the moment a
// secret-named field is added to the stored settings or to the response.
// =============================================================================

import { z } from 'zod';

import { EMAIL_PROVIDER_KINDS } from './constants.js';

/**
 * The admin-configurable half of email delivery: which transport, where it
 * lives, who the mail claims to be from. Ordinary configuration, safe to
 * return from an admin endpoint; stored in the `email` row of
 * `system_settings`.
 *
 * @stability stable
 */
export const emailSettingsSchema = z.object({
  /**
   * Which transport to use. `null` means "no transport chosen", the state of
   * every fresh installation: a real, persisted state rather than an absent
   * key.
   */
  provider: z.enum(EMAIL_PROVIDER_KINDS).nullable(),

  /** Master switch. Nothing is sent while this is false. */
  enabled: z.boolean(),

  /**
   * SES region override. Absent means "use the deployment's SES region
   * fallback" (`SES_REGION` in the reference app). A verified sending identity
   * is regional, so the override is the usual case.
   */
  sesRegion: z.string().trim().min(1).optional(),

  /**
   * SES access key id. An IDENTIFIER, NOT A SECRET: it travels in clear in
   * every SigV4 request. The secret access key lives in the credential store.
   */
  sesAccessKeyId: z.string().trim().min(1).optional(),

  /** SMTP server host. */
  smtpHost: z.string().trim().min(1).optional(),

  /**
   * SMTP port, validated here so a typo fails on the settings form rather than
   * as a socket-level error.
   */
  smtpPort: z.number().int().min(1).max(65535).optional(),

  /**
   * Require TLS. Absent is treated as `true` by the provider: a mail
   * credential must not cross the network in the clear because a checkbox was
   * missing from a stored row.
   */
  smtpUseTls: z.boolean().optional(),

  /**
   * SMTP username. Absent means unauthenticated submission (an internal relay
   * that authorises by source IP).
   */
  smtpUsername: z.string().trim().min(1).optional(),

  /** Envelope and header sender, validated as an address. */
  fromAddress: z.email().optional(),

  /** Display name paired with `fromAddress`, e.g. `Acme <no-reply@acme.com>`. */
  fromName: z.string().trim().min(1).max(100).optional(),
});

/**
 * Validated email settings.
 *
 * @stability stable
 */
export type EmailSettings = z.infer<typeof emailSettingsSchema>;

/**
 * What a system with no email configuration reads as: no transport, switched
 * off.
 *
 * @stability stable
 */
export const DEFAULT_EMAIL_SETTINGS: EmailSettings = {
  provider: null,
  enabled: false,
};

/**
 * What the admin page knows about a stored secret (the SMTP password, the SES
 * secret access key) without being told the secret: whether it is set, the
 * store's mask, and when and by whom it was last written.
 *
 * @stability stable
 */
export const credentialStatusSchema = z.object({
  /** Is a secret stored at this credential's address? */
  configured: z.boolean(),
  /** The store's non-secret mask, e.g. `••••x9fQ`; null when nothing is stored. */
  hint: z.string().nullable(),
  /** When the stored secret was last written; null when nothing is stored. */
  updatedAt: z.iso.datetime().nullable(),
  /** Who last wrote it; null when nothing is stored, or the user was deleted. */
  updatedByUserId: z.uuid().nullable(),
});

/**
 * The masked status of one stored secret.
 *
 * @stability stable
 */
export type EmailCredentialStatusDto = z.infer<typeof credentialStatusSchema>;

/**
 * The `GET` and `PUT /api/email-settings` response body (inside the global
 * `{ data }` envelope): the settings, the masked status of both secrets, why
 * the stored row could not be read (field paths only; the read degrades to
 * the defaults instead of failing, so the page that repairs the row still
 * renders), and the row's version for `If-Match`.
 *
 * @stability stable
 */
export const emailSettingsResponseSchema = emailSettingsSchema.extend({
  /** The SMTP password's masked status. */
  smtpPasswordStatus: credentialStatusSchema,
  /** The SES secret access key's masked status. */
  sesSecretAccessKeyStatus: credentialStatusSchema,
  /** Why the stored configuration could not be read; null normally. Field paths only. */
  settingsError: z.string().nullable(),
  /** Bumped on every write; pass back as `If-Match` on PUT. `0` while nothing is stored. */
  version: z.number().int(),
  /** When the row last changed. */
  updatedAt: z.iso.datetime().nullable(),
  /** Who last changed it. */
  updatedBy: z
    .object({
      id: z.uuid(),
      email: z.email(),
    })
    .nullable(),
});

/**
 * The GET/PUT response body, as sent.
 *
 * @stability stable
 */
export type EmailSettingsResponse = z.infer<typeof emailSettingsResponseSchema>;

/**
 * Length ceiling on a submitted secret. Not a security control: a bound on
 * what a paste accident can push into an encrypted column.
 */
const MAX_SECRET_LENGTH = 1024;

/**
 * A settings field an admin left empty: a cleared input submits `''`, a reset
 * controlled field `null`. A union rather than a `z.preprocess`, because the
 * OpenAPI generator cannot represent a transform. The service converts both
 * to "absent".
 */
const unset = z.union([z.literal(''), z.null()]);

/** The stored rule for one field, plus the two "empty box" forms. */
function blankable<T extends z.ZodTypeAny>(inner: T) {
  return z.union([unset, inner]);
}

/**
 * The `PUT /api/email-settings` body: every settings field (blankable), plus
 * the two WRITE-ONLY secrets. A blank secret (absent, `null` or `''`)
 * preserves the stored one; erasing a stored secret is not expressible here.
 *
 * @stability stable
 */
export const updateEmailSettingsSchema = emailSettingsSchema.extend({
  sesRegion: blankable(emailSettingsSchema.shape.sesRegion),
  sesAccessKeyId: blankable(emailSettingsSchema.shape.sesAccessKeyId),
  smtpHost: blankable(emailSettingsSchema.shape.smtpHost),
  smtpPort: blankable(emailSettingsSchema.shape.smtpPort),
  smtpUseTls: blankable(emailSettingsSchema.shape.smtpUseTls),
  smtpUsername: blankable(emailSettingsSchema.shape.smtpUsername),
  fromAddress: blankable(emailSettingsSchema.shape.fromAddress),
  fromName: blankable(emailSettingsSchema.shape.fromName),
  /** The SMTP password. Write-only; blank preserves the stored one. */
  smtpPassword: z.string().max(MAX_SECRET_LENGTH).nullish(),
  /** The SES secret access key. Write-only; blank preserves the stored one. */
  sesSecretAccessKey: z.string().max(MAX_SECRET_LENGTH).nullish(),
});

/**
 * The parsed PUT body, secrets included.
 *
 * @stability stable
 */
export type UpdateEmailSettingsInput = z.infer<typeof updateEmailSettingsSchema>;

/**
 * The `POST /api/email-settings/test` response body. HTTP 200 even when the
 * send failed: read `success`, and show `error`, the provider's own message
 * (already redacted of every credential and length-capped by the API).
 *
 * @stability stable
 */
export const testEmailResultSchema = z.object({
  /** Did the provider ACCEPT the message (not: was it delivered)? */
  success: z.boolean(),
  /** Where it went: always the caller's own address (there is no recipient parameter). */
  sentTo: z.email(),
  /** Which transport carried (or refused) it; null when none was configured. */
  providerKind: z.enum(EMAIL_PROVIDER_KINDS).nullable(),
  /** The transport's message id, on success. */
  messageId: z.string().nullable(),
  /** The provider's error, verbatim after redaction; null on success. */
  error: z.string().nullable(),
  /** When the attempt was made (ISO 8601). */
  attemptedAt: z.iso.datetime(),
});

/**
 * The POST /test response body.
 *
 * @stability stable
 */
export type TestEmailResult = z.infer<typeof testEmailResultSchema>;

// -----------------------------------------------------------------------------
// Compile-time proofs that no secret-bearing field crept in
// -----------------------------------------------------------------------------
//
// Adding `smtpPassword` (or any name below) to the stored settings or to the
// response makes the matching type `never`, and this file stops compiling: a
// build break at the moment of the mistake. If you are here because one went
// red, you are putting a secret into a settings row or a response; store it
// with `CredentialsService` instead.

type SecretFieldNames =
  | 'smtpPassword'
  | 'password'
  | 'secret'
  | 'apiKey'
  | 'accessKeyId'
  | 'secretAccessKey'
  | 'ciphertext';

/**
 * `true` while {@link EmailSettings} has no secret-named field; `never` otherwise.
 *
 * @stability stable
 */
export type EmailSettingsCarriesNoSecret = Extract<keyof EmailSettings, SecretFieldNames> extends never ? true : never;

/**
 * The proof that {@link EmailSettings} carries no secret (fails to compile otherwise).
 *
 * @stability stable
 */
export const EMAIL_SETTINGS_CARRIES_NO_SECRET: EmailSettingsCarriesNoSecret = true;

/**
 * `true` while {@link EmailSettingsResponse} has no secret-named field; `never` otherwise.
 *
 * @stability stable
 */
export type EmailSettingsResponseCarriesNoSecret =
  Extract<keyof EmailSettingsResponse, SecretFieldNames> extends never ? true : never;

/**
 * The proof that {@link EmailSettingsResponse} carries no secret (fails to compile otherwise).
 *
 * @stability stable
 */
export const EMAIL_SETTINGS_RESPONSE_CARRIES_NO_SECRET: EmailSettingsResponseCarriesNoSecret = true;
