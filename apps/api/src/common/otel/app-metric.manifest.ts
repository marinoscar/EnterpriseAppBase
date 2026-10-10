// =============================================================================
// App-metric manifest (issue #680)
// =============================================================================
//
// Registers every declared `app.*` metric at import time
// (packages/platform-api/src/core/registry/README.md, "Recipe: a static registry"):
// the platform's (the host slice's 31 and the event bus's three, #867), then
// the slices' this app mounts, then the app's own (`app-registrations/telemetry.ts`),
// so a key or name collision names the app. Imported by
// `platform/host-core.config.ts` before `PlatformHostCoreModule.forRoot()`
// (which registers the platform's again, idempotently).
// =============================================================================

import { registerPlatformHostAppMetrics } from '@marinoscar/platform-api/host';
import { ORGANIZATIONS_APP_METRICS } from '@marinoscar/platform-api/identity';
import { SHARING_APP_METRICS } from '@marinoscar/platform-api/sharing';
import { EXPORTS_APP_METRICS } from '@marinoscar/platform-api/exports';
import { USER_DATA_APP_METRICS } from '@marinoscar/platform-api/user-data';

import { APP_METRICS } from '../../app-registrations/telemetry';

registerPlatformHostAppMetrics(
  // Organization administration (#726, PP-6.7).
  ORGANIZATIONS_APP_METRICS,
  SHARING_APP_METRICS,
  EXPORTS_APP_METRICS,
  USER_DATA_APP_METRICS,
  // App-owned metrics last.
  APP_METRICS,
);
