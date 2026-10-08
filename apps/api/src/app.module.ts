import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';

import { PrismaModule } from './prisma/prisma.module';
import { EventBusModule } from './common/event-bus/event-bus.module';
import { CommonModule } from './common/common.module';
import { SettingsModule } from './platform/settings/settings.config';
import { ProfileImageModule } from './platform/storage/storage.config';
import { AboutModule } from './about/about.module';
import { HealthModule } from './health/health.module';
import { StorageModule } from './platform/storage/storage.config';
import { StorageConfigModule } from './platform/storage/storage.config';
import { NodeCredentialModule } from '@marinoscar/platform-api/nodes';
import { NodesModule } from './platform/jobs/jobs.config';
import { credentialsModules } from './platform/credentials/credentials.config';
import { EmailModule } from './platform/email/email.config';
import { BroadcastsModule } from './platform/notifications/notifications.config';
import { NotificationsModule } from './platform/notifications/notifications.config';
import { JobsModule } from './platform/jobs/jobs.config';
import { ExamplesModule } from './examples/examples.module';
import { DbBackupModule } from './platform/db-backup/db-backup.config';
import { LoggerModule } from './common/logger/logger.module';
import { AppMetricsModule } from './common/otel/app-metrics.module';
import { MaintenanceModule } from './common/maintenance/maintenance.module';
import { MaintenanceGuard } from './common/maintenance/maintenance.guard';
import { DeploymentModule } from './common/deployment/deployment.module';
import { DocsEgressContributor } from './openapi/docs-egress.contributor';
import { AiModule } from './platform/ai/ai.config';
import { telemetryModule } from './platform/telemetry/telemetry.config';
import { doctorModule } from './doctor/doctor.config';
import { RetentionModule } from './common/retention/retention.module';
import { platformHostModule } from './platform/platform-host.module';
import { identityModule } from './platform/identity/identity.config';
import { sharingModule } from './platform/sharing/sharing.config';
import { onboardingModule } from './platform/onboarding/onboarding.config';
import { exportsModule } from './platform/exports/exports.config';
import { IdentityExtensionsModule } from './identity-extensions/identity-extensions.module';
import { androidAppModule } from './platform/android-app/android-app.config';

import { HttpExceptionFilter } from '@marinoscar/platform-api/core';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

