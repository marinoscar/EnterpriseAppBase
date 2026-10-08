// =============================================================================
// Notification registry manifest (issue #678, PP-1.6)
// =============================================================================
//
// THE explicit, grep-able list of every channel, email template and
// notification this application has. It imports each platform declaration,
// then the app-owned file, and registers them in this order:
//
//   1. platform channels           (platform-channels.ts)
//   2. app channels                (app-registrations/notifications.ts)
//   3. platform email templates    (@marinoscar/platform-api/email, then the
//                                   slice-owned ones in platform/email/templates)
//   4. app email templates         (app-registrations/notifications.ts)
//   5. platform notifications      (one file per owning module, in the order
//                                   the old `NOTIFICATION_EVENTS` array held them)
//   6. app notifications           (app-registrations/notifications.ts)
//
// Channels before events (an event may only declare a registered channel);
// templates before notifications (a binding may only name a registered
// template); platform before app (a collision names the app's entry, and app
// events list after the platform's).
//
// ORDER IS BEHAVIOUR: `GET /api/notifications/events` lists events in
// registration order and the preferences matrix renders them so. Adding a
// platform notification is one appended import and one appended line.
//
// The registries and the platform's own declarations are
// `@marinoscar/platform-api/notifications` (#738); THIS FILE is the app's
// decision of what is registered and in which order, which is why it stays in
// the app. Imported only by `./index.ts`, which `notifications.config.ts`
// imports before it composes `NotificationsModule.forRoot()`. Never register
// from `onModuleInit`: several Nest applications share one module graph in a
// Jest worker, and the second would hit a frozen registry
// (packages/platform-api/src/core/registry/README.md).
// =============================================================================

import { ALLOWLIST_NOTIFICATIONS } from '../../identity-extensions/notifications/allowlist.notifications';
import {
  APP_EMAIL_TEMPLATES,
  APP_NOTIFICATIONS,
  APP_NOTIFICATION_CHANNELS,
} from '../../app-registrations/notifications';
import { AUTH_NOTIFICATIONS } from '../../identity-extensions/notifications/auth.notifications';
import { DB_BACKUP_NOTIFICATIONS } from '../../platform/db-backup/db-backup.notifications';
import {
  configureEmailRendering,
  registerEmailTemplates,
  registerPlatformEmailTemplates,
} from '@marinoscar/platform-api/email';
import { EMAIL_MODULE_OPTIONS } from '../email/email.options';
import { SLICE_EMAIL_TEMPLATES } from '../email/templates';
import { USERS_NOTIFICATIONS } from '../../identity-extensions/notifications/users.notifications';
import { ORGANIZATIONS_NOTIFICATIONS } from '../../identity-extensions/notifications/organizations.notifications';
import { SHARING_NOTIFICATIONS } from '../sharing/sharing.notifications';
import { EXPORTS_NOTIFICATIONS } from '../exports/exports.notifications';
import {
  BROADCASTS_NOTIFICATIONS,
  NODES_NOTIFICATIONS,
  OPS_NOTIFICATIONS,
  registerNotificationChannels,
  registerNotifications,
  registerPlatformNotificationChannels,
} from '@marinoscar/platform-api/notifications';

// 1-2. Channels.
registerPlatformNotificationChannels();
registerNotificationChannels(APP_NOTIFICATION_CHANNELS);

// 3-4. Email templates (the registry lives in @marinoscar/platform-api/email
// since #737). The render context first, with the options EmailModule.forRoot
// receives, so a template rendered before Nest composes anything names the
// product. Then the platform's nine (idempotent; forRoot's call is then a
// no-op), the slice-owned three, the app's own.
configureEmailRendering(EMAIL_MODULE_OPTIONS);
registerPlatformEmailTemplates();
registerEmailTemplates(SLICE_EMAIL_TEMPLATES);
registerEmailTemplates(APP_EMAIL_TEMPLATES);

// 5. Platform notifications, in the order the preferences matrix shows them.
registerNotifications(AUTH_NOTIFICATIONS);
registerNotifications(ALLOWLIST_NOTIFICATIONS);
registerNotifications(USERS_NOTIFICATIONS);
registerNotifications(BROADCASTS_NOTIFICATIONS);
registerNotifications(OPS_NOTIFICATIONS);
registerNotifications(NODES_NOTIFICATIONS);
registerNotifications(DB_BACKUP_NOTIFICATIONS);
registerNotifications(ORGANIZATIONS_NOTIFICATIONS);
registerNotifications(SHARING_NOTIFICATIONS);
registerNotifications(EXPORTS_NOTIFICATIONS);

// 6. App notifications, last.
registerNotifications(APP_NOTIFICATIONS);
