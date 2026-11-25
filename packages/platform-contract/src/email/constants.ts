// =============================================================================
// Email: the zod-free constants of the wire contract (issue #737, PP-8.4; transports: PP-14.8)
// =============================================================================
//
// Email transports are PLUGGABLE (PP-14.8): an app or package registers more
// with `registerEmailTransport` (`@marinoscar/platform-api/email`). The two
// below are the transports the platform ships.
// =============================================================================

/**
 * The pattern every email transport id must match: a lower-case letter, then
 * letters, digits and hyphens, 2 to 48 characters. The same pattern as every
 * pluggable id (`PLUGGABLE_ID_PATTERN` of `@marinoscar/platform-contract/settings`).
 * An id is the key its settings are stored under, so it is permanent once a
 * row exists.
 *
 * @stability experimental
 */
export const EMAIL_TRANSPORT_ID_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;

/**
 * The transports the platform SHIPS: Amazon SES (API) and SMTP. Not a closed
 * set: an app registers more with `registerEmailTransport` and its id is any
 * {@link EMAIL_TRANSPORT_ID_PATTERN} string. Use this list for defaults,
 * labels and the legacy flat fields, never to validate an id.
 *
 * @stability experimental
 */
export const BUILTIN_EMAIL_PROVIDER_KINDS = ['ses', 'smtp'] as const;

/**
 * The built-in transports.
 *
 * @deprecated Use `BUILTIN_EMAIL_PROVIDER_KINDS`. The list is no longer the
 *   set of valid transports: any registered email transport id is one.
 * @stability stable
 */
export const EMAIL_PROVIDER_KINDS = BUILTIN_EMAIL_PROVIDER_KINDS;

/**
 * One of {@link BUILTIN_EMAIL_PROVIDER_KINDS}.
 *
 * @stability experimental
 */
export type BuiltinEmailProviderKind = (typeof BUILTIN_EMAIL_PROVIDER_KINDS)[number];

/**
 * A configured transport: the id of a registered email transport. A plain
 * string since transports became pluggable; the built-ins are
 * `BuiltinEmailProviderKind`.
 *
 * @stability stable
 */
export type EmailProviderKind = string;

/**
 * The names of the flat fields the `email` row stored before transports had a
 * settings record of their own. They are a deprecated READ VIEW of the
 * built-in transports' settings (`transports.ses`, `transports.smtp`) and are
 * still accepted on `PUT /api/email-settings` as aliases.
 *
 * @stability experimental
 */
export const LEGACY_EMAIL_FLAT_FIELDS = [
  'sesRegion',
  'sesAccessKeyId',
  'smtpHost',
  'smtpPort',
  'smtpUseTls',
  'smtpUsername',
] as const;

/**
 * Where one legacy flat field lives now.
 *
 * @stability experimental
 */
export interface LegacyEmailFieldTarget {
  /** The built-in transport that owns the setting. */
  transport: BuiltinEmailProviderKind;
  /** The name of the setting inside `transports.<transport>`. */
  setting: string;
}

/**
 * Where each legacy flat field lives now: the built-in transport that owns it
 * and the name of the setting inside `transports.<id>`.
 *
 * @stability experimental
 */
export const LEGACY_EMAIL_FLAT_FIELD_TARGETS: Readonly<Record<(typeof LEGACY_EMAIL_FLAT_FIELDS)[number], LegacyEmailFieldTarget>> = {
  sesRegion: { transport: 'ses', setting: 'region' },
  sesAccessKeyId: { transport: 'ses', setting: 'accessKeyId' },
  smtpHost: { transport: 'smtp', setting: 'host' },
  smtpPort: { transport: 'smtp', setting: 'port' },
  smtpUseTls: { transport: 'smtp', setting: 'useTls' },
  smtpUsername: { transport: 'smtp', setting: 'username' },
};

/**
 * Default SMTP submission port when the admin has not chosen one (RFC 6409).
 *
 * @stability stable
 */
export const DEFAULT_SMTP_PORT = 587;

/**
 * The port on which SMTP speaks TLS from the first byte (implicit TLS), rather
 * than upgrading with STARTTLS.
 *
 * @stability stable
 */
export const IMPLICIT_TLS_SMTP_PORT = 465;
