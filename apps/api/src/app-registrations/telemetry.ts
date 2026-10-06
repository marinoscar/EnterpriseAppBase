import type { MetricGroupDef } from '../telemetry/metrics/metric-group.registry';

// =============================================================================
// This app's telemetry registrations (issue #680)
// =============================================================================
//
// Upstream keeps the array EMPTY FOREVER; a fork fills them in and never
// edits a platform group, a platform metric or a manifest. Pure data: no
// `register()` call, no Nest, no service import (see ./README.md).
//
//   APP_METRIC_GROUPS  extra Telemetry Dashboard groups: served by
//                      `/api/admin/telemetry/dashboard/metrics?group=<id>`,
//                      listed by `/metric-groups`, rendered as a dashboard
//                      section and offered to the assistant's
//                      `metrics_overview` tool. Registered after the six
//                      platform groups by `telemetry/metrics/metric-group.manifest.ts`.
//
// Widen the typed group ids by module augmentation, next to the entries:
//
//   declare module '../telemetry/metrics/metric-group.registry' {
//     interface MetricGroupIds { coach: true }
//   }
//
// Recipe: docs/runbooks/telemetry.md, "Adding an app metric group".
// =============================================================================

/** This app's own Telemetry Dashboard metric groups. Upstream keeps this array empty. */
export const APP_METRIC_GROUPS: readonly MetricGroupDef[] = [];
