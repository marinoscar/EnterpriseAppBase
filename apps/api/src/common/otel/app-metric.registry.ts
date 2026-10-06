import { defineRegistry, RegistryError, type Registry } from '../registry';

// =============================================================================
// The app-metric registry (issue #680, epic #660)
// =============================================================================
//
// Every `app.*` OpenTelemetry instrument the API exports is DECLARED here: its
// stable code key, its OTLP name, kind, unit, description, histogram buckets
// and the attribute keys it may carry. `AppMetricsService` creates the
// counters and histograms from it, and the gauge providers (its own
// `registerGauges()`, `nodes/node-fleet-metrics.service.ts`) read their
// names, units and descriptions from it. So the conventions in the service
// header (names, units, low-cardinality labels) have ONE table, and an app
// adds its own metrics without editing a platform file: it lists them in
// `APP_METRICS` (`app-registrations/telemetry.ts`) and emits them with
// `AppMetricsService.add(key, …)` / `.record(key, …)`.
//
// The platform's own declarations are `platform-app-metrics.ts`; the manifest
// `app-metric.manifest.ts` registers them, then the app's. Read the registry
// through `app-metrics.service.ts` (which imports the manifest), never through
// this file alone.
//
// ⚠ FRAMEWORK-FREE (a static registry, common/registry/README.md): it imports
// only the registry primitive.
//
// Every rule runs at REGISTRATION, so a malformed metric fails at import time.
// =============================================================================

/** The OTel instrument kind. Gauges are declared for their name/unit/description; their callbacks stay code. */
export type AppMetricKind = 'counter' | 'histogram' | 'gauge';

/**
 * How one attribute is bounded before it becomes a label (a GreptimeDB column).
 *
 * - `enum`: the value must be one of `values`, else it is exported as `other`.
 * - `free`: an identifier-shaped string through `AppMetricsService.boundLabel`
 *   (at most 64 characters of `[A-Za-z0-9_.:/@+-]`, never address-shaped, and
 *   at most `MAX_DISTINCT_VALUES` distinct values per attribute key per
 *   process); anything else becomes `other` (or `unknown` when empty).
 *
 * Neither admits a user id, an e-mail, a URL or an error message as a label:
 * declare an attribute only for a low-cardinality dimension (a type, a status,
 * an outcome, a provider).
 */
export type AppMetricAttribute = { kind: 'enum'; values: readonly string[] } | { kind: 'free' };

/** One declared `app.*` metric. */
export interface AppMetricDef {
  /** Stable code key, e.g. `jobsEnqueued`: what `add`/`record` and `APP_METRIC_NAMES` use. lowerCamelCase. */
  key: string;
  /** OTLP name, e.g. `app.jobs.enqueued`: `app.` then dot-separated snake_case segments. Permanent. */
  name: string;
  kind: AppMetricKind;
  /** OTel unit: `s`, `By`, `{job}`, `1` … (it picks the GreptimeDB table suffix, docs §11.3). */
  unit: string;
  description: string;
  /** Histogram bucket boundaries, ascending, in `unit`. Histograms only. */
  buckets?: readonly number[];
  /** The attribute keys the metric may carry (snake_case, no dots); any other key is dropped. */
  attributes?: Readonly<Record<string, AppMetricAttribute>>;
}

/**
 * The augmentable set of APP metric keys. The platform's keys are typed from
 * `PLATFORM_APP_METRICS`; an app adds its own in `app-registrations/telemetry.ts`:
 *
 * ```ts
 * declare module '../common/otel/app-metric.registry' {
 *   interface AppMetricKeys { coachNudgesSent: true }
 * }
 * ```
 */
export interface AppMetricKeys {}

/** `app.` then one or more dot-separated snake_case segments. */
export const APP_METRIC_NAME_PATTERN = /^app(\.[a-z][a-z0-9_]*)+$/;
/** Attribute keys become columns: snake_case, no dots (a dotted column needs quoting in every statement). */
export const APP_METRIC_ATTRIBUTE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
/** Code keys are lowerCamelCase. */
export const APP_METRIC_KEY_PATTERN = /^[a-z][A-Za-z0-9]*$/;

const KINDS = new Set<string>(['counter', 'histogram', 'gauge']);

