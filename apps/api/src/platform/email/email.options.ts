import { APP_NAME } from '@app/shared';
import type { EmailModuleOptions } from '@marinoscar/platform-api/email';

import { classifyRateLimit } from '../../jobs/rate-limit.error';

// =============================================================================
// The reference app's email options (issue #737)
// =============================================================================
//
// FRAMEWORK-FREE, so the notification manifest (which registers templates
// and their event bindings at import time, before Nest composes anything) and
// `EmailModule.forRoot` read the SAME options: the manifest configures the
// render context, forRoot does it again with the same values.
//
// Nothing here is runtime email configuration (transport, relay, sender,
// secrets): that is `/admin/settings/email`. `APP_URL` and `SES_REGION` are
// the existing deployment variables (`infra/compose/.env.example`), read when
// they are needed, exactly as `config/configuration.ts` reads them.
// =============================================================================

export const EMAIL_MODULE_OPTIONS: EmailModuleOptions = {
  appName: APP_NAME,
  appUrl: () => process.env.APP_URL || 'http://localhost:3535',
  // The queue's own HTTP / SDK classifier, so a throttled SES send reads as a
  // rate limit exactly as a throttled job does (#456).
  classifyRateLimit,
  // No default, on purpose: a wrong region fails as "identity not verified".
  sesRegionFallback: () => process.env.SES_REGION || undefined,
};
