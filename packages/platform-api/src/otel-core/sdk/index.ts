// `@marinoscar/platform-api/otel-core/sdk`: the Nest-free half of the
// otel-core slice (issue #700). Load it FIRST, before Nest or anything the
// auto-instrumentation patches: it imports no `@nestjs/*` module
// (test/otel-core/load-order.spec.ts). Documented in ../README.md.

export {
  DEFAULT_IGNORED_INCOMING_PATHS,
  DEFAULT_OTLP_ENDPOINT,
  METRIC_EXPORT_INTERVAL_MS,
  initializeOtel,
  instrumentationConfig,
  type InitializeOtelOptions,
} from './initialize-otel';
export {
  GatedLogRecordExporter,
  GatedPushMetricExporter,
  GatedSpanExporter,
  stampResource,
  telemetryGate,
  type TelemetryGate,
} from './telemetry-gate';
export { DEFAULT_SERVICE_NAME, resolveServiceName } from './service-name';
export { ATTR_APP_INSTANCE_ID, DEFAULT_INSTANCE_ID, resolveTelemetryInstanceId } from './instance-id';
