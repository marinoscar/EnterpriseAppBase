import type { AppMetricDef } from '@marinoscar/platform-api/otel-core';
import { registerTelemetryStore, type MetricGroupDef } from '@marinoscar/platform-api/telemetry';

import { memoryTelemetryStore } from '../platform-extensions/telemetry/memory-store';

// =============================================================================
// This app's telemetry registrations (issue #680)
// =============================================================================
//
// Upstream keeps both arrays EMPTY FOREVER; a fork fills them in and never
// edits a platform group, a platform metric or a manifest. Pure data: no
// `register()` call for those two, no Nest, no service import (see ./README.md).
// The one `register` call in this file is the telemetry STORE below.
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
//   telemetry stores  `registerTelemetryStore(def)` AT IMPORT TIME (below). The
//                     registry freezes once the application has bootstrapped, and
//                     `platform/telemetry/telemetry.config.ts` imports this file
//                     before it builds the telemetry module. Registering is not
//                     selecting: the module uses `greptime` unless
//                     `TelemetryModule.forRoot({ store: '<id>' })` names another.
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

// -----------------------------------------------------------------------------
// Telemetry stores (PP-14.11)
// -----------------------------------------------------------------------------
//
// The reference app registers the worked example, `memory`: rows held in
// process memory, queried by a tiny SQL engine, no database and no account. It is
// registered so the example is the real thing, but INERT: the reference app's
// `forRoot` does not select it, so a fresh install keeps GreptimeDB and gains
// nothing but a registry entry. A fork that does not want it deletes the
// `registerTelemetryStore` call below (and `platform-extensions/telemetry/memory-store.ts`
// with `memory-sql.ts`). Recipe: docs/EXTENDING.md and the package README of
// `@marinoscar/platform-api/telemetry`.

registerTelemetryStore(memoryTelemetryStore);
