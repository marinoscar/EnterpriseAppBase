import { Global, Module } from '@nestjs/common';
import {
  IDENTITY_EVENT_BUS,
  IDENTITY_JOBS,
  IDENTITY_METRICS,
  IDENTITY_NODE_CREDENTIALS,
  IDENTITY_NOTIFIER,
  IDENTITY_PROFILE_IMAGES,
  USER_DEFAULTS,
  type IdentityMetrics,
  type IdentityNodeCredentials,
} from '@marinoscar/platform-api/identity';

import { EVENT_BUS } from '../../common/event-bus/event-bus.interface';
import { AppMetricsService } from '../../common/otel/app-metrics.service';
import { JobsModule } from '../jobs/jobs.config';
import { NodeCredentialService } from '@marinoscar/platform-api/nodes';
import { NotificationsModule } from '../../notifications/notifications.module';
import { IdentityJobsAdapter } from './identity-jobs.adapter';
import { NotificationsIdentityNotifier } from './identity-notifier.adapter';
import { AppProfileImages, AppUserDefaults } from './identity-user.adapters';

// =============================================================================
// The identity slice's host ports, bound to the reference app (issue #727)
// =============================================================================
//
// Passed to `IdentityModule.forRoot({ imports: [IdentityHostModule] })`
// (./identity.config.ts). GLOBAL, because `JwtAuthGuard` is instantiated in
// every module whose controllers use `@Auth()` and needs
// `IDENTITY_NODE_CREDENTIALS` there.
//
// The database is not here: it is core's `PLATFORM_PRISMA`, bound once by
// `platformHostModule`. The event bus, the metrics and the node-credential
// service come from global app modules, reused as they are (`useExisting`).
//
// IMPORTS ONLY WHAT THE ADAPTERS NEED, and in the order the old AuthModule
// reached them (notifications, then jobs): identity mounts this module where
// the app's old auth graph imported those two, so the generated OpenAPI
// document keeps its path order.
// =============================================================================

/** Compile-time proof that the app's services ARE the ports, unadapted. */
export type AppMetricsServiceIsIdentityMetrics = AppMetricsService extends IdentityMetrics ? true : never;
export type NodeCredentialServiceIsIdentityNodeCredentials = NodeCredentialService extends IdentityNodeCredentials
  ? true
  : never;
const _metricsFit: AppMetricsServiceIsIdentityMetrics = true;
const _nodesFit: NodeCredentialServiceIsIdentityNodeCredentials = true;
void _metricsFit;
void _nodesFit;

const PORTS = [
  { provide: IDENTITY_NOTIFIER, useClass: NotificationsIdentityNotifier },
  { provide: USER_DEFAULTS, useClass: AppUserDefaults },
  { provide: IDENTITY_PROFILE_IMAGES, useClass: AppProfileImages },
  { provide: IDENTITY_JOBS, useClass: IdentityJobsAdapter },
  { provide: IDENTITY_METRICS, useExisting: AppMetricsService },
  { provide: IDENTITY_NODE_CREDENTIALS, useExisting: NodeCredentialService },
  { provide: IDENTITY_EVENT_BUS, useExisting: EVENT_BUS },
];

@Global()
@Module({
  imports: [NotificationsModule, JobsModule],
  providers: PORTS,
  exports: PORTS.map((port) => port.provide),
})
export class IdentityHostModule {}