import configuration from './config/configuration';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),

    // Scheduling (must be at root level for NestJS 11)
    ScheduleModule.forRoot(),

    // Event emitter for async events
    EventEmitterModule.forRoot(),

    // Database
    PrismaModule,

    // Cross-replica event bus (PP-1.11, #682). Global, like the database: the
    // SSE stream and the job worker inject `EVENT_BUS` without an import edge.
    // `EVENT_BUS_ADAPTER` picks the adapter; see common/event-bus/.
    EventBusModule,

    // Logger
    LoggerModule,

    // Application metrics (#600): the one `app` meter every feature records
    // into. Global; a no-op unless OTEL_ENABLED installed the SDK.
    AppMetricsModule,

    // Feature modules
    CommonModule,
    // Identity (#727): sign-in, sessions and tokens (JWT, personal access
    // tokens, the device flow), the guards and decorators every route uses,
    // users, the allowlist and organizations, from
    // `@marinoscar/platform-api/identity`. The app's binding (the host ports and
    // the options) is `platform/identity/identity.config.ts`. It mounts its
    // modules in the order this list used to (auth with the allowlist, PATs and
    // organizations, then users, then the device flow), so the generated OpenAPI
    // document keeps its paths in place.
    identityModule,
    // The app's listeners on identity's events (no routes).
    IdentityExtensionsModule,
    SettingsModule,
    // Uploaded profile pictures (#367): its own module because it needs the
    // storage provider and SettingsModule must not (see the module).
    ProfileImageModule,
    HealthModule,
    StorageModule,
    // #375, epic #372 — the ADMIN surface for object-storage configuration
    // (`/api/admin/storage-config`), deliberately a module of its own rather
    // than routes on `StorageModule` above: that one is every user's object
    // access (`storage:*`), this one is the Admin-only decision about which
    // object store the deployment uses (`storage_config:*`). See the module.
    StorageConfigModule,
    // Worker node credentials (#267, epic #254): the `nod_` token family the
    // node fleet authenticates with, and its `/api/node-credentials` admin
    // endpoints. A @Global provider of a service `JwtAuthGuard` reaches through
    // the identity slice's `IDENTITY_NODE_CREDENTIALS` port (bound in
    // `platform/identity/identity-host.module.ts`), so the module that owns the
    // application is where it belongs.
    //
    // DELIBERATELY NOT the (much heavier) nodes module #268 will add; see the
    // block comment in `nodes/node-credential.module.ts` for why splitting by
    // dependency weight rather than by topic is what keeps the guard's
    // dependency graph acyclic.
    NodeCredentialModule,
    // Encrypted credential stores (#115, #387, #735), from
    // `@marinoscar/platform-api/credentials`: the deployment's, a user's own
    // and an organization's. Registered here so they are part of the module
    // graph; consumers still import the module they need explicitly (none is
    // @Global) so every user of a plaintext-returning service is visible. The
    // app's binding (its purposes) is `platform/credentials/credentials.config.ts`.
    ...credentialsModules,
    // Email transports (#122, epic #109) and, since #124, the admin email
    // settings endpoints. Registered here even though nothing sends mail
    // automatically yet: it makes a broken provider graph fail at boot rather
    // than surfacing as a DI error in #125. It costs nothing at runtime --
    // neither transport touches the network or reads a credential until its
    // first send.
    EmailModule,
    // Notifications (#121/#124/#125, epic #109): the event registry endpoint,
    // and since #125 the dispatcher, preference resolution and delivery
    // records. Registered here even though no real event is wired yet (#128)
    // so a broken channel graph — a duplicate channel registration, a missing
    // transport — fails at boot rather than at the first notification.
    NotificationsModule,
    // Admin notification broadcasts -- the fan-out half (#323, epic #319): the
    // `admin.broadcast.start` and `admin.broadcast.chunk` job handlers, which
    // turn one composed announcement into a chunked, resumable send to every
    // active user over the existing dispatcher. Registered here for the reason
    // `NotificationsModule` and `JobsModule` above are: a handler's only
    // wiring is the `registry.register(this)` in its own `onModuleInit`, so
    // being in the graph IS the registration, and a broken one fails at boot
    // rather than the first time an admin presses Send. The admin API (#324)
    // and page (#325) land on top of this module later.
    BroadcastsModule,
    // Background job queue (#259, epic #254): the handler contract, the
    // handler registry and one worked example handler. Registered here even
    // though nothing enqueues, claims or runs a job yet (#260-#263 add
    // enqueue/claim, the terminal state machine, the worker pool and the
    // hygiene crons) so a broken graph fails at boot rather than at the first
    // job -- and so the example handler's self-registration is exercised on
    // every boot, which is what proves the extension point actually works. It
    // costs nothing at runtime: no loop is started and no query is issued
    // until a worker exists.
    JobsModule,
    // The reference app's worked examples (#734): the job-handler registry
    // seam, one server-only and one node-eligible handler. They lived inside
    // `JobsModule` until the queue moved into `@marinoscar/platform-api/jobs`
    // (`JobsModule` and `NodesModule` above and below are the configured
    // modules of `platform/jobs/jobs.config.ts`).
    ExamplesModule,
    // The worker-node control plane (#268, epic #254): register/reattach,
    // heartbeat, claim, lease renewal, result and failure submission at
    // `/api/nodes`. Registered AFTER `JobsModule` for readability only — Nest
    // resolves the graph, not the order — but the dependency is real and
    // one-way: this module claims through `JobClaimService` and settles
    // through `JobTerminalService` rather than owning either, which is what
    // keeps the two executors (this API's own worker pool, and a remote node)
    // from ever disagreeing about a row.
    //
    // Deliberately separate from the `@Global` `NodeCredentialModule` above,
    // which carries only the guard's dependency; see the block comments in
    // both node modules for why splitting by dependency weight is what keeps
    // `JwtAuthGuard` out of a cycle with `JobsModule`.
    NodesModule,

    // The database backup engine (#281, epic #254): the `database_backup_runs`
    // table's only writer, and the streaming `pg_dump` behind it. Registered
    // here so a broken provider graph fails at boot rather than at 02:00 on
    // the first night backups are switched on.
    //
    // ⚠ IT IS A JOB TYPE SINCE #351 (epic #345), having deliberately not been
    // one before. `db.backup.run` is registered by `DbBackupModule`, and the
    // dump's lifetime is the job's lifetime. The three objections the schema
    // used to raise — the 30-minute reaper resetting a long dump, an
    // in-process worker that never renewed its lease, and an attempt budget
    // that would re-run a failed multi-gigabyte dump — are answered by the
    // handler's `{ maxRuntimeMs: 6h, maxAttempts: 1 }` profile (#346) and by
    // #347's lease renewal. See the "### Why this WAS not a queue job" block
    // above `DatabaseBackupRun` in prisma/schema.prisma, which keeps the
    // history rather than pretending the objections were never valid.
    //
    // ⚠ CONSEQUENCE FOR AN ENQUEUE-ONLY DEPLOYMENT: with
    // `JOBS_WORKER_MODE=off` this process queues backups and never takes them.
    // `system` mode DOES take them (the type is server-only by derivation, so
    // that mode claims it); only `off` does not, which is what `off` means.
    // The stale sweep's `pending` arm is what stops those unclaimed rows
    // holding the single active backup slot forever.
    DbBackupModule,

    // Maintenance mode (#257, epic #254): the three-layer switch, its admin
    // endpoints, and the global guard registered below. Imported here — rather
    // than left to whichever module happened to need it — because the guard it
    // provides runs in front of every route in this application, and that
    // belongs in the module that owns the application.
    MaintenanceModule,

    // Deployment mode (#685): the parsed `DEPLOYMENT_MODE` and its capability
    // predicates (`DeploymentModeService`), plus the `core.deployment-mode`
    // doctor check. `@Global()`, so the restore path and the about report
    // inject the service without importing this module.
    DeploymentModule,

    // `GET /api/admin/about` (#401, epic #397): what is deployed here — the
    // API's resolved version, the deploy document `appctl deploy` bind-mounts
    // into the container, and a database liveness fact. Imports `HealthModule`
    // for that last one and reads no settings, so it adds no edge to the
    // settings or storage graphs. Registered after them all the same: it
    // reports on the application, so it is the application that owns it.
    AboutModule,

    // `GET /api/admin/doctor` (#634): read-only configuration and health
    // checks for every capability. Global so each feature module
    // contributes its checks by providing them (they inject the registry and
    // self-register) without importing this module. The module itself is the
    // package's (`@marinoscar/platform-api/doctor`, #696); the app's binding is
    // `doctor/doctor.config.ts`.
    doctorModule,

    // The AI platform (epic #419): core, the five providers, catalogue,
    // policy, keys, runtime, the /api/ai and /api/admin/ai routes and usage.
    // Packaged as `@marinoscar/platform-api/ai` (#739); the app's binding is
    // `platform/ai/ai.config.ts` (`AiModule.forRoot({ imports: [AiHostModule] })`).
    AiModule,

    // Telemetry (#534, epic #528): the `telemetry` settings and the runtime
    // export gate they drive, the GreptimeDB client and store status, and the
    // server-only `telemetry.retention.apply` job. The explorer (#535) and the
    // assistant (#536) add their services inside this module. Packaged as
    // `@marinoscar/platform-api/telemetry` (#703); the app's binding is
    // `platform/telemetry/telemetry.config.ts` (`TelemetryModule.forRoot({
    // host, imports: [TelemetryHostModule], metricGroups })`).
    telemetryModule,

    // Data retention (#681): the daily, enqueue-only cron for the `retention`
    // settings namespace and the `audit.events.purge` handler. The inbox,
    // delivery-log and AI-run purges live with their tables, in
    // `NotificationsModule` and `AiRuntimeModule`.
    RetentionModule,

    // Sharing (#728, epic #666): groups inside an organization, their members
    // and invites (`/api/groups`), the ownership contract for group-owned rows
    // and the principal's `Scope.groupIds`. Packaged as
    // `@marinoscar/platform-api/sharing`; the app's binding is
    // `platform/sharing/sharing.config.ts` (`SharingModule.forRoot({ host,
    // imports: [SharingHostModule] })`).
    sharingModule,

    // Onboarding (#745, epic #668): the derived Get started and Setup guide
    // checklists (`GET /api/onboarding`) and the aggregate activation metrics
    // (`GET /api/admin/onboarding/metrics`), from
    // `@marinoscar/platform-api/onboarding`. The app's binding (the manifest
    // and the host ports) is `platform/onboarding/onboarding.config.ts`.
    onboardingModule,

    // Data exports (#744): /api/exports, export.run and export.purge.
    exportsModule,

    // The Android companion (#746): trusted apps, assetlinks, APK releases.
    androidAppModule,

    // The platform host ports (#696): binds AUDIT_SINK, SYSTEM_SETTINGS_STORE
    // and PLATFORM_PRISMA to the app's adapters, once, globally, so every
    // packaged slice (`@marinoscar/platform-api/<slice>`) reaches app-owned
    // capabilities by token. `src/platform/` is the single place the app is
    // bound to the platform; see platform-host.module.ts.
    // LAST on purpose: it imports `SettingsModule`, and listing it earlier
    // would move that module's routes up the generated OpenAPI document.
    platformHostModule,

    // The test-only login (non-production only) is mounted by `identityModule`
    // (`enableTestAuth`).
  ],
  providers: [
    // ------------------------------------------------------------------------
    // The application's ONLY global guard (#257, epic #254)
    // ------------------------------------------------------------------------
    //
    // It runs on every Nest route, before any route-level `UseGuards`, and
    // answers exactly one question: is this deployment deliberately out of
    // service? Routes carrying `@AllowDuringMaintenance()` are exempt — health,
    // sign-in, token refresh, device activation, the test-auth routes, and the
    // maintenance endpoints themselves. Everything else is a 503 while a window
    // is open.
    //
    // `useExisting`, not `useClass`: the instance is constructed in
    // `MaintenanceModule`, which is where its `JwtService` lives (that module
    // registers its own rather than importing `AuthModule` — see the module for
    // why). `useClass` here would try to construct the guard in THIS context
    // and would need the whole auth graph exported into it.
    //
    // NOT COVERED, and documented rather than discovered: `/api/docs` and
    // `/api/openapi.json` are mounted directly on the Fastify instance by
    // `openapi/register-docs-routes.ts`, outside Nest's router, so they never
    // reach this guard and stay readable during a window. See
    // docs/specs/maintenance-mode.md.
    {
      provide: APP_GUARD,
      useExisting: MaintenanceGuard,
    },
    // Global validation pipe (Zod)
    {
      provide: APP_PIPE,
      useClass: ZodValidationPipe,
    },
    // Global exception filter
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    // Global logging interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    // Global response transform interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
    // Egress inventory (#773): `/api/docs`' CDN. Here because the docs routes
    // are mounted on Fastify directly (`openapi/register-docs-routes.ts`) and
    // have no module of their own; the catalog example of registering an
    // outbound dependency from app code.
    DocsEgressContributor,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestIdMiddleware)
      .forRoutes('*');
  }
}
