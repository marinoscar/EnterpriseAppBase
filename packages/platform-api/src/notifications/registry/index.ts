// =============================================================================
// Notification registries — public surface (issue #678, PP-1.6)
// =============================================================================
//
// Since #738 the registries live in `@marinoscar/platform-api/notifications`
// and importing this folder fills NOTHING: which channels, templates and
// events exist, and in which order, is the app's decision, made in its own
// manifest (the reference app: `apps/api/src/platform/notifications/
// notification.manifest.ts`), which the app imports before it composes
// `NotificationsModule.forRoot()`.
//
// FRAMEWORK-FREE, like the registries themselves: DTOs built at module
// evaluation time, the seed and `npm run openapi:dump` read these. The one Nest
// piece of this folder, `NotificationChannelSenderRegistry`, is therefore NOT
// re-exported here; import it from './channel-sender.registry' (or from the
// notifications barrel).
//
// Recipe and API: ./README.md.
// =============================================================================

export {
  NOTIFICATION_CHANNEL_ID_PATTERN,
  isRegisteredNotificationChannel,
  listNotificationChannels,
  notificationChannelRegistry,
  registerNotificationChannel,
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
  registerNotificationEvent,
} from './event.registry';
export type { NotificationEventDef } from './event.registry';

// The email template registry moved into @marinoscar/platform-api/email
// (#737); re-exported so the notification registries stay one import.
export {
  EMAIL_TEMPLATE_NAME_PATTERN,
  emailTemplateRegistry,
  registerEmailTemplates,
} from '../../email/index';
export type { EmailTemplateEntry } from '../../email/index';

export {
  eventBrowserTemplateRegistry,
  eventEmailTemplateRegistry,
  registerBrowserNotificationTemplate,
  registerEmailNotificationTemplate,
  registerNotification,
  registerNotifications,
} from './bindings.registry';

export { PLATFORM_NOTIFICATION_CHANNELS, registerPlatformNotificationChannels } from './platform-channels';
export type {
  EventBrowserTemplateBinding,
  EventEmailTemplateBinding,
  NotificationRegistration,
} from './bindings.registry';
