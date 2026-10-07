import { DynamicModule, Module } from '@nestjs/common';

import { TelemetryAiEnabledGuard } from './assistant/telemetry-ai-enabled.guard';
import { createTelemetryAssistantController } from './assistant/telemetry-assistant.controller';
import { TelemetryAssistantService } from './assistant/telemetry-assistant.service';
import { TelemetryConnectionAdminService } from './connection/telemetry-connection-admin.service';
import { TelemetryConnectionTestService } from './connection/telemetry-connection-test.service';
import { createTelemetryConnectionController } from './connection/telemetry-connection.controller';
import { TelemetryConnectionService } from './connection/telemetry-connection.service';
import { createTelemetryDashboardController } from './dashboard/telemetry-dashboard.controller';
import { TelemetryDashboardService } from './dashboard/telemetry-dashboard.service';
import { TelemetryExportService } from './export/telemetry-export.service';
import { GreptimeClient } from './greptime/greptime.client';
import { TelemetryRetentionHandler } from './handlers/telemetry-retention.handler';
import { TelemetryQueryService } from './query/telemetry-query.service';
import { TelemetrySchemaService } from './query/telemetry-schema.service';
import { StackAgentClient } from './stack/stack-agent.client';
import { TelemetryStackDeployHandler } from './stack/telemetry-stack-deploy.handler';
import { createTelemetryStackController } from './stack/telemetry-stack.controller';
import { TelemetryStackService } from './stack/telemetry-stack.service';
import { TelemetryRetentionTask } from './tasks/telemetry-retention.task';
import { createTelemetryAdminController } from './telemetry-admin.controller';
import { createTelemetryConfigController } from './telemetry-config.controller';
import { createTelemetryExplorerController } from './telemetry-explorer.controller';
import { TelemetrySettingsService } from './telemetry-settings.service';
import { TelemetryStatusService } from './telemetry-status.service';
import { TelemetrySupportBundleSection } from './telemetry-support-bundle.section';
import { TelemetryConnectionDoctorCheck } from './doctor/telemetry-connection.doctor-check';
import { GreptimeDbEgressContributor } from './doctor/egress/greptimedb.egress.contributor';
import { TelemetryExportDoctorCheck } from './doctor/telemetry-export.doctor-check';
import { TelemetryFreshnessDoctorCheck } from './doctor/telemetry-freshness.doctor-check';
import { TelemetryReachableDoctorCheck } from './doctor/telemetry-reachable.doctor-check';
import { TelemetryTablesDoctorCheck } from './doctor/telemetry-tables.doctor-check';
import { registerMetricGroups, metricGroupRegistry } from './metrics/metric-group.registry';
import {
  TELEMETRY_OPTIONS,
  resolveTelemetryModuleOptions,
  type TelemetryModuleOptions,
} from './telemetry.options';

// =============================================================================
// TelemetryModule (issue #534, epic #528; packaged as
// `@marinoscar/platform-api/telemetry` by #703)
// =============================================================================
//
// The API side of observability: the `telemetry` settings (and the runtime
// export gate they drive), the GreptimeDB client, the store's status, and the
// server-only `telemetry.retention.apply` job with its enqueue-only cron.
//
// PACKAGED (#703). Nothing here imports the app: every app capability comes
// through a host port (./ports.ts) the app binds in `forRoot({ imports })`,
// and every route through the controller-factory recipe with the app's
// access decorators (`forRoot({ host })`).
//
// The explorer (#535): `TelemetryQueryService` (the one entry point for
// caller-supplied SQL: guard, row cap, timeout, audit), `TelemetrySchemaService`
// (tables and columns) and `TelemetryExportService` (csv/ndjson/xlsx/parquet),
// behind `TelemetryExplorerController` on `telemetry:query`.
//
// The assistant (#536, #571): `TelemetryAssistantService` runs a
// troubleshooting agent's tool loop through the `TELEMETRY_AI` port (the
// app's `AiService.forUser`);
// every statement its tools run — the model's and the ones it builds itself
// (`assistant/telemetry-assistant.sql.ts`) — goes through
// `TelemetryQueryService.run` with `source: 'assistant'`, so it is held to
// exactly the explorer's guard and bounds; `TelemetrySchemaService` lists and
// describes tables, and the `TELEMETRY_SETTINGS_STORE` port gives the
// allowlisted feature flags `get_app_context` reports. Streamed by
// `TelemetryAssistantController`.
//
// The connection (#558): `TelemetryConnectionService` resolves the GreptimeDB
// connection at runtime — the one saved at /admin/settings/telemetry (a
// `telemetry_connection` system-settings row plus two passwords in the
// credential store, the `TELEMETRY_CREDENTIAL_STORE` port), else the `GREPTIME_*`
// deployment default. `GreptimeClient` builds its pools from it and rebuilds
// them when it changes. `TelemetryConnectionController` is the admin surface.
//
// The services (#567): on a VPS, `StackAgentClient` talks to the
// `stack-agent` sidecar (STACK_AGENT_URL/TOKEN) to report the telemetry
// containers' state and to start them through the server-only
// `telemetry.stack.deploy` job. `TelemetryStackController` is the admin
// surface, under /api/admin/telemetry/stack.
//
// The dashboard (#577): `TelemetryDashboardService` runs the fixed,
// server-authored statements of `dashboard/telemetry-dashboard.sql.ts` (no
// caller SQL) on the reader pool, with a 15 s result cache, behind
// `TelemetryDashboardController` on `telemetry:query`.
//
// `GreptimeClient`, `TelemetrySettingsService` and the two query services are
// exported for it.
// =============================================================================

