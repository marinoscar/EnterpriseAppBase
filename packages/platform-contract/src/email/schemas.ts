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

import { pluggableDescriptorSchema } from '../settings/index.js';
import { EMAIL_TRANSPORT_ID_PATTERN } from './constants.js';
import type { BuiltinEmailProviderKind } from './constants.js';

/**
 * The entries of the former transport enum: each built-in kind keyed by itself.
 *
 * @deprecated The transport is an open id now ({@link emailTransportIdSchema}).
 * @stability stable
 */
export type EmailProviderKindEnum = { [K in BuiltinEmailProviderKind]: K };

/**
 * An email transport id: any string matching {@link EMAIL_TRANSPORT_ID_PATTERN}.
 * Not an enum: an app registers transports (`registerEmailTransport`), and the
 * API validates the id against the registry.
 *
 * @extensionPoint option
 * @stability experimental
 */
export const emailTransportIdSchema = z.string().regex(EMAIL_TRANSPORT_ID_PATTERN);

/**
 * One transport's non-secret settings as stored: whatever that transport's
 * `settingsSchema` declares. The contract cannot see the registry, so it
 * checks the shape (a record) and the API validates each entry with the
 * transport that owns it.
 *
 * @stability experimental
 */
export const emailTransportSettingsSchema = z.record(z.string(), z.unknown());

/**
 * The `transports` record: transport id to that transport's settings.
 *
 * @stability experimental
 */
export const emailTransportsSchema = z.record(emailTransportIdSchema, emailTransportSettingsSchema);

/**
 * The `transports` record of a PUT: `null` removes a transport's stored
 * settings (back to its defaults), an object is merged over them.
 *
 * @stability experimental
 */
export const emailTransportsPatchSchema = z.record(emailTransportIdSchema, emailTransportSettingsSchema.nullable());

// The transport, as the settings and the test-send result carry it.
const providerKindSchema = emailTransportIdSchema;

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
   * The id of the active transport: a built-in (`ses`, `smtp`) or one an app
   * registered. `null` means "no transport chosen", the state of
   * every fresh installation: a real, persisted state rather than an absent
   * key.
   */
  provider: providerKindSchema.nullable(),

  /** Master switch. Nothing is sent while this is false. */
  enabled: z.boolean(),

  /**
   * Every transport's own non-secret settings, keyed by transport id
   * (`transports.smtp.host`, `transports.my-relay.apiBase`), each validated by
   * the transport that owns it. A row written before transports were pluggable
   * has none: the API folds the flat fields below into `transports.ses` and
   * `transports.smtp` when it reads such a row.
   */
  transports: emailTransportsSchema.optional(),

  /**
   * @deprecated Read view of `transports.ses.region`. SES region override. Absent means "use the deployment's SES region
   * fallback" (`SES_REGION` in the reference app). A verified sending identity
   * is regional, so the override is the usual case.
   */
  sesRegion: z.string().trim().min(1).optional(),

  /**
   * @deprecated Read view of `transports.ses.accessKeyId`. SES access key id. An IDENTIFIER, NOT A SECRET: it travels in clear in
   * every SigV4 request. The secret access key lives in the credential store.
   */
  sesAccessKeyId: z.string().trim().min(1).optional(),

  /** @deprecated Read view of `transports.smtp.host`. SMTP server host. */
  smtpHost: z.string().trim().min(1).optional(),

  /**
   * @deprecated Read view of `transports.smtp.port`. SMTP port, validated here so a typo fails on the settings form rather than
   * as a socket-level error.
   */
  smtpPort: z.number().int().min(1).max(65535).optional(),

  /**
   * @deprecated Read view of `transports.smtp.useTls`. Require TLS. Absent is treated as `true` by the provider: a mail
   * credential must not cross the network in the clear because a checkbox was
   * missing from a stored row.
   */
  smtpUseTls: z.boolean().optional(),

  /**
   * @deprecated Read view of `transports.smtp.username`. SMTP username. Absent means unauthenticated submission (an internal relay
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
 * `{ data }` envelope): the settings, a descriptor per registered transport,
 * the masked status of every transport secret, why
 * the stored row could not be read (field paths only; the read degrades to
 * the defaults instead of failing, so the page that repairs the row still
 * renders), and the row's version for `If-Match`.
 *
 * @stability stable
 */
