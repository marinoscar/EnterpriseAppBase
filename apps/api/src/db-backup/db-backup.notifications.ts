// =============================================================================
// Database backup notifications (issue #678, PP-1.6)
// =============================================================================
//
// Pure data: the notifications this module raises, declared next to the code
// that raises them and registered by
// `notifications/registry/notification.manifest.ts`. No side effect on import,
// no Nest, no settings: the manifest is the one place that registers, so
// "which notifications exist?" stays answerable from one file.
//
// An event key is persisted (in preferences and delivery rows): never rename
// one, add a new key. The definitions moved verbatim from the closed
// `NOTIFICATION_EVENTS` array in notifications/notification-events.ts (#288).
// =============================================================================

import {
  backupFailedBrowserTemplate,
  restoreCompletedBrowserTemplate,
} from '@marinoscar/platform-api/notifications';
import type { NotificationRegistration } from '@marinoscar/platform-api/notifications';

export const DB_BACKUP_NOTIFICATIONS: readonly NotificationRegistration[] = [
  {
    event: {
      key: 'db_backup.backup_failed',
      label: 'Database backup failed',
      description:
        'Sent when a database backup run fails, or stops heartbeating and is given up on. The deployment has one fewer recovery point than it thinks.',
      channels: ['email', 'browser'],
      defaultEnabled: true,
    },
    emailTemplate: 'backup-failed',
    browserTemplate: backupFailedBrowserTemplate,
  },
  {
    event: {
      key: 'db_backup.restore_completed',
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
    emailTemplate: 'restore-completed',
    browserTemplate: restoreCompletedBrowserTemplate,
  },
];
