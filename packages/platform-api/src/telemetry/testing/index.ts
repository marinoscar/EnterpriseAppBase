// `@marinoscar/platform-api/telemetry/testing`: test fixtures and seams of the
// telemetry slice (issue #703), for an app's own tests. Never import it from
// production code. Documented in ../README.md.

export {
  APP_ACTIVITY_METRIC_TAGS,
  APP_SAMPLE_METRIC_TAGS,
  VERIFIED_METRIC_TAGS,
  appActivityMetricSchema,
  appSampleMetricSchema,
  metricCatalogSchema,
  metricTableSchema,
} from './metric-schema.fixture';
export { COACH_METRIC_GROUP, COACH_METRIC_GROUP_ID } from './coach-metric-group.fixture';
export { assistantMetricWindow, NODE_FLAGS } from '../assistant/telemetry-assistant.metrics';
export { buildTelemetryAssistantInstructions } from '../assistant/telemetry-assistant.service';
export type { MetricGroupWindow } from '../metrics/metric-group';

// The telemetry conformance suite (PP-4.6): importing this entry registers the
// `telemetry` suite with `runPlatformConformance` (@marinoscar/platform-api/testing).
export {
  CONFORMANCE_SECRETS,
  TELEMETRY_CRON_FILE,
  bootStubApp,
  checkBootsWithoutTelemetry,
  checkCronCoverage,
  checkDoctorReadOnly,
  checkMetricGroups,
  checkMetricGroupsOnEmptySchema,
  checkNoSecretsInResponses,
  checkRoutePermissions,
  discoverDoctorChecks,
  discoverRoutes,
  telemetryConformanceSuite,
} from './conformance';
export type {
  ComputeMetricGroup,
  CreateConformanceApp,
  StubAppInput,
  TelemetryConformanceOptions,
  TelemetryRoute,
} from './conformance';
export { createStubTelemetryPorts } from './stub-ports';
export type { StubTelemetryPortsOptions, StubTelemetryPortsState } from './stub-ports';
