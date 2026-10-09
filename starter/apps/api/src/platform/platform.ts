// The app's composition of the platform: every packaged slice it mounts,
// configured once with `forRoot()`, and the host modules binding their ports.
// app.module.ts imports `PLATFORM_MODULES` and nothing else of the platform.
//
// The app's settings namespaces register FIRST: `SettingsModule.forRoot()`
// composes the system settings request bodies from the registry. (The host
// core's `maintenance` namespace is registered by `PlatformHostCoreModule.forRoot()`,
// first in PLATFORM_MODULES, so before `SettingsModule.forRoot()` too.)
import '../notes/notes.settings';
import './storage.settings';

import { APP_NAME } from '@app/shared';
import { Global, Module } from '@nestjs/common';
import { PLATFORM_PRISMA, PlatformHostModule } from '@marinoscar/platform-api/core';
import { DoctorModule } from '@marinoscar/platform-api/doctor';
import { AppMetricsService, EVENT_BUS, PlatformHostCoreModule } from '@marinoscar/platform-api/host';
import {
  IDENTITY_EVENT_BUS,
  IDENTITY_JOBS,
  IDENTITY_METRICS,
  IDENTITY_NODE_CREDENTIALS,
  IDENTITY_NOTIFIER,
  IDENTITY_PROFILE_IMAGES,
  IdentityModule,
  USER_DEFAULTS,
} from '@marinoscar/platform-api/identity';
import { JOBS_EVENT_BUS, JOBS_METRICS, JobsModule } from '@marinoscar/platform-api/jobs';
import { NodeCredentialModule, NodeCredentialService } from '@marinoscar/platform-api/nodes';
import { SETTINGS_DATA, SETTINGS_PROFILE_IMAGES, SettingsModule } from '@marinoscar/platform-api/settings';

import { PrismaService } from '../prisma/prisma.service';
import {
  AppProfileImages,
  AppUserDefaults,
  IdentityJobsAdapter,
  LoggingIdentityNotifier,
  PrismaAuditSink,
  SettingsDataAdapter,
  SystemSettingsStoreAdapter,
} from './adapters';
import { platformHost } from './host';
import { userDataModule } from './user-data/user-data.config';

const PORTS = [
  { provide: PLATFORM_PRISMA, useExisting: PrismaService },
  { provide: SETTINGS_DATA, useClass: SettingsDataAdapter },
  { provide: SETTINGS_PROFILE_IMAGES, useClass: AppProfileImages },
  { provide: IDENTITY_PROFILE_IMAGES, useClass: AppProfileImages },
  { provide: IDENTITY_NOTIFIER, useClass: LoggingIdentityNotifier },
  { provide: USER_DEFAULTS, useClass: AppUserDefaults },
  { provide: IDENTITY_JOBS, useClass: IdentityJobsAdapter },
  { provide: IDENTITY_NODE_CREDENTIALS, useExisting: NodeCredentialService },
  // The host core's bus and metrics (PlatformHostCoreModule, global): the
  // principal cache's cross-replica invalidation, the queue's wake-up, and the
  // `app.auth.*` / `app.jobs.*` instruments.
  { provide: IDENTITY_EVENT_BUS, useExisting: EVENT_BUS },
  { provide: IDENTITY_METRICS, useExisting: AppMetricsService },
  { provide: JOBS_EVENT_BUS, useExisting: EVENT_BUS },
  { provide: JOBS_METRICS, useExisting: AppMetricsService },
];

/** The slices' host ports, bound once and globally (a guard is built in every module that uses `@Auth()`). */
@Global()
@Module({ providers: PORTS, exports: PORTS.map((port) => port.provide) })
export class AppHostModule {}

/**
 * The background queue: `jobs` and its admin routes, the worker and the
 * hygiene crons. Configured HERE, above `PLATFORM_MODULES`, on purpose:
 * `JobsModule.forRoot()` registers the `jobs` settings namespace (the
 * job-history purge's policy), and `SettingsModule.forRoot()` below composes
 * the `/api/system-settings` request bodies from the registry once. Moved
 * after it, `forRoot()` throws. A `NodesModule.forRoot()` (`nodes`) goes up
 * here too.
 */
export const jobsModule = JobsModule.forRoot({ appName: APP_NAME, imports: [AppHostModule] });

export const PLATFORM_MODULES = [
  // The API host core: the event bus (EVENT_BUS_ADAPTER), the platform's app
  // metrics, maintenance mode (`/api/admin/maintenance` and the only
  // APP_GUARD), the `{ data }` envelope, the request log line, the exception
  // filter and request ids. `/api/docs` is mounted at bootstrap (main.ts).
  PlatformHostCoreModule.forRoot(),
  // Sign-in, sessions, tokens, users, the allowlist and organizations, plus
  // the guards and decorators every route uses (`@Auth()`, `@Public()`).
  IdentityModule.forRoot({ imports: [AppHostModule], enableTestAuth: process.env.NODE_ENV !== 'production' }),
  // `/api/system-settings`, `/api/user-settings`, `/api/org-settings`.
  SettingsModule.forRoot({ imports: [AppHostModule] }),
  // The `nod_` worker-node credential family the identity guard accepts.
  NodeCredentialModule,
  jobsModule,
  // `GET /api/admin/doctor`: every registered check, read-only.
  DoctorModule.forRoot({ host: platformHost }),
  // The Danger Zone (`/api/user-data/*`), the admin factory reset and organization
  // offboarding. The manifest in ./user-data/user-data.manifest.ts is the data.
  userDataModule,
  // AUDIT_SINK, SYSTEM_SETTINGS_STORE and PLATFORM_PRISMA for every slice.
  PlatformHostModule.forRoot({
    audit: { useClass: PrismaAuditSink },
    settings: { useClass: SystemSettingsStoreAdapter },
    prisma: { useExisting: PrismaService },
  }),
];

