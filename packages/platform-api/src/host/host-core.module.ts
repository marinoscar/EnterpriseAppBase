// =============================================================================
// PlatformHostCoreModule: the API host core every slice assumes (issue #867)
// =============================================================================
//
// One global module the app imports once, with everything a working platform
// API needs around its slices (all of it was the reference app's own code):
//
//   - `EVENT_BUS` (and `EVENT_BUS_SELECTION`): the cross-replica event bus,
//     `in-process` or `postgres` by `EVENT_BUS_ADAPTER`, with its
//     `core.event-bus` Doctor check;
//   - `AppMetricsService`: the platform's typed metric recorders and the
//     generic `add`/`record`, on otel-core's metrics host, plus the platform's
//     `app.*` metric declarations (`registerPlatformHostAppMetrics`);
//   - maintenance mode: `MaintenanceModeService`, `/api/admin/maintenance`, the
//     `maintenance.mode` Doctor check and `MaintenanceGuard` as the
//     application's ONLY `APP_GUARD` (there is no global JWT guard);
//   - the `{ data }` response envelope (`TransformInterceptor`), the request
//     log line (`LoggingInterceptor`) and core's `HttpExceptionFilter`, as
//     global enhancers;
//   - request ids (`RequestIdMiddleware`, every route);
//   - the health probes (`GET /api/health`, `/live`, `/ready`: public, reachable
//     during maintenance, the readiness probe a `SELECT 1` through
//     `PLATFORM_PRISMA`; #901);
//   - the deployment facts (`DeploymentModeService` for `DEPLOYMENT_MODE`,
//     `DeploymentNetworkService` for `DEPLOYMENT_NETWORK`, bound as the doctor
//     slice's `DEPLOYMENT_NETWORK_SOURCE`) and the generic Doctor checks:
//     `db.connection`, `db.migrations`, `db.rls_role`, `secrets.encryption-key`,
//     `core.deployment-mode` and `network.egress` (#879).
//
// The OpenAPI document and `/api/docs` are bootstrap-time, because they need
// the built application: `registerPlatformDocs(app, openApi)` in `main.ts`.
//
// REQUIRES core's `PlatformHostModule.forRoot()` (`AUDIT_SINK`, and
// `PLATFORM_PRISMA` for the `postgres` bus and the gauges), the global
// settings module (the `maintenance` namespace, `MAINTENANCE_SYSTEM_SETTINGS`:
// `forRoot()` registers it unless the app's manifest did, so call it before
// `SettingsModule.forRoot()` or register it there), a global `ConfigModule`
// carrying `jwt.secret` (the identity slice's configuration; `deployment.mode`
// and `deployment.network` too when published, else `DEPLOYMENT_MODE` and
// `DEPLOYMENT_NETWORK` are read from the environment) and, for the Doctor
// checks, the doctor module. The database checks read through `PLATFORM_PRISMA`
// and report `skip` when it is unbound.
//
// WHERE TO IMPORT IT. Only the health and maintenance controllers have
// routes, and the generated OpenAPI document lists paths in module order, so
// the app places this module where `/api/health` and `/api/admin/maintenance`
// belong in its document (the reference app: right after `ProfileImageModule`).
// =============================================================================

import {
  Global,
  Module,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TerminusModule } from '@nestjs/terminus';

import { HttpExceptionFilter, PLATFORM_PRISMA } from '../core/index';
import { requireJwtSecret } from '../identity/index';
import { OtelMetricsModule } from '../otel-core/index';
import { ensureSystemSettingsNamespaces, type SystemSettingsNamespace } from '../settings/index';
import { DEPLOYMENT_NETWORK_SOURCE, NetworkEgressDoctorCheck } from '../doctor/index';
import { DeploymentModeService } from './deployment/deployment-mode.service';
import { DeploymentNetworkService } from './deployment/deployment-network.service';
import { DbConnectionDoctorCheck } from './doctor/db-connection.doctor-check';
import { DbMigrationsDoctorCheck } from './doctor/db-migrations.doctor-check';
import { DeploymentModeDoctorCheck } from './doctor/deployment-mode.doctor-check';
import { EncryptionKeyDoctorCheck } from './doctor/encryption-key.doctor-check';
import { RlsRoleDoctorCheck } from './doctor/rls-role.doctor-check';
import { EventBusDoctorCheck } from './event-bus/doctor/event-bus.doctor-check';
import { EVENT_BUS_SELECTION, type EventBusSelection } from './event-bus/event-bus.config';
import { createEventBus, selectEventBus } from './event-bus/event-bus.factory';
import { EVENT_BUS } from './event-bus/event-bus.interface';
import type { EventBusSqlPublisher } from './event-bus/postgres-event-bus';
import {
  PLATFORM_HOST_CORE_OPTIONS,
  resolvePlatformHostCoreOptions,
  type PlatformHostCoreOptions,
  type ResolvedPlatformHostCoreOptions,
} from './host-core.options';
import { DatabaseHealthIndicator } from './health/database.indicator';
import { HealthController } from './health/health.controller';
import { LoggingInterceptor } from './http/logging.interceptor';
import { RequestIdMiddleware } from './http/request-id.middleware';
import { TransformInterceptor } from './http/transform.interceptor';
import { MaintenanceModeDoctorCheck } from './maintenance/doctor/maintenance-mode.doctor-check';
import { MaintenanceModeService } from './maintenance/maintenance-mode.service';
import { MaintenanceController } from './maintenance/maintenance.controller';
import { MaintenanceGuard } from './maintenance/maintenance.guard';
import { MAINTENANCE_SYSTEM_SETTINGS } from './maintenance/maintenance.system-settings';
import { AppMetricsService } from './metrics/app-metrics.service';
import { registerPlatformHostAppMetrics } from './metrics/register';

