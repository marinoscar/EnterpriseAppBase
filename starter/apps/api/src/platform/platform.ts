// The app's composition of the platform: every packaged slice it mounts,
// configured once with `forRoot()`, and the host modules binding their ports.
// app.module.ts imports `PLATFORM_MODULES` and nothing else of the platform.
//
// The app's settings namespaces register FIRST: `SettingsModule.forRoot()`
// composes the system settings request bodies from the registry.
import '../notes/notes.settings';

import { APP_NAME } from '@app/shared';
import { Global, Module } from '@nestjs/common';
import { PLATFORM_PRISMA, PlatformHostModule } from '@marinoscar/platform-api/core';
import { DoctorModule } from '@marinoscar/platform-api/doctor';
import {
  IDENTITY_JOBS,
  IDENTITY_METRICS,
  IDENTITY_NODE_CREDENTIALS,
  IDENTITY_NOTIFIER,
  IDENTITY_PROFILE_IMAGES,
  IdentityModule,
  NOOP_IDENTITY_METRICS,
  USER_DEFAULTS,
} from '@marinoscar/platform-api/identity';
import { JobsModule } from '@marinoscar/platform-api/jobs';
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

const PORTS = [
  { provide: PLATFORM_PRISMA, useExisting: PrismaService },
  { provide: SETTINGS_DATA, useClass: SettingsDataAdapter },
  { provide: SETTINGS_PROFILE_IMAGES, useClass: AppProfileImages },
  { provide: IDENTITY_PROFILE_IMAGES, useClass: AppProfileImages },
  { provide: IDENTITY_NOTIFIER, useClass: LoggingIdentityNotifier },
  { provide: USER_DEFAULTS, useClass: AppUserDefaults },
  { provide: IDENTITY_JOBS, useClass: IdentityJobsAdapter },
  { provide: IDENTITY_METRICS, useValue: NOOP_IDENTITY_METRICS },
  { provide: IDENTITY_NODE_CREDENTIALS, useExisting: NodeCredentialService },
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
  // AUDIT_SINK, SYSTEM_SETTINGS_STORE and PLATFORM_PRISMA for every slice.
  PlatformHostModule.forRoot({
    audit: { useClass: PrismaAuditSink },
    settings: { useClass: SystemSettingsStoreAdapter },
    prisma: { useExisting: PrismaService },
  }),
];

