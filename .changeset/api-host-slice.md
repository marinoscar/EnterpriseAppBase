---
"@marinoscar/platform-api": minor
"@marinoscar/platform-cli": patch
---

Add `@marinoscar/platform-api/host` (#867): `PlatformHostCoreModule.forRoot()` packages the API host core every slice assumed, moved from the reference app: the cross-replica event bus (`EVENT_BUS`, `in-process` or `postgres` by `EVENT_BUS_ADAPTER`, with its `core.event-bus` doctor check), the platform's `AppMetricsService` and app-metric declarations (`registerPlatformHostAppMetrics`), maintenance mode (`MaintenanceModeService`, `/api/admin/maintenance`, the `maintenance` settings namespace `MAINTENANCE_SYSTEM_SETTINGS`, the `maintenance.mode` doctor check and `MaintenanceGuard` as the only `APP_GUARD`), the `{ data }` envelope, the request log line, the exception filter and request ids; plus the OpenAPI document and `/api/docs` (`createOpenApiDocument`, `registerPlatformDocs`), and the `host` conformance suite (`@marinoscar/platform-api/host/testing`). `platform-cli`: a comment now names the packaged envelope interceptor.
