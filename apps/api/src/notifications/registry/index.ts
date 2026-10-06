// =============================================================================
// Notification registries — public surface (issue #678, PP-1.6)
// =============================================================================
//
// Importing this folder fills the registries (through the manifest), so any
// consumer that can see a registry sees it complete. Consumers import from
// here (`'../notifications/registry'`), never from the individual files; the
// declaration files are the exception, because they are imported BY the
// manifest and must reach the types without importing it back.
//
// FRAMEWORK-FREE, like the registries themselves: DTOs built at module
// evaluation time, the seed and `npm run openapi:dump` read these. The one Nest
// piece of this folder, `NotificationChannelSenderRegistry`, is therefore NOT
// re-exported here; import it from './channel-sender.registry' (or from the
// notifications barrel).
//
// Recipe and API: ./README.md.
// =============================================================================

import './notification.manifest';

export {
  NOTIFICATION_CHANNEL_ID_PATTERN,
  notificationChannelRegistry,
  registerNotificationChannels,
} from './channel.registry';
export type {
  NotificationChannel,
  NotificationChannelDef,
  NotificationChannelIds,
} from './channel.registry';

export {
  NOTIFICATION_EVENT_KEY_MAX_LENGTH,
  NOTIFICATION_EVENT_KEY_PATTERN,
  notificationEventRegistry,
} from './event.registry';
export type { NotificationEventDef } from './event.registry';

export {
  EMAIL_TEMPLATE_NAME_PATTERN,
  emailTemplateRegistry,
  registerEmailTemplates,
} from './email-template.registry';
export type { EmailTemplateEntry } from './email-template.registry';

export {
  eventBrowserTemplateRegistry,
  eventEmailTemplateRegistry,
  registerNotification,
  registerNotifications,
} from './bindings.registry';
export type {
  EventBrowserTemplateBinding,
  EventEmailTemplateBinding,
  NotificationRegistration,
} from './bindings.registry';
