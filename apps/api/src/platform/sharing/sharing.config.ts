// =============================================================================
// The app's binding of the sharing slice (issue #728, PP-7.1)
// =============================================================================
//
// `@marinoscar/platform-api/sharing`, configured for this app: routes guarded
// by the app's own `@Auth()` (`platformHost`), every app capability through the
// host ports `SharingHostModule` binds, the slice's defaults for the group
// limits, and the membership cache on the same TTL as the JWT principal cache
// (`AUTH_PRINCIPAL_CACHE_TTL_SECONDS`, so the two caches expire together),
// and link URLs on the deployment's `APP_URL` (#730).
// Imported once by `app.module.ts`. Same shape as `telemetry/telemetry.config.ts`.
// =============================================================================

import type { Type } from '@nestjs/common';
import { parsePrincipalCacheTtlSeconds } from '@marinoscar/platform-api/identity';
import { SharingModule } from '@marinoscar/platform-api/sharing';

import { platformHost } from '../platform-host';
import { SharingHostModule } from './sharing-host.module';

export const sharingModule = SharingModule.forRoot({
  host: platformHost,
  imports: [SharingHostModule],
  groups: {
    membershipCacheTtlSeconds: parsePrincipalCacheTtlSeconds(process.env.AUTH_PRINCIPAL_CACHE_TTL_SECONDS),
  },
  // Link shares (#730): the share URL is `${APP_URL}/s#lnk_...`, read when a
  // link is built (the same default as `config/configuration.ts`). No new
  // variable; the lifetimes, caps and the miss throttle keep their defaults.
  links: {
    appUrl: () => process.env.APP_URL || 'http://localhost:3535',
  },
});

/** The configured module's controller classes, by class name (route metadata in tests). */
export const sharingControllers: Readonly<Record<string, Type<unknown>>> = Object.freeze(
  Object.fromEntries((sharingModule.controllers ?? []).map((controller) => [controller.name, controller])),
);
