// =============================================================================
// The gauge-provider seam (issue #606; generalised by issue #700)
// =============================================================================
//
// Observable gauges are different from counters and histograms: their
// callbacks QUERY something (a table, a fleet), so they belong to the module
// that owns that something, not to the metrics host. The host hands such a
// provider its meter, clock and export gate (`AppGaugeContext`), and only
// when gauges are on for this process; the provider creates its gauges from
// their registry declarations (`createRegisteredGauge`) and returns early
// from its callback while the gate is closed, so a deployment with telemetry
// off never pays for a single query.
// =============================================================================

import type { Meter, ObservableGauge } from '@opentelemetry/api';

import { appMetricRegistry, type AppMetricKeys } from './metric-name.registry';

/**
 * A registered metric's code key: one an app typed by augmenting
 * `AppMetricKeys`, or any string (checked against the registry at run time).
 *
 * @stability experimental
 */
export type AppMetricKeyLike = (keyof AppMetricKeys & string) | (string & {});

/**
 * What a gauge provider needs to follow the host's conventions.
 *
 * @stability stable
 */
export interface AppGaugeContext {
  /** The `app` meter. */
  meter: Meter;
  /** The clock, in epoch milliseconds (a test seam). */
  now: () => number;
  /** Whether the runtime export gate is open; a callback queries nothing while it is closed. */
  gateOpen: () => boolean;
}

/**
 * A gauge provider: creates its gauges and their callback from the context.
 * Called once, and only when gauges are on for this process.
 *
 * @stability experimental
 */
export type GaugeProvider = (context: AppGaugeContext) => void;

/**
 * Creates the observable gauge DECLARED under `key` in the app-metric
 * registry, with its registered name, unit and description. For gauge
 * providers: the callback is theirs, the descriptor is the registry's.
 *
 * @param meter - The meter from {@link AppGaugeContext}.
 * @param key - The gauge's registry key.
 * @returns The created gauge.
 * @throws RegistryError `UNKNOWN_ID` when no metric is declared under `key`;
 *   `Error` when the declared metric is not a gauge.
 *
 * @stability stable
 */
export function createRegisteredGauge(meter: Meter, key: AppMetricKeyLike): ObservableGauge {
  const def = appMetricRegistry.require(key);
  if (def.kind !== 'gauge') throw new Error(`App metric "${key}" is a ${def.kind}, not a gauge.`);
  return meter.createObservableGauge(def.name, { description: def.description, unit: def.unit });
}
