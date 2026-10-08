// =============================================================================
// Email: the zod-free constants of the wire contract (issue #737, PP-8.4)
// =============================================================================
//
// The transport list is CLOSED on purpose (the provider kind list of the
// email slice; a new transport is a seam request, see the API slice's README).
// =============================================================================

/**
 * The transports the platform can send with: Amazon SES (API) and SMTP.
 *
 * @stability stable
 */
export const EMAIL_PROVIDER_KINDS = ['ses', 'smtp'] as const;

/**
 * A configured transport: one of `EMAIL_PROVIDER_KINDS`.
 *
 * @stability stable
 */
export type EmailProviderKind = (typeof EMAIL_PROVIDER_KINDS)[number];

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
