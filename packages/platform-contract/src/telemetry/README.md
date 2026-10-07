# @marinoscar/platform-contract/telemetry

The wire shapes of the telemetry surfaces: the config and status routes, the explorer (query, schema, export), the GreptimeDB connection, the telemetry services (stack), the dashboard and the AI assistant, plus the stored `telemetry` settings namespace, as zod schemas with their inferred types, and the zod-free limits and enums they are built from. The API wraps the schemas as its nestjs-zod DTOs (`apps/api/src/telemetry/**/dto/*.ts`, so the OpenAPI document is generated from them); the web app's telemetry client (`apps/web/src/services/telemetry.ts`, `telemetryDashboard.ts`) takes its types and constants from here. Added by #702; it depends on no other slice (`packages/platform-slices.json`).

## Purpose and scope

One source for what every telemetry route sends and accepts, so the API and the web app can no longer drift apart. The slice follows the contract layout with the schemas split by route group: `constants.ts` (zod-free: `TELEMETRY_LIMITS`, the patterns, every enum list, the dashboard ranges, the assistant limits), `schemas.ts` (the barrel of `settings.ts`, `config.ts`, `status.ts`, `query.ts`, `connection.ts`, `stack.ts`, `dashboard.ts` and `assistant.ts`) and `index.ts`.

Not here: the services, controllers, SQL guard, GreptimeDB client and metric-group registry (the API), the pages, hooks and display labels (the web app), the server-only connection constants (`TELEMETRY_CONNECTION_SETTINGS_KEY`, the credential purpose, the deployment host resolution) and the node span wire shape (the jobs and nodes slice). The full slice documentation follows with the telemetry slices of `platform-api` and `platform-web`.

## Install and peer dependencies

Ships inside `@marinoscar/platform-contract`; import it by its subpath:

```ts
import { telemetryStatusSchema, TELEMETRY_LIMITS } from '@marinoscar/platform-contract/telemetry';
import type { TelemetryStatus, DashboardRange } from '@marinoscar/platform-contract/telemetry';
```

None beyond the package's own peer, `zod` (`^4.4.3`). A browser that imports only the constants and the types never bundles `zod`: the package is `"sideEffects": false` and `constants.ts` imports no zod, so the bundler drops the schema modules. The web app's telemetry client imports nothing else (`apps/web/src/__tests__/services/telemetryContract.test.ts` checks it).

## Quick start

The API wraps a schema as its DTO and re-exports the type under its historic name ([`telemetry-status.dto.ts`](../../../../apps/api/src/telemetry/dto/telemetry-status.dto.ts)):

```ts
import { createZodDto } from 'nestjs-zod';
import { telemetryStatusSchema } from '@marinoscar/platform-contract/telemetry';

export class TelemetryStatusDto extends createZodDto(telemetryStatusSchema) {}
export type { TelemetryStatus } from '@marinoscar/platform-contract/telemetry';
```

The web app aliases the type and validates its fixtures with the schema ([`telemetryContract.test.ts`](../../../../apps/web/src/__tests__/services/telemetryContract.test.ts)):

```ts
import type { TelemetryStatus as ContractTelemetryStatus } from '@marinoscar/platform-contract/telemetry';

export type TelemetryStatus = ContractTelemetryStatus;
```

A server that registers its own metric groups builds the `/metrics` schemas around its group schema, checked live and documented as an enum ([`telemetry-dashboard.dto.ts`](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts)):

```ts
export const telemetryDashboardMetricsQuerySchema = createTelemetryDashboardMetricsQuerySchema(
  metricGroupQuerySchema({ documented: METRIC_GROUPS, isKnown: isMetricGroup, knownIds: metricGroupIds }),
);
```

## Configuration

