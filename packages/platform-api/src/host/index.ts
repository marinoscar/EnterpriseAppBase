// `@marinoscar/platform-api/host`: the API host core every slice assumes
// (issue #867): `PlatformHostCoreModule.forRoot()` with the event bus, the
// platform's app metrics, maintenance mode (the only APP_GUARD), the `{ data }`
// envelope, the request log line, the exception filter and request ids; plus
// the OpenAPI document and `/api/docs` (`registerPlatformDocs`). All of it was
// the reference app's own code. Documented in ./README.md.

// ---- The module ---------------------------------------------------------------
export { PlatformHostCoreModule } from './host-core.module';
export { PLATFORM_HOST_CORE_OPTIONS, resolvePlatformHostCoreOptions } from './host-core.options';
export type {
  PlatformHostCoreImport,
  PlatformHostCoreOptions,
  ResolvedPlatformHostCoreOptions,
} from './host-core.options';

// ---- Event bus (PP-1.11, #682) ----------------------------------------------
export {
  EVENT_BUS,
  EVENT_BUS_ADAPTERS,
  EVENT_BUS_CHANNEL_PATTERN,
  EVENT_BUS_MAX_PAYLOAD_BYTES,
  EventBusPayloadTooLargeError,
} from './event-bus/event-bus.interface';
export type {
  EventBus,
  EventBusAdapterName,
  EventBusHandler,
  EventBusHealth,
  EventBusMeta,
} from './event-bus/event-bus.interface';
export { exceedsEventBusPayloadLimit } from './event-bus/event-bus-core';
export { DEFAULT_EVENT_BUS_ADAPTER, EVENT_BUS_SELECTION, parseEventBusAdapter } from './event-bus/event-bus.config';
export type { EventBusSelection } from './event-bus/event-bus.config';
export { EVENT_BUS_APP_METRICS, NOOP_EVENT_BUS_METRICS, eventBusMetricsVia } from './event-bus/event-bus.metrics';
export type { EventBusMetrics, EventBusPublishOutcome } from './event-bus/event-bus.metrics';
export { InProcessEventBus } from './event-bus/in-process-event-bus';
export {
  DEFAULT_INITIAL_BACKOFF_MS,
  DEFAULT_MAX_BACKOFF_MS,
  EVENT_BUS_LISTENER_APPLICATION_NAME,
  EVENT_BUS_PG_CHANNEL,
  PostgresEventBus,
  eventBusBackoffMs,
} from './event-bus/postgres-event-bus';
export type {
  EventBusListenerClient,
  EventBusSqlPublisher,
  PostgresEventBusOptions,
} from './event-bus/postgres-event-bus';

// ---- App metrics (#600, #680) -------------------------------------------------
export {
  APP_METRICS_OPTIONS,
  AppMetricsService,
  GAUGE_CACHE_TTL_MS,
  createRegisteredGauge,
  fallbackAppMetrics,
} from './metrics/app-metrics.service';
export type {
  AiUsageMetric,
  AppMetricKey,
  AppMetricsGaugeClient,
  AppMetricsOptions,
  AuthLoginOutcome,
  AuthRefreshOutcome,
  BackupOutcome,
  GaugeSnapshot,
  JobExecutorLabel,
  JobReapOutcome,
  NotificationDeliveryOutcome,
} from './metrics/app-metrics.service';
export { PLATFORM_APP_METRICS } from './metrics/platform-app-metrics';
export type { PlatformAppMetricKey } from './metrics/platform-app-metrics';
export { registerPlatformHostAppMetrics } from './metrics/register';

// ---- Maintenance mode (#257) --------------------------------------------------
export {
  MAINTENANCE_AUDIT_DISABLE,
  MAINTENANCE_AUDIT_ENABLE,
  MAINTENANCE_AUDIT_TARGET_ID,
  MAINTENANCE_AUDIT_TARGET_TYPE,
  MAINTENANCE_PERSISTED_CACHE_MS,
  MaintenanceModeService,
} from './maintenance/maintenance-mode.service';
export type {
  MaintenanceOverride,
  MaintenanceSource,
  MaintenanceStatus,
  SetMaintenanceInput,
} from './maintenance/maintenance-mode.service';
export {
  MAINTENANCE_ERROR_MARKER,
  MAINTENANCE_RETRY_AFTER_SECONDS,
  MaintenanceGuard,
  OPAQUE_BEARER_PREFIXES,
} from './maintenance/maintenance.guard';
export {
  MaintenanceStatusDto,
  UpdateMaintenanceDto,
  maintenanceStatusSchema,
  updateMaintenanceSchema,
} from './maintenance/dto/update-maintenance.dto';
export { MAINTENANCE_SYSTEM_SETTINGS, mergeMaintenanceSettings } from './maintenance/maintenance.system-settings';
export {
  DEFAULT_MAINTENANCE_MESSAGE,
  maintenanceResponseSchema,
  maintenanceSettingsPatchSchema,
  maintenanceSettingsSchema,
  systemMaintenancePatchSchema,
  systemMaintenanceSchema,
} from './maintenance/maintenance.schemas';
export type { SystemMaintenanceValue } from './maintenance/maintenance.schemas';

// ---- The HTTP layer: envelope, request log line, request ids -----------------
export { TransformInterceptor } from './http/transform.interceptor';
export type { ApiEnvelope } from './http/transform.interceptor';
export { LoggingInterceptor } from './http/logging.interceptor';
export { RequestIdMiddleware } from './http/request-id.middleware';

// ---- OpenAPI and /api/docs (#53) ---------------------------------------------
export {
  SECURITY_SCHEMES,
  buildOpenApiConfig,
  buildOperationId,
  createOpenApiDocument,
  enrichOpenApiDocument,
  isAuthenticatedOperation,
  resolveOpenApiVersion,
} from './openapi/document';
export type { PlatformOpenApiOptions } from './openapi/document';
export { buildApiDescription } from './openapi/description';
export type { ApiDescriptionIdentity } from './openapi/description';
export {
  DOCS_PATH,
  DOCS_UNAVAILABLE_MESSAGE,
  OPENAPI_JSON_PATH,
  OPENAPI_UNAVAILABLE_CODE,
  registerDocsRoutes,
  registerDocsRoutesOrDegrade,
  registerPlatformDocs,
} from './openapi/register-docs-routes';
export type { DocsHostApplication, DocsLogger, DocsRoutesOptions } from './openapi/register-docs-routes';
export {
  DEFAULT_SCALAR_CDN,
  SESSION_SECURITY_SCHEME,
  buildDocsAuthScript,
  renderDocsPage,
  renderDocsUnavailablePage,
} from './openapi/docs-page';
export type { DocsPageOptions, DocsUnavailablePageOptions } from './openapi/docs-page';
export { resolveApiVersion } from './openapi/version';
export { REQUIREMENTS_MARKER } from './openapi/rbac-docs';
export { HTTP_METHODS, forEachOperation } from './openapi/types';
export type { DocOperation, DocPathItem, MutableDocument } from './openapi/types';
