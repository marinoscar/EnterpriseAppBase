import { defineRegistry, RegistryError, type Registry } from '../../core/index';

// =============================================================================
// The app-metric name registry (issue #680, epic #660; packaged by issue #700)
// =============================================================================
//
// Every `app.*` OpenTelemetry instrument an app exports is DECLARED here: its
// stable code key, its OTLP name, kind, unit, description, histogram buckets
// and the attribute keys it may carry. `MetricsHostService` creates the
// counters and histograms from it, and gauge providers read their names,
// units and descriptions from it (`createRegisteredGauge`). So the
// conventions (names, units, low-cardinality labels) have ONE table, and an
// app adds its own metrics without editing a platform file.
//
// The registry starts EMPTY: the package declares no metric of its own. The
// reference app registers its platform metrics and then its own from a
// manifest (`apps/api/src/common/otel/app-metric.manifest.ts`) that its
// metrics service imports, so every declaration is in before the host
// creates instruments.
//
// FRAMEWORK-FREE (a static registry, see the core slice's registry README):
// it imports only the registry primitive.
//
// Every rule runs at REGISTRATION, so a malformed metric fails at import time.
//
// ONE COPY PER PROCESS: the registry is module-level state (issue #695's
// single-instance check guards the package name).
// =============================================================================

/**
 * The OTel instrument kind. Gauges are declared for their name, unit and
 * description; their callbacks stay code.
 *
 * @stability stable
 */
export type AppMetricKind = 'counter' | 'histogram' | 'gauge';

/**
 * How one attribute is bounded before it becomes a label (a GreptimeDB column).
 *
 * - `enum`: the value must be one of `values`, else it is exported as `other`.
 * - `free`: an identifier-shaped string through `MetricsHostService.boundLabel`
 *   (at most 64 characters of `[A-Za-z0-9_.:/@+-]`, never address-shaped, and
 *   at most `MAX_DISTINCT_VALUES` distinct values per attribute key per
 *   process); anything else becomes `other` (or `unknown` when empty).
 *
 * Neither admits a user id, an e-mail, a URL or an error message as a label:
 * declare an attribute only for a low-cardinality dimension (a type, a status,
 * an outcome, a provider).
 *
 * @stability stable
 */
export type AppMetricAttribute = { kind: 'enum'; values: readonly string[] } | { kind: 'free' };

/**
 * One declared `app.*` metric.
 *
 * @stability stable
 */
export interface AppMetricDef {
  /** Stable code key, e.g. `jobsEnqueued`: what `add`/`record` and `APP_METRIC_NAMES` use. lowerCamelCase. */
  key: string;
  /** OTLP name, e.g. `app.jobs.enqueued`: `app.` then dot-separated snake_case segments. Permanent. */
  name: string;
  /** The instrument kind. */
  kind: AppMetricKind;
  /** OTel unit: `s`, `By`, `{job}`, `1` … (it picks the GreptimeDB table suffix, docs §11.3). */
  unit: string;
  /** One sentence, exported as the instrument's description. */
  description: string;
  /** Histogram bucket boundaries, ascending, in `unit`. Histograms only. */
  buckets?: readonly number[];
  /** The attribute keys the metric may carry (snake_case, no dots); any other key is dropped. */
  attributes?: Readonly<Record<string, AppMetricAttribute>>;
}

/**
 * The augmentable set of app metric keys, so `add`/`record` and
 * `createRegisteredGauge` type-check an app's own keys. An app widens it next
 * to its declarations:
 *
 * ```ts
 * declare module '@marinoscar/platform-api/otel-core' {
 *   interface AppMetricKeys { coachNudgesSent: true }
 * }
 * ```
 *
 * @stability experimental
 */
export interface AppMetricKeys {}

/**
 * `app.` then one or more dot-separated snake_case segments.
 *
 * @stability stable
 */
export const APP_METRIC_NAME_PATTERN = /^app(\.[a-z][a-z0-9_]*)+$/;
/**
 * Attribute keys become columns: snake_case, no dots (a dotted column needs
 * quoting in every statement).
 *
 * @stability stable
 */
export const APP_METRIC_ATTRIBUTE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
/**
 * Code keys are lowerCamelCase.
 *
 * @stability stable
 */
export const APP_METRIC_KEY_PATTERN = /^[a-z][A-Za-z0-9]*$/;

const KINDS = new Set<string>(['counter', 'histogram', 'gauge']);

function assertText(value: unknown, where: string): void {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${where} must be a non-empty string.`);
}

/**
 * Every rule a declaration must satisfy, against the declarations already
 * known. Throws a plain `Error`. A known declaration with the SAME key is
 * ignored, so re-registering a key reports the registry's `DUPLICATE_ID`.
 *
 * @param def - The declaration to check.
 * @param known - The declarations already registered.
 * @throws Error naming the metric and the broken rule.
 *
 * @stability stable
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
 * Every declared `app.*` metric, in registration order. Frozen once the Nest
 * application has bootstrapped (`RegistryFreezeService`). Register through
 * {@link registerAppMetrics}; read with `list()`, `require(key)`, `has(key)`.
 *
 * @extensionPoint registry
 * @stability stable
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
 * batch's earlier entries). Call it at import time, from a manifest the
 * metrics service imports.
 *
 * @param defs - The declarations, in order.
 * @throws RegistryError `INVALID_ENTRY`, `INVALID_ID`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @example
 * ```ts
 * registerAppMetrics([
 *   { key: 'coachNudgesSent', name: 'app.coach.nudges.sent', kind: 'counter', unit: '{nudge}',
 *     description: 'Coach nudges sent.', attributes: { channel: { kind: 'free' } } },
 * ]);
 * ```
 *
 * @extensionPoint registry
 * @stability stable
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
