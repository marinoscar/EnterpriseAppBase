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
//   3. platform email templates    (email/templates/platform-email-templates.ts)
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
// Imported only by `./index.ts`. Never register from `onModuleInit`: several
// Nest applications share one module graph in a Jest worker, and the second
// would hit a frozen registry (packages/platform-api/src/core/registry/README.md).
// =============================================================================

import { ALLOWLIST_NOTIFICATIONS } from '../../allowlist/allowlist.notifications';
import {
  APP_EMAIL_TEMPLATES,
  APP_NOTIFICATIONS,
  APP_NOTIFICATION_CHANNELS,
} from '../../app-registrations/notifications';
import { AUTH_NOTIFICATIONS } from '../../auth/auth.notifications';
import { DB_BACKUP_NOTIFICATIONS } from '../../db-backup/db-backup.notifications';
import type { EmailTemplate } from '../../email/templates/email-template.types';
import { PLATFORM_EMAIL_TEMPLATES } from '../../email/templates/platform-email-templates';
import { NODES_NOTIFICATIONS } from '../../nodes/nodes.notifications';
import { USERS_NOTIFICATIONS } from '../../users/users.notifications';
import { ORGANIZATIONS_NOTIFICATIONS } from '../../organizations/organizations.notifications';
import { BROADCASTS_NOTIFICATIONS } from '../broadcasts/broadcasts.notifications';
import { OPS_NOTIFICATIONS } from '../ops/ops.notifications';
import { registerNotifications } from './bindings.registry';
import { registerNotificationChannels } from './channel.registry';
import { registerEmailTemplates } from './email-template.registry';
import { PLATFORM_NOTIFICATION_CHANNELS } from './platform-channels';

// 1-2. Channels.
registerNotificationChannels(PLATFORM_NOTIFICATION_CHANNELS);
registerNotificationChannels(APP_NOTIFICATION_CHANNELS);

// 3-4. Email templates.
registerEmailTemplates(
  Object.entries(PLATFORM_EMAIL_TEMPLATES).map(([name, render]) => ({
    name,
    render: render as EmailTemplate<never>,
  })),
);
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

// 6. App notifications, last.
registerNotifications(APP_NOTIFICATIONS);
