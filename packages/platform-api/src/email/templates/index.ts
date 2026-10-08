// =============================================================================
// Email templates: public surface (issue #123; registry since #678; in the
// package since #737)
// =============================================================================
//
// The template layer of `@marinoscar/platform-api/email`: the registry and its
// typed front doors, the render context, the layout and its theme, the
// escaping helpers and the platform's nine templates. Consumers import from
// the slice barrel, never an individual file.
//
// FRAMEWORK-FREE: no Nest, no transport. A manifest that registers templates
// at import time can load all of this without a container.
// =============================================================================

export {
  EMAIL_TEMPLATE_NAME_PATTERN,
  emailTemplateOverrideRegistry,
  emailTemplateRegistry,
  findEmailTemplate,
  isEmailTemplateName,
  listEmailTemplateOverrides,
  registerEmailTemplate,
  registerEmailTemplates,
  registerPlatformEmailTemplates,
  renderEmailTemplate,
  withLayoutAttachments,
} from './email-template.registry';
export type {
  EmailTemplateDataMap,
  EmailTemplateEntry,
  EmailTemplateName,
  EmailTemplateOverride,
  RegisterEmailTemplateOptions,
} from './email-template.registry';

export {
  configureEmailRendering,
  createEmailRenderContext,
  currentEmailRenderContext,
  isEmailRenderingConfigured,
  resolveEmailRenderContext,
} from './render-context';
export type { EmailRenderContext, EmailRenderingOptions } from './render-context';

export { DEFAULT_EMAIL_LAYOUT_THEME, DEFAULT_EMAIL_TONES, resolveEmailLayout } from './layout-theme';
export type {
  EmailBrandMark,
  EmailLayoutOptions,
  EmailLayoutTheme,
  EmailTone,
  EmailToneStyle,
  ResolvedEmailLayout,
} from './layout-theme';

export { plainText, renderCallout, renderLayout } from './layout';
export type { PlainTextOptions, RenderCalloutOptions, RenderLayoutOptions } from './layout';

// The escaping mechanism. See safe-html.ts for why it is a tagged template
// literal and not a function everyone has to remember to call.
export { SafeHtml, escapeHtml, html, safeUrl } from './safe-html';

export { RENDERED_EMAIL_MATCHES_MESSAGE, TRANSACTIONAL_EMAIL_HEADERS } from './email-template.types';
export type {
  EmailTemplate,
  MessageRenderedPartFitsRendered,
  RenderedEmail,
  RenderedEmailFitsMessage,
} from './email-template.types';

export { PLATFORM_EMAIL_TEMPLATES } from './platform-email-templates';
export type { PlatformEmailTemplateDataMap, PlatformEmailTemplateName } from './platform-email-templates';

// The nine platform templates, exported individually as well as through the
// registry, so a caller that knows statically which message it builds (or an
// override that wraps one) gets its payload type checked by name.
export { testEmail } from './test-email.email';
export type { TestEmailData } from './test-email.email';
export { userWelcomeEmail } from './user-welcome.email';
export type { UserWelcomeEmailData } from './user-welcome.email';
export { allowlistInvitationEmail } from './allowlist-invitation.email';
export type { AllowlistInvitationEmailData } from './allowlist-invitation.email';
export { roleChangedEmail } from './role-changed.email';
export type { RoleChangedEmailData } from './role-changed.email';
export { broadcastEmail } from './broadcast.email';
export type { BroadcastEmailData } from './broadcast.email';
export { jobFailedEmail } from './job-failed.email';
export type { JobFailedEmailData } from './job-failed.email';
export { nodeOfflineEmail } from './node-offline.email';
export type { NodeOfflineEmailData } from './node-offline.email';
export { backupFailedEmail } from './backup-failed.email';
export type { BackupFailedEmailData, BackupFailureOutcome } from './backup-failed.email';
export { restoreCompletedEmail } from './restore-completed.email';
export type { RestoreCompletedEmailData } from './restore-completed.email';