None. Schemas and constants take no options; the routes' paths and permissions are the API's.

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `telemetryInstanceIdSchema` | schema | `ZodString` (regex) | Validate an instance id in an app-side schema of its own | stable | [example](../../../../apps/api/src/common/schemas/settings.schema.ts) |
| `telemetrySettingsSchema` | schema | `ZodObject<{ enabled; retentionDays; instanceId; query; assistant }>` | Validate or `.extend()` the stored `telemetry` namespace | stable | [example](../../../../apps/api/src/common/schemas/settings.schema.ts) |
| `updateTelemetryConfigSchema` | schema | `ZodObject<{ enabled; retentionDays; instanceId; query; assistant }>` | Validate or `.extend()` the config routes' body or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-config.dto.ts) |
| `telemetryConfigResponseSchema` | schema | `ZodObject<{ enabled; retentionDays; instanceId; query; assistant; available; retentionApplicable; instanceIdDefault; instanceIdEffective; version; updatedAt; updatedBy }>` | Validate or `.extend()` the config routes' body or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-config.dto.ts) |
| `telemetryPublicConfigSchema` | schema | `ZodObject<{ available; enabled; assistantEnabled }>` | Validate or `.extend()` the config routes' body or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-config.dto.ts) |
| `telemetryTtlSchema` | schema | `ZodObject<{ raw; days }>` | Validate or `.extend()` the status diagnosis | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-status.dto.ts) |
| `telemetryTableSchema` | schema | `ZodObject<{ name; rows }>` | Validate or `.extend()` the status diagnosis | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-status.dto.ts) |
| `telemetryStatusSchema` | schema | `ZodObject<{ configured; reachable; version; database; ttl; retentionDays; tables; error }>` | Validate or `.extend()` the status diagnosis | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-status.dto.ts) |
| `telemetrySqlSchema` | schema | `ZodString` (1..20000) | Validate a statement in an app-side schema of its own | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-query.dto.ts) |
| `telemetryQueryRequestSchema` | schema | `ZodObject<{ sql; maxRows }>` | Validate or `.extend()` an explorer request or result | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-query.dto.ts) |
| `telemetryColumnSchema` | schema | `ZodObject<{ name; type }>` | Validate or `.extend()` an explorer request or result | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-query.dto.ts) |
| `telemetryQueryResultSchema` | schema | `ZodObject<{ columns; rows; rowCount; truncated; elapsedMs }>` | Validate or `.extend()` an explorer request or result | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-query.dto.ts) |
| `telemetrySchemaColumnSchema` | schema | `ZodObject<{ name; type; semanticType }>` | Validate or `.extend()` an explorer request or result | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-query.dto.ts) |
| `telemetrySchemaTableSchema` | schema | `ZodObject<{ name; rows; columns }>` | Validate or `.extend()` an explorer request or result | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-query.dto.ts) |
| `telemetrySchemaSchema` | schema | `ZodObject<{ tables }>` | Validate or `.extend()` an explorer request or result | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-query.dto.ts) |
| `telemetryExportRequestSchema` | schema | `ZodObject<{ sql; format }>` | Validate or `.extend()` an explorer request or result | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-query.dto.ts) |
| `telemetryHostSchema` | schema | `ZodString` | Validate a stored connection value or one of its fields in app code | stable | [example](../../../../apps/api/src/telemetry/connection/telemetry-connection.schema.ts) |
| `telemetryOptionalHostSchema` | schema | `ZodPipe` (a string, `null` or absent, to a host or `null`) | Validate a stored connection value or one of its fields in app code | stable | [example](../../../../apps/api/src/telemetry/connection/telemetry-connection.schema.ts) |
| `telemetryPgPortSchema` | schema | `ZodNumber` | Validate a stored connection value or one of its fields in app code | stable | [example](../../../../apps/api/src/telemetry/connection/telemetry-connection.schema.ts) |
| `telemetryDatabaseSchema` | schema | `ZodString` | Validate a stored connection value or one of its fields in app code | stable | [example](../../../../apps/api/src/telemetry/connection/telemetry-connection.schema.ts) |
| `telemetryUserSchema` | schema | `ZodString` | Validate a stored connection value or one of its fields in app code | stable | [example](../../../../apps/api/src/telemetry/connection/telemetry-connection.schema.ts) |
| `telemetryCustomConnectionValueSchema` | schema | `ZodObject<{ host; pgPort; database; readerUser; adminUser }>` | Validate a stored connection value or one of its fields in app code | stable | [example](../../../../apps/api/src/telemetry/connection/telemetry-connection.schema.ts) |
| `telemetryAutomaticConnectionValueSchema` | schema | `ZodObject<{ host }>` | Validate a stored connection value or one of its fields in app code | stable | [example](../../../../apps/api/src/telemetry/connection/telemetry-connection.schema.ts) |
| `telemetryConnectionValueSchema` | schema | `ZodUnion<[{ host; pgPort; database; readerUser; adminUser }, { host }]>` | Validate a stored connection value or one of its fields in app code | stable | [example](../../../../apps/api/src/telemetry/connection/telemetry-connection.schema.ts) |
| `updateTelemetryConnectionSchema` | schema | `ZodObject<{ host; pgPort; database; readerUser; readerPassword; adminUser; adminPassword }>` | Validate or `.extend()` a connection request, response or probe | stable | [example](../../../../apps/api/src/telemetry/connection/dto/telemetry-connection.dto.ts) |
| `testTelemetryConnectionSchema` | schema | `ZodObject<{ host; pgPort; database; readerUser; readerPassword; adminUser; adminPassword }>` | Validate or `.extend()` a connection request, response or probe | stable | [example](../../../../apps/api/src/telemetry/connection/dto/telemetry-connection.dto.ts) |
| `telemetryCredentialStatusSchema` | schema | `ZodObject<{ configured; hint; updatedAt; updatedByUserId }>` | Validate or `.extend()` a connection request, response or probe | stable | [example](../../../../apps/api/src/telemetry/connection/dto/telemetry-connection.dto.ts) |
| `telemetryDeploymentConnectionSchema` | schema | `ZodObject<{ host; pgPort; database; readerUser; adminUser; readerConfigured; adminConfigured }>` | Validate or `.extend()` a connection request, response or probe | stable | [example](../../../../apps/api/src/telemetry/connection/dto/telemetry-connection.dto.ts) |
| `telemetryConnectionResponseSchema` | schema | `ZodObject<{ source; host; effectiveHost; hostMode; deploymentManaged; deployment; problem; pgPort; database; readerUser; adminUser; configured; adminConfigured; credentials; version; updatedAt; updatedBy }>` | Validate or `.extend()` a connection request, response or probe | stable | [example](../../../../apps/api/src/telemetry/connection/dto/telemetry-connection.dto.ts) |
| `telemetryConnectionProbeSchema` | schema | `ZodObject<{ success; latencyMs; version; error }>` | Validate or `.extend()` a connection request, response or probe | stable | [example](../../../../apps/api/src/telemetry/connection/dto/telemetry-connection.dto.ts) |
| `telemetryConnectionSkippedSchema` | schema | `ZodObject<{ skipped }>` | Validate or `.extend()` a connection request, response or probe | stable | [example](../../../../apps/api/src/telemetry/connection/dto/telemetry-connection.dto.ts) |
| `telemetryConnectionTestResultSchema` | schema | `ZodObject<{ host; hostMode; reader; admin }>` | Validate or `.extend()` a connection request, response or probe | stable | [example](../../../../apps/api/src/telemetry/connection/dto/telemetry-connection.dto.ts) |
| `telemetryStackServiceSchema` | schema | `ZodObject<{ name; state; health }>` | Validate or `.extend()` the telemetry services status | stable | [example](../../../../apps/api/src/telemetry/stack/dto/telemetry-stack.dto.ts) |
| `telemetryStackDeploySchema` | schema | `ZodObject<{ jobId; status; createdAt; finishedAt; error; output }>` | Validate or `.extend()` the telemetry services status | stable | [example](../../../../apps/api/src/telemetry/stack/dto/telemetry-stack.dto.ts) |
| `telemetryStackStatusSchema` | schema | `ZodObject<{ agent; agentError; services; deploy }>` | Validate or `.extend()` the telemetry services status | stable | [example](../../../../apps/api/src/telemetry/stack/dto/telemetry-stack.dto.ts) |
| `telemetryStackDeployStartedSchema` | schema | `ZodObject<{ jobId }>` | Validate or `.extend()` the telemetry services status | stable | [example](../../../../apps/api/src/telemetry/stack/dto/telemetry-stack.dto.ts) |
| `telemetryDashboardQuerySchema` | schema | `ZodObject<{ range; from; to; service; instance; buckets }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `telemetryDashboardTimeseriesQuerySchema` | schema | `ZodObject<{ range; from; to; service; instance; buckets; panel }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `telemetryDashboardTopQuerySchema` | schema | `ZodObject<{ range; from; to; service; instance; buckets; kind }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `telemetryDashboardEventsQuerySchema` | schema | `ZodObject<{ range; from; to; service; instance; buckets; severity; q; cursor }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `metricGroupIdSchema` | schema | `ZodString` (regex) | Validate a metric group id when the registered set is not known | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `metricGroupQuerySchema()` | schema | `(options: MetricGroupQueryOptions<G>) => ZodType<G, string>` | Build a `/metrics` `group` schema checked against a live registry and documented as an enum (the API does) | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `createTelemetryDashboardMetricsQuerySchema()` | schema | `(group: G) => ZodObject<{ …common; group; host }>` | Build the `/metrics` schema around the group schema a server knows (the API passes its registry's) | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `telemetryDashboardMetricsQuerySchema` | schema | `ZodObject<{ range; from; to; service; instance; buckets; group; host }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `telemetryDashboardEnvelopeSchema` | schema | `ZodObject<{ range; generatedAt; truncated; sql }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `telemetryDashboardTileSchema` | schema | `ZodObject<{ key; label; value; previous; unit; sparkline }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `unknownRouteSchema` | schema | `ZodObject<{ method; route; count; bearer; anonymous }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `telemetryDashboardUnknownRoutesSchema` | schema | `ZodObject<{ requests; bearer; anonymous; previousRequests; previousBearer; topRoutes; truncated; sql }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `telemetryDashboardSummarySchema` | schema | `ZodObject<{ range; generatedAt; truncated; sql; verdict; tiles; runtime; unknownRoutes }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `apiBucketSchema` | schema | `ZodObject<{ t; s2xx; s3xx; s4xx; s5xx; p95Ms }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `logsBucketSchema` | schema | `ZodObject<{ t; error; warn; info; other }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `telemetryDashboardTimeseriesSchema` | schema | `ZodObject<{ range; generatedAt; truncated; sql; panel; buckets }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `topRouteSchema` | schema | `ZodObject<{ method; route; count; errors; errorRatePct; clientErrors; unknownRequests; unknown; p95Ms }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `topErrorSchema` | schema | `ZodObject<{ message; count; firstSeen; lastSeen; sampleTraceId; service }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `telemetryDashboardTopSchema` | schema | `ZodObject<{ range; generatedAt; truncated; sql; kind; items }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `dashboardEventSchema` | schema | `ZodObject<{ timestamp; severity; service; body; traceId; spanId }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `telemetryDashboardEventsSchema` | schema | `ZodObject<{ range; generatedAt; truncated; sql; items; nextCursor }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `telemetryDashboardFiltersSchema` | schema | `ZodObject<{ range; generatedAt; truncated; sql; services; instances; hosts }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `metricPointSchema` | schema | `ZodObject<{ t; v }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `metricSeriesSchema` | schema | `ZodObject<{ key; label; unit; dimension; groupBy; points }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `metricColumnSchema` | schema | `ZodObject<{ key; label; unit }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `metricCellSchema` | schema | `ZodUnion<[string, number, boolean, null]>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `metricTableSchema` | schema | `ZodObject<{ key; label; columns; rows }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `createTelemetryDashboardMetricsSchema()` | schema | `(group: G) => ZodObject<{ range; generatedAt; truncated; sql; group; available; tiles; series; tables; skipped }>` | Build the `/metrics` schema around the group schema a server knows (the API passes its registry's) | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `telemetryDashboardMetricsSchema` | schema | `ZodObject<{ range; generatedAt; truncated; sql; group; available; tiles; series; tables; skipped }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `telemetryDashboardMetricGroupSchema` | schema | `ZodObject<{ id; label; title; order }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `telemetryDashboardMetricGroupsSchema` | schema | `ZodObject<{ data }>` | Validate or `.extend()` a dashboard query or response | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-dashboard.dto.ts) |
| `telemetryAssistantTurnSchema` | schema | `ZodObject<{ role; content }>` | Validate or `.extend()` the assistant request | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-assistant.dto.ts) |
| `telemetryAssistantRequestSchema` | schema | `ZodObject<{ question; history }>` | Validate or `.extend()` the assistant request | stable | [example](../../../../apps/api/src/telemetry/dto/telemetry-assistant.dto.ts) |

