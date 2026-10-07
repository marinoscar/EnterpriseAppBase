// `@marinoscar/platform-api/telemetry/testing`: test fixtures and seams of the
// telemetry slice (issue #703), for an app's own tests. Never import it from
// production code. Documented in ../README.md.

export { VERIFIED_METRIC_TAGS, metricCatalogSchema, metricTableSchema } from './metric-schema.fixture';
export { assistantMetricWindow, NODE_FLAGS } from '../assistant/telemetry-assistant.metrics';
export { buildTelemetryAssistantInstructions } from '../assistant/telemetry-assistant.service';
