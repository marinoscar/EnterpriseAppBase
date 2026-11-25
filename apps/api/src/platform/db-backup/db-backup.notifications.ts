// =============================================================================
// Database backup notifications (issue #678, PP-1.6)
// =============================================================================
//
// Pure data: the notifications the db-backup slice raises
// (`@marinoscar/platform-api/db-backup`, #740), registered by
// `platform/notifications/notification.manifest.ts`. The slice owns the event
// keys and template names (`DB_BACKUP_NOTIFICATION_EVENTS`,
// `DB_BACKUP_EMAIL_TEMPLATES`); the definitions stay in the app, registered
// through the packaged notification registry (#738), and the browser templates
// come from `@marinoscar/platform-api/notifications`. No side effect on import,
// no Nest, no settings: the manifest is the one place that registers, so
// "which notifications exist?" stays answerable from one file.
//
// An event key is persisted (in preferences and delivery rows): never rename
// one, add a new key. The definitions moved verbatim from the closed
// `NOTIFICATION_EVENTS` array in notifications/notification-events.ts (#288).
// =============================================================================

import { DB_BACKUP_EMAIL_TEMPLATES, DB_BACKUP_NOTIFICATION_EVENTS } from '@marinoscar/platform-api/db-backup';

import {
  backupFailedBrowserTemplate,
  restoreCompletedBrowserTemplate,
} from '@marinoscar/platform-api/notifications';
import type { NotificationRegistration } from '@marinoscar/platform-api/notifications';

export const DB_BACKUP_NOTIFICATIONS: readonly NotificationRegistration[] = [
  {
    event: {
      key: DB_BACKUP_NOTIFICATION_EVENTS.BACKUP_FAILED,
      label: 'Database backup failed',
      description:
        'Sent when a database backup run fails, or stops heartbeating and is given up on. The deployment has one fewer recovery point than it thinks.',
      channels: ['email', 'browser'],
      defaultEnabled: true,
    },
    emailTemplate: DB_BACKUP_EMAIL_TEMPLATES.BACKUP_FAILED,
    browserTemplate: backupFailedBrowserTemplate,
  },
  {
    event: {
      key: DB_BACKUP_NOTIFICATION_EVENTS.RESTORE_COMPLETED,
      label: 'Database restored',
      description:
        'Sent when a database restore finishes and the restored copy becomes the live database. This cannot be turned off.',
      channels: ['email', 'browser'],
      defaultEnabled: true,
      // THE ONE MANDATORY EVENT OF THE FOUR, for the reason `security
      // .role_changed` is mandatory: silence is itself the risk. A restore
      // replaces the live database with the contents of an archive — every write
      // made after that archive was taken is gone, and the process that did it
      // exits immediately afterwards. An operator who is not told is an operator
      // debugging "where did today's data go?" from first principles.
      mandatory: true,
    },
    emailTemplate: DB_BACKUP_EMAIL_TEMPLATES.RESTORE_COMPLETED,
    browserTemplate: restoreCompletedBrowserTemplate,
  },
];