const PROVIDERS = [
  TelemetryConnectionService,
  TelemetryConnectionAdminService,
  TelemetryConnectionTestService,
  GreptimeClient,
  TelemetrySettingsService,
  TelemetryStatusService,
  TelemetryRetentionHandler,
  TelemetryRetentionTask,
  TelemetryQueryService,
  TelemetrySchemaService,
  TelemetryExportService,
  TelemetryAssistantService,
  TelemetryAiEnabledGuard,
  StackAgentClient,
  TelemetryStackService,
  TelemetryStackDeployHandler,
  TelemetryDashboardService,
  // Doctor checks (#634): read-only — never the connection test (it
  // audits) and never the dashboard service's audited reads. Each registers
  // itself with the Doctor's DoctorCheckRegistry (`@marinoscar/platform-api/doctor`).
  TelemetryExportDoctorCheck,
  TelemetryConnectionDoctorCheck,
  TelemetryReachableDoctorCheck,
  TelemetryTablesDoctorCheck,
  TelemetryFreshnessDoctorCheck,
  // Egress inventory (#773): the GreptimeDB host.
  GreptimeDbEgressContributor,
  // Support-bundle section (#772): telemetry health as aggregates only,
  // gated on telemetry:query. Registers itself with SupportBundleRegistry.
  TelemetrySupportBundleSection,
];

/**
 * The telemetry slice: settings and the export gate, the GreptimeDB
 * connection and client, the explorer, the assistant, the dashboard, the
 * stack-agent surface, the two server-only job types, five Doctor checks, an
 * egress contributor and a support-bundle section.
 *
 * @stability experimental
 */
@Module({})
export class TelemetryModule {
  /**
   * The slice for one app: its routes guarded by `options.host`, its host
   * ports bound by `options.imports`.
   *
   * @param options - the module options.
   * @returns the dynamic module. It exports `GreptimeClient`,
   *   `TelemetrySettingsService`, `TelemetryQueryService` and `TelemetrySchemaService`.
   * @throws Error when an option is invalid, or an extra metric group is refused.
   *
   * @example
   * ```ts
   * TelemetryModule.forRoot({ host: platformHost, imports: [TelemetryHostModule] });
   * ```
   *
   * @extensionPoint option
   * @stability experimental
   */
  static forRoot(options: TelemetryModuleOptions): DynamicModule {
    const resolved = resolveTelemetryModuleOptions(options);

    // Extra groups go in BEFORE the controllers are created, so the dashboard
    // route's documented `group` enum includes them. Re-registering the very
    // same definition (a second forRoot in one process) is a no-op.
    registerMetricGroups(resolved.metricGroups.filter((group) => metricGroupRegistry.get(group.id) !== group));

    return {
      module: TelemetryModule,
      imports: [...resolved.imports],
      controllers: [
        createTelemetryAdminController(resolved),
        createTelemetryConfigController(resolved),
        createTelemetryExplorerController(resolved),
        createTelemetryAssistantController(resolved),
        createTelemetryConnectionController(resolved),
        createTelemetryStackController(resolved),
        createTelemetryDashboardController(resolved),
      ],
      providers: [{ provide: TELEMETRY_OPTIONS, useValue: resolved }, ...PROVIDERS],
      exports: [GreptimeClient, TelemetrySettingsService, TelemetryQueryService, TelemetrySchemaService],
    };
  }
}
