// =============================================================================
// The app's binding of the telemetry slice (issue #703, PP-4.2)
// =============================================================================
//
// `@marinoscar/platform-api/telemetry`, configured for this app: routes
// guarded by the app's own `@Auth()` (`platformHost`), every app capability
// through the host ports `TelemetryHostModule` binds, and the app's own
// dashboard metric groups (`APP_METRIC_GROUPS`, empty upstream) after the six
// platform groups. Imported once by `app.module.ts`, at the position the app
// module always held telemetry. Same shape as `doctor/doctor.config.ts`.
//
// The reference app's own extensions (PP-4.6), the worked examples of the
// slice's README: the "App activity" metric group (`metricGroups`, rung 2,
// `platform-extensions/telemetry/activity.metric-group.ts`) and the verdict
// thresholds (`dashboard.verdictThresholds`, rung 1, equal to the defaults).
// `dashboard.verdictPolicy` (rung 3, `{ useClass: AppVerdictPolicy }`) stays
// unset: an example policy is compiled and tested, never wired, because it
// would change every fork's health verdict
// (`platform-extensions/telemetry/examples/activity-verdict-policy.ts`).
// =============================================================================

import type { Type } from '@nestjs/common';
import { TelemetryModule } from '@marinoscar/platform-api/telemetry';

import { APP_METRIC_GROUPS } from '../../app-registrations/telemetry';
import { ACTIVITY_METRIC_GROUP } from '../../platform-extensions/telemetry/activity.metric-group';
import { REFERENCE_VERDICT_THRESHOLDS } from '../../platform-extensions/telemetry/reference-verdict-thresholds';
import { platformHost } from '../platform-host';
import { TelemetryHostModule } from './telemetry-host.module';

export const telemetryModule = TelemetryModule.forRoot({
  host: platformHost,
  imports: [TelemetryHostModule],
  // The reference app's own group first, then the fork's (`APP_METRIC_GROUPS`, empty upstream).
  metricGroups: [ACTIVITY_METRIC_GROUP, ...APP_METRIC_GROUPS],
  dashboard: { verdictThresholds: REFERENCE_VERDICT_THRESHOLDS },
});

/**
 * The configured module's controller classes, by class name, so a test can
 * read a route's metadata (`telemetryControllers.TelemetryStackController.prototype.deploy`).
 */
export const telemetryControllers: Readonly<Record<string, Type<unknown>>> = Object.freeze(
  Object.fromEntries((telemetryModule.controllers ?? []).map((controller) => [controller.name, controller])),
);

/**
 * The configured module's provider classes, by class name, for tests that
 * reach a provider the slice does not export (`app.get(telemetryProviders.TelemetryDashboardService)`).
 * Production code injects only what the slice exports.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const telemetryProviders: Readonly<Record<string, Type<any>>> = Object.freeze(
  Object.fromEntries(
    (telemetryModule.providers ?? [])
      .filter((provider): provider is Type<unknown> => typeof provider === 'function')
      .map((provider) => [provider.name, provider]),
  ),
);