function assertText(value: unknown, where: string): void {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${where} must be a non-empty string.`);
}

/**
 * Every rule a declaration must satisfy, against the declarations already
 * known. Throws a plain `Error`. A known declaration with the SAME key is
 * ignored, so re-registering a key reports the registry's `DUPLICATE_ID`.
 */
export function assertAppMetric(def: AppMetricDef, known: readonly AppMetricDef[]): void {
  const where = `App metric "${def.key}"`;

  if (typeof def.name !== 'string' || !APP_METRIC_NAME_PATTERN.test(def.name)) {
    throw new Error(
      `${where} name ${JSON.stringify(def.name)} must start with "app." and match ${APP_METRIC_NAME_PATTERN}.`,
    );
  }
  const clash = known.find((other) => other.key !== def.key && other.name === def.name);
  if (clash) throw new Error(`${where} name "${def.name}" is already declared by "${clash.key}".`);

  if (!KINDS.has(def.kind)) throw new Error(`${where} kind ${JSON.stringify(def.kind)} must be counter, histogram or gauge.`);
  assertText(def.unit, `${where} unit`);
  assertText(def.description, `${where} description`);

  if (def.buckets !== undefined) {
    if (def.kind !== 'histogram') throw new Error(`${where} declares buckets, which only a histogram takes.`);
    if (!Array.isArray(def.buckets) || def.buckets.length === 0) {
      throw new Error(`${where} buckets must be a non-empty array.`);
    }
    def.buckets.forEach((bound, index) => {
      if (typeof bound !== 'number' || !Number.isFinite(bound)) {
        throw new Error(`${where} bucket ${index} is not a finite number.`);
      }
      if (index > 0 && !(bound > def.buckets![index - 1]!)) {
        throw new Error(`${where} buckets must be strictly ascending (bucket ${index}: ${bound}).`);
      }
    });
  }

  for (const [key, attribute] of Object.entries(def.attributes ?? {})) {
    if (!APP_METRIC_ATTRIBUTE_KEY_PATTERN.test(key)) {
      throw new Error(`${where} attribute key "${key}" must be snake_case without dots (${APP_METRIC_ATTRIBUTE_KEY_PATTERN}).`);
    }
    if (attribute?.kind === 'enum') {
      if (!Array.isArray(attribute.values) || attribute.values.length === 0) {
        throw new Error(`${where} attribute "${key}" is an enum without values.`);
      }
      if (attribute.values.some((v) => typeof v !== 'string' || v === '')) {
        throw new Error(`${where} attribute "${key}" enum values must be non-empty strings.`);
      }
    } else if (attribute?.kind !== 'free') {
      throw new Error(`${where} attribute "${key}" kind must be "enum" or "free".`);
    }
  }
}

/**
 * Every declared `app.*` metric, in registration order (platform first, then
 * the app's). Read it through `app-metrics.service.ts`, which imports the
 * manifest that fills it. Frozen once the Nest application has bootstrapped.
 */
export const appMetricRegistry: Registry<AppMetricDef> = defineRegistry<AppMetricDef>({
  name: 'app-metrics',
  idOf: (def) => def.key,
  idPattern: APP_METRIC_KEY_PATTERN,
  validate: (def, registry) => assertAppMetric(def, registry.list()),
  describeDuplicate: (_existing, incoming) =>
    `Duplicate app metric key "${incoming.key}": a metric key is declared once (platform metrics first, then the app's).`,
});

/**
 * Registers `defs`, all or nothing, also refusing two declarations of one
 * batch that share a NAME (the registry's `validate` hook alone does not see a
 * batch's earlier entries).
 *
 * @throws RegistryError `INVALID_ENTRY`, `INVALID_ID`, `DUPLICATE_ID` or `FROZEN`.
 */
export function registerAppMetrics(defs: readonly AppMetricDef[]): void {
  const names = new Map<string, string>();
  for (const def of defs) {
    const earlier = typeof def?.name === 'string' ? names.get(def.name) : undefined;
    if (earlier !== undefined && earlier !== def.key) {
      throw new RegistryError(
        'INVALID_ENTRY',
        appMetricRegistry.name,
        `Invalid entry "${def.key}" in registry "${appMetricRegistry.name}": App metric "${def.key}" name "${def.name}" ` +
          `is already declared by "${earlier}".`,
        { id: def.key },
      );
    }
    if (typeof def?.name === 'string') names.set(def.name, def.key);
  }
  appMetricRegistry.registerAll(defs);
}
