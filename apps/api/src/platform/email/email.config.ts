import { EmailModule as PlatformEmailModule } from '@marinoscar/platform-api/email';

import { EMAIL_MODULE_OPTIONS } from './email.options';

// =============================================================================
// The reference app's email slice (issue #737)
// =============================================================================
//
// One `EmailModule.forRoot()`: the SES and SMTP transports,
// `/api/email-settings`, the template registry and layout, the doctor check,
// from `@marinoscar/platform-api/email`. The platform's nine templates, the
// slice-owned ones and the app's own are registered by
// `notifications/registry/notification.manifest.ts`; forRoot's registration
// of the nine is then a no-op.
//
// NAMED LIKE THE MODULE CLASS IT REPLACED, on purpose: every importer kept its
// `imports: [EmailModule]` line, and the same dynamic-module object everywhere
// is one module to Nest.
// =============================================================================

export const EmailModule = PlatformEmailModule.forRoot(EMAIL_MODULE_OPTIONS);