export const emailSettingsResponseSchema = emailSettingsSchema.extend({
  /** Every REGISTERED transport's own settings, keyed by transport id, with its defaults filled. */
  transports: emailTransportsSchema,
  /**
   * One descriptor per registered transport, in registration order: its id
   * and label, its non-secret settings fields and one `secret` field per
   * declared secret carrying only whether a value is stored (`hasValue`),
   * never the value. The admin page renders any transport without
   * hard-coded knowledge of it.
   */
  descriptors: z.array(pluggableDescriptorSchema),
  /**
   * The masked status of every declared secret of every registered transport:
   * `{ <transportId>: { <secretName>: status } }`. Nothing here can carry a value.
   */
  secretStatuses: z.record(emailTransportIdSchema, z.record(z.string(), credentialStatusSchema)),
  /** @deprecated `secretStatuses.smtp.password`. The SMTP password's masked status. */
  smtpPasswordStatus: credentialStatusSchema,
  /** @deprecated `secretStatuses.ses.secretAccessKey`. The SES secret access key's masked status. */
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
      /** The user's id. */
      id: z.uuid(),
      /** The user's address. */
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
 * The `PUT /api/email-settings` body: every settings field (blankable), the
 * `transports` patch, plus the WRITE-ONLY secrets (`secrets`, and the two
 * legacy aliases). A blank secret (absent, `null` or `''`)
 * preserves the stored one; erasing a stored secret is not expressible here.
 *
 * @stability stable
 */
export const updateEmailSettingsSchema = emailSettingsSchema.extend({
  /**
   * Transport settings to merge, per transport id, each validated by the
   * transport that owns it. `null` removes a transport's stored settings (back
   * to its defaults); a setting a transport's entry omits keeps its stored
   * value. `transports.<id>` wins over a legacy flat field for the same setting.
   */
  transports: emailTransportsPatchSchema.optional(),
  /** @deprecated Alias of `transports.ses.region`; blank clears it. */
  sesRegion: blankable(emailSettingsSchema.shape.sesRegion),
  /** @deprecated Alias of `transports.ses.accessKeyId` (not a secret); blank clears it. */
  sesAccessKeyId: blankable(emailSettingsSchema.shape.sesAccessKeyId),
  /** @deprecated Alias of `transports.smtp.host`; blank clears it. */
  smtpHost: blankable(emailSettingsSchema.shape.smtpHost),
  /** @deprecated Alias of `transports.smtp.port`; blank clears it (587 applies). */
  smtpPort: blankable(emailSettingsSchema.shape.smtpPort),
  /** @deprecated Alias of `transports.smtp.useTls`; blank clears it (on applies). */
  smtpUseTls: blankable(emailSettingsSchema.shape.smtpUseTls),
  /** @deprecated Alias of `transports.smtp.username`; blank means unauthenticated submission. */
  smtpUsername: blankable(emailSettingsSchema.shape.smtpUsername),
  /** Sender address; blank clears it. */
  fromAddress: blankable(emailSettingsSchema.shape.fromAddress),
  /** Sender display name; blank clears it. */
  fromName: blankable(emailSettingsSchema.shape.fromName),
  /** The SMTP password. Write-only; blank preserves the stored one. Alias of `secrets.smtp.password`. */
  smtpPassword: z.string().max(MAX_SECRET_LENGTH).nullish(),
  /** The SES secret access key. Write-only; blank preserves the stored one. Alias of `secrets.ses.secretAccessKey`. */
  sesSecretAccessKey: z.string().max(MAX_SECRET_LENGTH).nullish(),
  /**
   * WRITE-ONLY secrets of any transport: `{ <transportId>: { <secretName>: value } }`,
   * the names the transport declares (`descriptors[].fields` of kind `secret`).
   * A blank value keeps the stored one. Never echoed back.
   */
  secrets: z.record(emailTransportIdSchema, z.record(z.string(), z.string().max(4096).nullish())).optional(),
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
  providerKind: providerKindSchema.nullable(),
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

/**
 * The field names no email settings shape may declare (the compile-time
 * proofs below check against them).
 *
 * @stability stable
 */
export type EmailSecretFieldName =
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
export type EmailSettingsCarriesNoSecret = Extract<keyof EmailSettings, EmailSecretFieldName> extends never ? true : never;

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
  Extract<keyof EmailSettingsResponse, EmailSecretFieldName> extends never ? true : never;

/**
 * The proof that {@link EmailSettingsResponse} carries no secret (fails to compile otherwise).
 *
 * @stability stable
 */
export const EMAIL_SETTINGS_RESPONSE_CARRIES_NO_SECRET: EmailSettingsResponseCarriesNoSecret = true;
