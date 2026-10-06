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

import { APP_METRICS } from '../../app-registrations/telemetry';
import { EVENT_BUS_APP_METRICS } from '../event-bus/event-bus.metrics';
import { registerAppMetrics } from './app-metric.registry';
import { PLATFORM_APP_METRICS } from './platform-app-metrics';

registerAppMetrics(PLATFORM_APP_METRICS);
registerAppMetrics(EVENT_BUS_APP_METRICS);

// App-owned metrics last.
registerAppMetrics(APP_METRICS);
