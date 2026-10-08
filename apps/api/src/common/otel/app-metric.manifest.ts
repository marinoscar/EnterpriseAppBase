// =============================================================================
// App-metric manifest (issue #680)
// =============================================================================
//
// Registers every declared `app.*` metric at import time
// (packages/platform-api/src/core/registry/README.md, "Recipe: a static registry"): the platform's
// first, then the app's own (`app-registrations/telemetry.ts`), so a key or
// name collision names the app. Imported by `app-metrics.service.ts`; nothing
// else imports this file.
// =============================================================================

import { registerAppMetrics } from '@marinoscar/platform-api/otel-core';

import { APP_METRICS } from '../../app-registrations/telemetry';
import { EVENT_BUS_APP_METRICS } from '../event-bus/event-bus.metrics';
import { PLATFORM_APP_METRICS } from './platform-app-metrics';
import { ORGANIZATIONS_APP_METRICS } from '@marinoscar/platform-api/identity';
import { SHARING_APP_METRICS } from '@marinoscar/platform-api/sharing';
import { EXPORTS_APP_METRICS } from '@marinoscar/platform-api/exports';
import { USER_DATA_APP_METRICS } from '@marinoscar/platform-api/user-data';

registerAppMetrics(PLATFORM_APP_METRICS);
registerAppMetrics(EVENT_BUS_APP_METRICS);
// Organization administration (#726, PP-6.7).
registerAppMetrics(ORGANIZATIONS_APP_METRICS);
registerAppMetrics(SHARING_APP_METRICS);
registerAppMetrics(EXPORTS_APP_METRICS);
registerAppMetrics(USER_DATA_APP_METRICS);

// App-owned metrics last.
registerAppMetrics(APP_METRICS);
