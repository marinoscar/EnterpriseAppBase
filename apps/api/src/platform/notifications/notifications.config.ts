// The app's notification manifest FIRST: the registries must be complete
// before anything reads them (the events endpoint, the preferences matrix, the
// dispatcher).
import './index';

import {
  BroadcastsModule as PlatformBroadcastsModule,
  NotificationsModule as PlatformNotificationsModule,
} from '@marinoscar/platform-api/notifications';

import { EmailModule } from '../email/email.config';
import { NotificationsHostModule } from './notifications-host.module';

// =============================================================================
// The reference app's notifications slice (issue #738)
// =============================================================================
//
// One `NotificationsModule.forRoot()`: the dispatcher, the channels, the
// stream, `/api/notifications`, `/api/admin/push-config`, the VAPID doctor
// check and the job-failure and node-offline notifiers, from
// `@marinoscar/platform-api/notifications`; global. `BroadcastsModule` is the
// package's static admin-broadcast module.
//
// NAMED LIKE THE MODULE CLASSES THEY REPLACED, on purpose: every importer kept
// its `imports: [NotificationsModule]` line, and the same dynamic-module
// object everywhere is one module to Nest, discovered where the old class was
// (the first importer), so the generated OpenAPI document keeps its path
// order.
// =============================================================================

export const NotificationsModule = PlatformNotificationsModule.forRoot({
  imports: [EmailModule, NotificationsHostModule],
});

export const BroadcastsModule = PlatformBroadcastsModule;