Supporting exports: the constants of `constants.ts` (limits, patterns, enum lists such as `DASHBOARD_RANGES`, `METRIC_UNITS`, `VERDICT_LEVELS`, `TELEMETRY_EXPORT_FORMATS`, `PLATFORM_METRIC_GROUPS`), their string-literal types, `TelemetryEnumEntries`, `refineWindow` (the dashboard window rules, for an app's own dashboard query), `telemetryIpVersion` (`net.isIP` without Node), the inferred type of every schema, the assistant's stream event types (`TelemetryAssistantEventMap` and its payloads) and the two compile-time proofs `TelemetrySettingsCarriesNoSecret` and `TelemetryConnectionCarriesNoSecret` with their constants.

`TELEMETRY_EXPORT_FORMATS` lists the formats in wire order (`csv, ndjson, xlsx, parquet`); a menu that wants another order keeps its own display list over it, as the web app does.

## Data

None. The schemas describe HTTP payloads and the shape of two stored values (the `telemetry` settings namespace, the `telemetry_connection` row); the API owns where they are stored.

## Permissions and settings

The `telemetry` system-settings namespace's schema is `telemetrySettingsSchema` (the API registers it under its historic name `systemTelemetrySchema`). The routes it describes are gated by the API (`telemetry:read`, `telemetry:write`, `telemetry:query`, `system_settings:*`); the schemas declare no permission.

## UI

None. The web app's telemetry pages render these shapes; they import only the types and the zod-free constants from here.

## Infra

None. Schemas read no environment variable and ship no deployment configuration.

## Observability

None. Validation is pure; the telemetry services log and trace around it.

## Security notes

No credential field is part of any response shape, nor of the two stored values, and none may be added: `TelemetrySettingsCarriesNoSecret` and `TelemetryConnectionCarriesNoSecret` stop the package compiling if one is. The connection request bodies carry the GreptimeDB passwords write-only; the API stores them in its encrypted credential store, and every response carries a masked status instead. The host validator accepts a hostname or an IP literal only (no scheme, port or path), with the same IP grammar as Node's `net.isIP` (`apps/api/src/telemetry/connection/telemetry-connection.schema.spec.ts` compares the two). Never loosen a schema here to accept a payload the API would not send; an app that needs more extends the schema in its own code.

## Conformance suite

None. The slice ships no conformance suite; `test/telemetry.test.ts` and `test/dual-format.test.ts` cover the schemas and both module formats, the web app round-trips its fixtures through them, and the API's telemetry specs exercise every DTO.

## Upgrade notes

New in this release (#702). The schemas moved here from the API's telemetry DTO files, and the types from the web app's hand-written mirrors; both keep their old names (the API re-exports, the web aliases). Unchanged: every field, limit, enum order, `.describe()` text and validation rule; the generated OpenAPI document is byte-identical.

## Troubleshooting

- **A type error about a missing field after an upgrade.** A contract field was renamed or narrowed, which is a major change: read the changeset's migration note.
- **`zod` appears in the web bundle.** Browser code imports a schema at run time; import types with `import type` and constants only.
- **`/metrics` refuses a group an app registered.** The contract's own `telemetryDashboardMetricsQuerySchema` accepts any id; the API's is built from its registry, so the group must be registered before bootstrap.

## Links

- [Package README](../../README.md): the contract conventions
- [Telemetry spec](../../../../docs/specs/telemetry.md): the telemetry subsystem and its routes
- [Platform packages spec](../../../../docs/specs/platform-packages.md): the slice anatomy, with telemetry as the worked example
