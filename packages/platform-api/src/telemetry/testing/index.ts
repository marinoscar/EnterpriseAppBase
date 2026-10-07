// `@marinoscar/platform-api/telemetry/testing`: test fixtures and seams of the
// telemetry slice (issue #703), for an app's own tests. Never import it from
// production code. Documented in ../README.md.

export {
  APP_SAMPLE_METRIC_TAGS,
  VERIFIED_METRIC_TAGS,
  appSampleMetricSchema,
  metricCatalogSchema,
  metricTableSchema,
} from './metric-schema.fixture';
export { COACH_METRIC_GROUP, COACH_METRIC_GROUP_ID } from './coach-metric-group.fixture';
export { assistantMetricWindow, NODE_FLAGS } from '../assistant/telemetry-assistant.metrics';
export { buildTelemetryAssistantInstructions } from '../assistant/telemetry-assistant.service';
export type { MetricGroupWindow } from '../metrics/metric-group';
