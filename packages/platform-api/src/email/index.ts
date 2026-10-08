// `@marinoscar/platform-api/email`: the email slice (issue #737, PP-8.4;
// transports from #122, templates from #123, admin routes from #124). The SES
// and SMTP transports, the `email` settings row and `/api/email-settings`, the
// template registry, the layout and its theme, the safe-HTML helpers and the
// doctor check. Documented in ./README.md. Explicit named exports only.
//
// NOTHING EXPORTED FROM HERE CAN CARRY THE SMTP PASSWORD OR THE SES SECRET
// ACCESS KEY: the write DTO's secrets are request-only and go to the
// credential store; the response DTO and `EmailSettingsAdminView` carry
// compile-time proofs that they have no secret-bearing field.
//
// `BaseEmailProvider` is exported because a replacement transport (the
// provider-token override, rung 3) extends it and inherits the never-throw
// guarantee; implementing `EmailProvider` directly is how that guarantee gets
// lost.

// ---- the module and its options (rung 1) ----------------------------------------------
export { EmailModule, EmailTemplateOverrideReporter } from './email.module';
export { EMAIL_OPTIONS, resolveEmailModuleOptions } from './email.options';
export type { EmailModuleOptions, ResolvedEmailModuleOptions } from './email.options';

// ---- settings, credentials and the admin routes -----------------------------------------
export { EmailSettingsService, EMAIL_SETTINGS_KEY } from './email-settings.service';
export type {
  CredentialStatus,
  EmailPrisma,
  EmailSettingsAdminView,
  EmailSettingsUpdatedBy,
  SmtpPasswordStatus,
} from './email-settings.service';
export { EmailSettingsController } from './email-settings.controller';
export { EmailTestSendService, formatFromHeader } from './email-test-send.service';
export type { TestSendActor } from './email-test-send.service';
export {
  SMTP_CREDENTIAL_LABEL,
  SMTP_CREDENTIAL_NAME,
  SMTP_CREDENTIAL_PURPOSE,
  SMTP_CREDENTIAL_PURPOSE_DEF,
} from './smtp-credential.constants';
export {
  SES_CREDENTIAL_LABEL,
  SES_CREDENTIAL_NAME,
  SES_CREDENTIAL_PURPOSE,
  SES_CREDENTIAL_PURPOSE_DEF,
} from './ses-credential.constants';
export { UpdateEmailSettingsDto, updateEmailSettingsSchema } from './dto/update-email-settings.dto';
export type { UpdateEmailSettingsInput } from './dto/update-email-settings.dto';
export { EmailSettingsResponseDto, emailSettingsResponseSchema } from './dto/email-settings-response.dto';
export type { EmailSettingsResponse } from './dto/email-settings-response.dto';
export { TestEmailResultDto, testEmailResultSchema } from './dto/test-email-result.dto';
export type { TestEmailResult } from './dto/test-email-result.dto';
export {
  DEFAULT_EMAIL_SETTINGS,
  DEFAULT_SMTP_PORT,
  EMAIL_PROVIDER_KINDS,
  IMPLICIT_TLS_SMTP_PORT,
  emailSettingsSchema,
} from './email-settings.schema';
export type { EmailProviderKind, EmailSettings } from './email-settings.schema';

// ---- transports ------------------------------------------------------------------------
export { BaseEmailProvider, SecretRedactor } from './base-email.provider';
export { SesEmailProvider } from './providers/ses-email.provider';
export { SmtpEmailProvider } from './providers/smtp-email.provider';
export type { EmailProvider } from './providers/email-provider.interface';
export type { EmailAttachment, EmailMessage, EmailSendResult } from './email.types';
export { classifyEmailRateLimit } from './email-rate-limit';
export type { EmailRateLimitClassification, GenericRateLimitClassifier } from './email-rate-limit';

// ---- doctor ----------------------------------------------------------------------------
export { EMAIL_SETTINGS_PATH, EmailConfigDoctorCheck, decideEmailConfig } from './doctor/email-config.doctor-check';
export { EmailEgressContributor } from './doctor/egress/email.egress.contributor';

// ---- templates: registry, render context, layout, theme, safe HTML (rung 2) -------------
export {
  DEFAULT_EMAIL_LAYOUT_THEME,
  DEFAULT_EMAIL_TONES,
  EMAIL_TEMPLATE_NAME_PATTERN,
  PLATFORM_EMAIL_TEMPLATES,
  RENDERED_EMAIL_MATCHES_MESSAGE,
  SafeHtml,
  TRANSACTIONAL_EMAIL_HEADERS,
  allowlistInvitationEmail,
  backupFailedEmail,
  broadcastEmail,
  configureEmailRendering,
  createEmailRenderContext,
  currentEmailRenderContext,
  emailTemplateOverrideRegistry,
  emailTemplateRegistry,
  escapeHtml,
  findEmailTemplate,
  html,
  isEmailRenderingConfigured,
  isEmailTemplateName,
  jobFailedEmail,
  listEmailTemplateOverrides,
  nodeOfflineEmail,
  plainText,
  registerEmailTemplate,
  registerEmailTemplates,
  registerPlatformEmailTemplates,
  renderCallout,
  renderEmailTemplate,
  renderLayout,
  resolveEmailLayout,
  resolveEmailRenderContext,
  restoreCompletedEmail,
  roleChangedEmail,
  safeUrl,
  testEmail,
  userWelcomeEmail,
  withLayoutAttachments,
} from './templates/index';
export type {
  AllowlistInvitationEmailData,
  BackupFailedEmailData,
  BackupFailureOutcome,
  BroadcastEmailData,
  EmailBrandMark,
  EmailLayoutOptions,
  EmailLayoutTheme,
  EmailRenderContext,
  EmailRenderingOptions,
  EmailTemplate,
  EmailTemplateDataMap,
  EmailTemplateEntry,
  EmailTemplateName,
  EmailTemplateOverride,
  EmailTone,
  EmailToneStyle,
  JobFailedEmailData,
  MessageRenderedPartFitsRendered,
  NodeOfflineEmailData,
  PlainTextOptions,
  PlatformEmailTemplateDataMap,
  PlatformEmailTemplateName,
  RegisterEmailTemplateOptions,
  RenderCalloutOptions,
  RenderLayoutOptions,
  RenderedEmail,
  RenderedEmailFitsMessage,
  ResolvedEmailLayout,
  RestoreCompletedEmailData,
  RoleChangedEmailData,
  TestEmailData,
  UserWelcomeEmailData,
} from './templates/index';
