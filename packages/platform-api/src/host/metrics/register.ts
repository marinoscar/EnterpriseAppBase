// =============================================================================
// Registering the platform's app metrics (issue #867; registry #680)
// =============================================================================
//
// The app-metric registry (`@marinoscar/platform-api/otel-core`) is a static
// registry: filled before bootstrap, frozen after. The reference app used to
// register the platform's 31 metrics and the event bus's three from its own
// manifest; the host slice owns both declarations now, so it registers them.
// `PlatformHostCoreModule.forRoot()` calls this; an app's manifest may call it
// first to fix the order explicitly (platform first, then the slices' and its
// own with `registerAppMetrics`), so a key or name collision names the app.
// =============================================================================

import { appMetricRegistry, registerAppMetrics, type AppMetricDef } from '../../otel-core/index';
import { EVENT_BUS_APP_METRICS } from '../event-bus/event-bus.metrics';
import { PLATFORM_APP_METRICS } from './platform-app-metrics';

/**
 * Registers the platform's app metrics ({@link PLATFORM_APP_METRICS}, then the
 * event bus's `app.event_bus.*` counters) once, then each list in
 * `appMetrics`, in order. Idempotent for the platform's own: a second call
 * registers only the lists it is given. Call it before bootstrap (the registry
 * freezes after); `PlatformHostCoreModule.forRoot()` calls it with no lists.
 *
 * @param appMetrics - further declarations (a slice's, the app's own), registered after the platform's.
 * @throws RegistryError on a duplicate key or name, or a declaration the registry refuses.
 *
 * @example
 * ```ts
 * // apps/api/src/common/otel/app-metric.manifest.ts
 * registerPlatformHostAppMetrics(ORGANIZATIONS_APP_METRICS, SHARING_APP_METRICS, APP_METRICS);
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerPlatformHostAppMetrics(...appMetrics: ReadonlyArray<readonly AppMetricDef[]>): void {
  if (!appMetricRegistry.has(PLATFORM_APP_METRICS[0].key)) {
    registerAppMetrics(PLATFORM_APP_METRICS);
    registerAppMetrics(EVENT_BUS_APP_METRICS);
  }
  for (const list of appMetrics) registerAppMetrics(list);
}
