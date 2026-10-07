import type { AppMetricDef } from '@marinoscar/platform-api/otel-core';
import type { MetricGroupDef } from '@marinoscar/platform-api/telemetry';

// =============================================================================
// This app's telemetry registrations (issue #680)
// =============================================================================
//
// Upstream keeps both arrays EMPTY FOREVER; a fork fills them in and never
// edits a platform group, a platform metric or a manifest. Pure data: no
// `register()` call, no Nest, no service import (see ./README.md).
//
//   APP_METRIC_GROUPS  extra Telemetry Dashboard groups: served by
//                      `/api/admin/telemetry/dashboard/metrics?group=<id>`,
//                      listed by `/metric-groups`, rendered as a dashboard
//                      section and offered to the assistant's
//                      `metrics_overview` tool. Registered after the six
//                      platform groups by `TelemetryModule.forRoot({ metricGroups })`
//                      (`app.module.ts`).
//   APP_METRICS        extra `app.*` instruments: counters and histograms are
//                      created by `AppMetricsService` and emitted with
//                      `metrics.add(key, value, attributes)` /
//                      `metrics.record(key, value, attributes)`; a gauge is
//                      declared here and created by its own provider through
//                      `createRegisteredGauge(gaugeContext().meter, key)`.
//                      Registered after the platform metrics by
//                      `common/otel/app-metric.manifest.ts`.
//
// Widen the typed group ids and metric keys by module augmentation, next to the entries:
//
//   declare module '@marinoscar/platform-api/telemetry' {
//     interface MetricGroupIds { coach: true }
//   }
//   declare module '@marinoscar/platform-api/otel-core' {
//     interface AppMetricKeys { coachNudgesSent: true }
//   }
//
// Recipe: docs/runbooks/telemetry.md, "Adding an app metric group".
// =============================================================================

/** This app's own Telemetry Dashboard metric groups. Upstream keeps this array empty. */
export const APP_METRIC_GROUPS: readonly MetricGroupDef[] = [];

/** This app's own `app.*` metrics. Upstream keeps this array empty. */
export const APP_METRICS: readonly AppMetricDef[] = [];
