// `@marinoscar/platform-api/otel-core`: the emitting half of telemetry
// (issue #700). The metrics host and its name registry, label bounding, the
// gauge-provider seam, the request span attributes hook, `@Trace()`, and the
// Nest-free `sdk` half re-exported. Documented in ./README.md.
//
// Import `@marinoscar/platform-api/otel-core/sdk`, never this index, from the
// file that installs the SDK: this one loads `@nestjs/common`.

export * from './sdk/index';

export {
  APP_METRIC_ATTRIBUTE_KEY_PATTERN,
  APP_METRIC_KEY_PATTERN,
  APP_METRIC_NAME_PATTERN,
  appMetricRegistry,
  assertAppMetric,
  registerAppMetrics,
  type AppMetricAttribute,
  type AppMetricDef,
  type AppMetricKind,
} from './metrics/metric-name.registry';
export {
  LabelBudget,
  MAX_DISTINCT_VALUES,
  OTHER_LABEL,
  UNKNOWN_LABEL,
  enumLabel,
  nonNegative,
  shapeLabel,
} from './metrics/labels';
export {
  createRegisteredGauge,
  type AppGaugeContext,
  type AppMetricKeyLike,
  type GaugeProvider,
} from './metrics/gauge-provider';
export {
  APP_METER_NAME,
  METRICS_HOST_OPTIONS,
  MetricsHostService,
  type MetricsHostOptions,
} from './metrics/metrics-host.service';
export { OtelMetricsModule, type OtelMetricsModuleAsyncOptions } from './metrics/otel-metrics.module';

export {
  ATTR_APP_REQUEST_BEARER,
  ATTR_APP_ROUTE_MATCHED,
  ATTR_HTTP_ROUTE,
  hasBearer,
  registerRequestSpanAttributes,
  requestSpanAttributesHook,
} from './spans/request-span-attributes';
export { Trace, type TraceOptions } from './spans/trace.decorator';

// ---- `AppMetricKeys`: an augmentation target, declared here, never re-exported (#865) ----

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
