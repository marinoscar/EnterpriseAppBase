// =============================================================================
// Email settings: shape and validation (issue #122; the wire contract since
// #737 lives in `@marinoscar/platform-contract/email`)
// =============================================================================
//
// Re-exported here so the API slice's own files and its consumers keep one
// import path. THE SMTP PASSWORD AND THE SES SECRET ACCESS KEY ARE NOT IN
// THESE SETTINGS, and must never be added: they live in the credential store
// (`./smtp-credential.constants.ts`, `./ses-credential.constants.ts`). The
// compile-time proof of their absence sits beside the schema in the contract.
// =============================================================================

export {
  DEFAULT_EMAIL_SETTINGS,
  DEFAULT_SMTP_PORT,
  EMAIL_PROVIDER_KINDS,
  EMAIL_SETTINGS_CARRIES_NO_SECRET,
  IMPLICIT_TLS_SMTP_PORT,
  emailSettingsSchema,
} from '@marinoscar/platform-contract/email';
export type { EmailProviderKind, EmailSettings, EmailSettingsCarriesNoSecret } from '@marinoscar/platform-contract/email';
