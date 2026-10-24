import {
  BUILTIN_METRIC_UNITS,
  METRIC_UNIT_ID_PATTERN,
  metricUnitDescriptorSchema,
  type MetricUnitDescriptor,
} from '@marinoscar/platform-contract/telemetry';

import { defineRegistry, type Registry } from '../../core/index';

// =============================================================================
// The metric-unit registry (PP-14.18)
// =============================================================================
//
// The units a tile, series or table column may carry. `METRIC_UNITS` used to be
// a closed list that `assertUnit` (metric-group.registry.ts) checked a group's
// families against; now the check is `metricUnitRegistry.has(unit)`, so an app
// registers `usd`, `tokens` or `nudges` once, at import time, and uses it in
// its families, ratios, table columns and presentation.
//
// The platform's own fifteen units register through the SAME function below: no
// private fast path. The web formats a built-in id with its own formatter (so
// the six platform groups render exactly as they always did) and an app unit
// from its descriptor, which `/metric-groups` serves with every group that uses
// one.
//
// ⚠ FRAMEWORK-FREE, like the metric-group registry it serves: the DTOs read it
// while their module is evaluated. Its only runtime imports are the registry
// primitive and the contract.
// =============================================================================

/**
 * A metric unit: `id`, a human `label`, and how the web formats a value of it.
 * Registered with {@link registerMetricUnit}.
 *
 * @example
 * ```ts
 * registerMetricUnit({ id: 'usd', label: 'US dollars', format: 'currency', currency: 'USD', decimals: 2 });
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export type MetricUnitDef = MetricUnitDescriptor;

/**
 * Every registered metric unit, the platform's first. Frozen once the Nest
 * application has bootstrapped.
 *
 * @stability experimental
 */
export const metricUnitRegistry: Registry<MetricUnitDef> = defineRegistry<MetricUnitDef>({
  name: 'telemetry-metric-units',
  idOf: (unit) => unit.id,
  idPattern: METRIC_UNIT_ID_PATTERN,
  validate: (unit) => {
    const parsed = metricUnitDescriptorSchema.safeParse(unit);
    if (!parsed.success) {
      throw new Error(parsed.error.issues.map((issue) => `${issue.path.join('.') || '(unit)'}: ${issue.message}`).join('; '));
    }
  },
  describeDuplicate: (_existing, incoming) =>
    `Duplicate metric unit id "${incoming.id}": a unit id is registered once (the platform's first, then the app's).`,
});

/**
 * Registers a metric unit, validated against the unit descriptor schema (a
 * currency needs its ISO 4217 code, `suffix` is for numbers, `decimals` is 0 to
 * 6). Call it at import time, before `TelemetryModule.forRoot` registers a
 * group that uses the unit.
 *
 * @param unit - the unit.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID`, or `FROZEN`
 *   once the application has bootstrapped.
 *
 * @example
 * ```ts
 * registerMetricUnit({ id: 'nudges', label: 'Nudges', format: 'number', decimals: 0, suffix: ' nudges' });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerMetricUnit(unit: MetricUnitDef): void {
  metricUnitRegistry.register(unit);
}

/**
 * Every registered unit id: the platform's, then the app's.
 *
 * @returns the ids.
 *
 * @stability experimental
 */
export function metricUnitIds(): string[] {
  return metricUnitRegistry.ids();
}

/**
 * Whether `id` names a registered unit.
 *
 * @param id - anything.
 * @returns `true` for a registered unit id.
 *
 * @stability experimental
 */
export function isMetricUnit(id: unknown): id is string {
  return typeof id === 'string' && metricUnitRegistry.has(id);
}

/** The built-in units, as descriptors (informational: the web formats these ids itself). */
const BUILTIN_UNIT_DEFS: Readonly<Record<(typeof BUILTIN_METRIC_UNITS)[number], MetricUnitDef>> = {
  '%': { id: '%', label: 'Percent', format: 'percent' },
  bytes: { id: 'bytes', label: 'Bytes', format: 'bytes' },
  'bytes/s': { id: 'bytes/s', label: 'Bytes per second', format: 'bytes' },
  count: { id: 'count', label: 'Count', format: 'number', decimals: 0 },
  per_s: { id: 'per_s', label: 'Per second', format: 'number', decimals: 2, suffix: '/s' },
  per_min: { id: 'per_min', label: 'Per minute', format: 'number', decimals: 2, suffix: '/min' },
  ms: { id: 'ms', label: 'Milliseconds', format: 'duration-ms' },
  seconds: { id: 'seconds', label: 'Seconds', format: 'duration-s' },
  hours: { id: 'hours', label: 'Hours', format: 'number', decimals: 1, suffix: ' h' },
  days: { id: 'days', label: 'Days', format: 'number', decimals: 1, suffix: ' days' },
  cores: { id: 'cores', label: 'CPU cores', format: 'number', decimals: 2, suffix: ' cores' },
  load: { id: 'load', label: 'Load average', format: 'number', decimals: 2 },
  timestamp: { id: 'timestamp', label: 'Timestamp', format: 'timestamp' },
  text: { id: 'text', label: 'Text', format: 'text' },
  boolean: { id: 'boolean', label: 'Yes or no', format: 'boolean' },
};

for (const id of BUILTIN_METRIC_UNITS) registerMetricUnit(BUILTIN_UNIT_DEFS[id]);

/** The built-in unit ids, for "is this one the app's?". */
export const BUILTIN_UNIT_ID_SET: ReadonlySet<string> = new Set<string>(BUILTIN_METRIC_UNITS);