/**
 * The API host core: the event bus, the platform's app metrics, maintenance
 * mode (the only `APP_GUARD`), the `{ data }` envelope, the request log line,
 * the exception filter and request ids. Global.
 *
 * @stability experimental
 */
@Global()
@Module({})
export class PlatformHostCoreModule implements NestModule {
  /**
   * The host core for one app. Registers the platform's app metrics and the
   * `maintenance` settings namespace unless they already are (call it before
   * `SettingsModule.forRoot()`, or register the namespace in the app's
   * manifest), then returns the global module. Import it exactly once.
   *
   * @param options - see {@link PlatformHostCoreOptions}; all optional.
   * @returns the global dynamic module. It exports `EVENT_BUS`,
   *   `EVENT_BUS_SELECTION`, `AppMetricsService`, `MaintenanceModeService`,
   *   `MaintenanceGuard` and `PLATFORM_HOST_CORE_OPTIONS`.
   * @throws Error when an option is invalid, or when `SettingsModule.forRoot()`
   *   already composed the settings bodies without the `maintenance` namespace.
   *
   * @example
   * ```ts
   * // apps/api/src/platform/host-core.config.ts
   * export const hostCoreModule = PlatformHostCoreModule.forRoot();
   * ```
   *
   * @extensionPoint option
   * @stability experimental
   */
  static forRoot(options: PlatformHostCoreOptions = {}): DynamicModule {
    const resolved = resolvePlatformHostCoreOptions(options);
    registerPlatformHostAppMetrics();
    ensureSystemSettingsNamespaces([MAINTENANCE_SYSTEM_SETTINGS as SystemSettingsNamespace], 'PlatformHostCoreModule.forRoot()');

    return {
      global: true,
      module: PlatformHostCoreModule,
      imports: [
        // The metrics host (otel-core): instruments, label bounding, gauges.
        OtelMetricsModule.forRootAsync({
          useFactory: () => ({ gauges: resolved.metricsGauges ?? process.env.OTEL_ENABLED === 'true' }),
        }),
        // The maintenance guard verifies an admin bearer itself (it runs before
        // any route guard), against the SAME `jwt.secret` the identity slice
        // signs with. Its own JwtModule, never re-exported: the guard must not
        // pull the whole auth graph in front of every request.
        JwtModule.registerAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({ secret: requireJwtSecret(config) }),
        }),
        // The health probes' Terminus services.
        TerminusModule,
        ...resolved.imports,
      ],
      // Health first: `/api/health` has always preceded
      // `/api/admin/maintenance` in the generated OpenAPI document.
      controllers: [HealthController, MaintenanceController],
      providers: [
        { provide: PLATFORM_HOST_CORE_OPTIONS, useValue: resolved },
        {
          provide: EVENT_BUS_SELECTION,
          inject: [PLATFORM_HOST_CORE_OPTIONS],
          useFactory: (opts: ResolvedPlatformHostCoreOptions): EventBusSelection =>
            selectEventBus(opts.eventBusAdapter ?? process.env.EVENT_BUS_ADAPTER),
        },
        {
          provide: EVENT_BUS,
          inject: [EVENT_BUS_SELECTION, { token: PLATFORM_PRISMA, optional: true }, AppMetricsService],
          useFactory: (selection: EventBusSelection, sql: EventBusSqlPublisher | undefined, metrics: AppMetricsService) =>
            createEventBus(selection, sql ?? undefined, metrics),
        },
        // The deployment facts (`DEPLOYMENT_MODE`, `DEPLOYMENT_NETWORK`) and the
        // generic Doctor checks, in the order the report lists them within the
        // `core` category: the event bus, the deployment mode, then the
        // database and secrets checks (registration order is report order).
        DeploymentModeService,
        DeploymentNetworkService,
        { provide: DEPLOYMENT_NETWORK_SOURCE, useExisting: DeploymentNetworkService },
        EventBusDoctorCheck,
        DeploymentModeDoctorCheck,
        DbConnectionDoctorCheck,
        DbMigrationsDoctorCheck,
        EncryptionKeyDoctorCheck,
        RlsRoleDoctorCheck,
        NetworkEgressDoctorCheck,
        AppMetricsService,
        DatabaseHealthIndicator,
        MaintenanceModeService,
        MaintenanceGuard,
        MaintenanceModeDoctorCheck,
        // The application's ONLY global guard. `useExisting`, so the instance
        // is the one constructed here, next to its JwtService.
        { provide: APP_GUARD, useExisting: MaintenanceGuard },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
        // Order matters: the log line wraps the envelope.
        { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
        { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
      ],
      exports: [
        PLATFORM_HOST_CORE_OPTIONS,
        EVENT_BUS,
        EVENT_BUS_SELECTION,
        AppMetricsService,
        MaintenanceModeService,
        MaintenanceGuard,
        DeploymentModeService,
        DeploymentNetworkService,
        DEPLOYMENT_NETWORK_SOURCE,
      ],
    };
  }

  /**
   * Applies {@link RequestIdMiddleware} to every route.
   *
   * @param consumer - Nest's middleware consumer.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
