// `@marinoscar/platform-web/email/headless`: the email settings hook and its
// types (issue #737, PP-8.4), with no component. Documented in ../README.md.

export { useEmailSettings } from './use-email-settings.js';
export type {
  EmailProviderKind,
  EmailSettings,
  EmailSettingsInput,
  EmailTestResult,
  SmtpPasswordStatus,
  UseEmailSettingsOptions,
  UseEmailSettingsReturn,
} from './use-email-settings.js';
