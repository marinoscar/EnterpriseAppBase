// =============================================================================
// Email -- public surface (issue #122, epic #109)
// =============================================================================
//
// #122 ships the transports and their configuration only: no templates (#123),
// no settings endpoint (#124), no dispatcher (#125). Consumers import from
// `../email`, so those can appear behind this barrel without every call site
// changing its import path -- the same arrangement `../notifications` uses.
//
// `BaseEmailProvider` is exported for the same reason it exists: a new
// transport extends it and inherits the never-throw guarantee. Implementing
// `EmailProvider` directly is how that guarantee gets lost.
// =============================================================================

export { BaseEmailProvider, SecretRedactor } from './base-email.provider';
export { EmailModule } from './email.module';
export {
  EmailSettingsService,
  EMAIL_SETTINGS_KEY,
} from './email-settings.service';
export {
  DEFAULT_EMAIL_SETTINGS,
  DEFAULT_SMTP_PORT,
  EMAIL_PROVIDER_KINDS,
  IMPLICIT_TLS_SMTP_PORT,
  emailSettingsSchema,
} from './email-settings.schema';
export { SesEmailProvider } from './providers/ses-email.provider';
export {
  SmtpEmailProvider,
  SMTP_CREDENTIAL_NAME,
  SMTP_CREDENTIAL_PURPOSE,
} from './providers/smtp-email.provider';

export type { EmailMessage, EmailSendResult } from './email.types';
export type { EmailProvider } from './providers/email-provider.interface';
export type {
  EmailProviderKind,
  EmailSettings,
} from './email-settings.schema';
