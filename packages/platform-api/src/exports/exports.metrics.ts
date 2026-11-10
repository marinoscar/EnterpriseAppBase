// =============================================================================
// Export metrics (issue #744)
// =============================================================================
//
// Declared for the app's metric-name registry (the reference app registers
// them in `common/otel/app-metric.manifest.ts`) and emitted through
// `MetricsHostService`. Exported to Prometheus as `app_exports_total`,
// `app_export_duration_seconds` and `app_export_size_bytes`.
//
// BOUNDED LABELS ONLY: `source` and `format` are bounded by their registries,
// `outcome` is a closed list. Never a user or organization id (an id on a
// label is unbounded cardinality and a tenant identifier in a shared store).
// =============================================================================

import type { AppMetricDef } from '../otel-core/index';

/**
 * Every value of the `outcome` label.
 *
 * @stability experimental
 */
export const EXPORT_OUTCOMES = ['completed', 'failed'] as const;

/**
 * One outcome.
 *
 * @stability experimental
 */
export type ExportOutcome = (typeof EXPORT_OUTCOMES)[number];

/**
 * The code key of `app.exports`, for `MetricsHostService.add`.
 *
 * @stability experimental
 */
export const EXPORTS_RUNS_METRIC = 'exportsRuns';

/**
 * The code key of `app.export.duration`, for `MetricsHostService.record`.
 *
 * @stability experimental
 */
export const EXPORT_DURATION_METRIC = 'exportDuration';

/**
 * The code key of `app.export.size`, for `MetricsHostService.record`.
 *
 * @stability experimental
 */
export const EXPORT_SIZE_METRIC = 'exportSize';

/**
 * The slice's metric declarations. Register them with the app's metric-name
 * registry before the metrics host creates instruments.
 *
 * @example
 * ```ts
 * registerAppMetrics(EXPORTS_APP_METRICS);
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const EXPORTS_APP_METRICS: readonly AppMetricDef[] = [
  {
    key: EXPORTS_RUNS_METRIC,
    name: 'app.exports',
    kind: 'counter',
    unit: '{export}',
    description: 'Settled export attempts, by source, format and outcome.',
    attributes: {
      source: { kind: 'free' },
      format: { kind: 'free' },
      outcome: { kind: 'enum', values: EXPORT_OUTCOMES },
    },
  },
  {
    key: EXPORT_DURATION_METRIC,
    name: 'app.export.duration',
    kind: 'histogram',
    unit: 's',
    description: 'How long one export attempt took, from collecting the first row to the committed file.',
    buckets: [0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 900],
    attributes: {
      source: { kind: 'free' },
      format: { kind: 'free' },
      outcome: { kind: 'enum', values: EXPORT_OUTCOMES },
    },
  },
  {
    key: EXPORT_SIZE_METRIC,
    name: 'app.export.size',
    kind: 'histogram',
    unit: 'By',
    description: 'The size of each produced export file.',
    buckets: [1_024, 16_384, 131_072, 1_048_576, 8_388_608, 67_108_864, 536_870_912],
    attributes: {
      source: { kind: 'free' },
      format: { kind: 'free' },
    },
  },
];
