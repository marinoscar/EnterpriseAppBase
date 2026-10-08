// =============================================================================
// `@marinoscar/platform-api/notifications` (issue #738, PP-8.5)
// =============================================================================
//
// The notifications slice: the event, channel and template registries, the
// dispatcher, the channels (email, the in-app inbox and its SSE stream, Web
// Push), the runtime Web Push configuration, the org-aware policy, admin
// broadcasts (org-targeted), and the `job.settled` and `nodes.node.offline`
// notifiers. Documented in ./README.md; the internals an app's own unit tests
// construct are `@marinoscar/platform-api/notifications/testing`.
//
// Explicit named exports only.
// =============================================================================

// ---- modules ---------------------------------------------------------------------------
export { NotificationsModule } from './notifications.module';
export { BroadcastsModule } from './broadcasts/broadcasts.module';
export { NOTIFICATIONS_OPTIONS, resolveNotificationsModuleOptions } from './notifications.options';
export type {
  NotificationsImport,
  NotificationsModuleOptions,
  ResolvedNotificationsModuleOptions,
} from './notifications.options';

// ---- host ports ------------------------------------------------------------------------
export {
  NOOP_NOTIFICATIONS_METRICS,
  NOTIFICATIONS_EVENT_BUS,
  NOTIFICATIONS_METRICS,
  NOTIFICATION_STREAM_BUS_CHANNEL,
  NOTIFICATION_STREAM_INLINE_LIMIT_BYTES,
} from './ports';
export type {
  NotificationDeliveryOutcome,
  NotificationsEventBus,
  NotificationsEventBusMeta,
  NotificationsMetrics,
} from './ports';

// ---- the dispatcher ----------------------------------------------------------------------
export { NotificationsService } from './notifications.service';
export type {
  ChannelDeliveryResult,
  NotificationChannelSender,
  NotificationDispatchContext,
  NotificationRecipient,
  NotifyNowResult,
  NotifyOptions,
  NotifyPermissionHoldersOptions,
} from './notification.types';

// ---- registries --------------------------------------------------------------------------
export {
  EMAIL_TEMPLATE_NAME_PATTERN,
  ANDROID_APP_NOTIFICATION_CHANNEL,
  NOTIFICATION_CHANNEL_ID_PATTERN,
  NOTIFICATION_EVENT_KEY_MAX_LENGTH,
  NOTIFICATION_EVENT_KEY_PATTERN,
  PLATFORM_NOTIFICATION_CHANNELS,
  collapseOverlappingChannels,
  emailTemplateRegistry,
  eventBrowserTemplateRegistry,
  eventEmailTemplateRegistry,
  isRegisteredNotificationChannel,
  listNotificationChannels,
  notificationChannelRegistry,
  notificationEventRegistry,
  registerBrowserNotificationTemplate,
  registerEmailNotificationTemplate,
  registerEmailTemplates,
  registerNotification,
  registerNotificationChannel,
  registerNotificationChannels,
  registerNotificationEvent,
  registerNotifications,
  registerAndroidAppNotificationChannel,
  registerPlatformNotificationChannels,
} from './registry/index';
export type {
  EmailTemplateEntry,
  EventBrowserTemplateBinding,
  EventEmailTemplateBinding,
  NotificationChannel,
  NotificationChannelDef,
  NotificationChannelIds,
  NotificationEventDef,
  NotificationRegistration,
} from './registry/index';
export { NotificationChannelSenderRegistry } from './registry/channel-sender.registry';
export { channelsFor, findEvent, isMandatory, listNotificationEvents, supportsChannel } from './notification-events';

// The platform's own notifications, for the app's manifest to register in its
// chosen order.
export { BROADCASTS_NOTIFICATIONS } from './broadcasts/broadcasts.notifications';
export { NODES_NOTIFICATIONS } from './ops/nodes.notifications';
export { OPS_NOTIFICATIONS } from './ops/ops.notifications';

// ---- browser and push rendering ----------------------------------------------------------
export {
  backupFailedBrowserTemplate,
  broadcastBrowserTemplate,
  nodeOfflineBrowserTemplate,
  restoreCompletedBrowserTemplate,
  roleChangedBrowserTemplate,
} from './channels/browser-templates';
export type { BrowserNotificationContent, BrowserNotificationTemplate } from './channels/browser-templates';
export { sanitizeLink } from './channels/browser-notification.channel';

// ---- preferences, policy, settings namespaces ------------------------------------------
export {
  NOTIFICATION_PREFERENCES_NAMESPACE,
  isChannelEnabled,
  readNotificationPreferences,
  resolveChannels,
} from './notification-preferences';
export type { ChannelPreferences, NotificationPreferences } from './notification-preferences';
export { DEFAULT_NOTIFICATION_POLICY, isBrowserToastAllowed, policyChannels } from './notification-policy';
export type { NotificationPolicy } from './notification-policy';
export { NOTIFICATIONS_SYSTEM_SETTINGS, tightenNotificationsPolicy } from './notifications.system-settings';
export { NOTIFICATIONS_USER_SETTINGS, notificationsPatchSchema } from './notifications.user-settings';

// ---- the stream --------------------------------------------------------------------------
export { HEARTBEAT_INTERVAL_MS, NOTIFICATION_SSE_EVENT, parseNotificationStreamBusMessage } from './notification-stream.service';
export type {
  NotificationStreamBusMessage,
  NotificationStreamEvent,
  NotificationStreamInlineMessage,
  NotificationStreamRefMessage,
  SseMessage,
} from './notification-stream.service';

// ---- Web Push configuration ----------------------------------------------------------------
export { PUSH_CONFIG_KEY, PushConfigService } from './push-config.service';
// #746: what the android-app slice (a sibling) needs to send its test
// notification and to provide the `android_app` sender. The two classes are
// `@internal` (no app should reach a channel or the test sender directly).
export { PushTestService, endpointHost } from './push-test.service';
export { AndroidAppNotificationChannel } from './channels/android-app-notification.channel';
export type { ActiveVapidConfig, PrivateKeyStatus, PushConfigAdminView } from './push-config.service';
export { DEFAULT_PUSH_CONFIG } from './push-config.schema';
export {
  PUSH_VAPID_CREDENTIAL_LABEL,
  PUSH_VAPID_CREDENTIAL_NAME,
  PUSH_VAPID_CREDENTIAL_PURPOSE,
  PUSH_VAPID_CREDENTIAL_PURPOSE_DEF,
} from './push-vapid-credential.constants';
export { PUSH_SETTINGS_PATH } from './doctor/push-vapid.doctor-check';

// ---- broadcasts ----------------------------------------------------------------------------
export {
  BROADCAST_CHUNK_SIZE,
  BROADCAST_SEND_CONCURRENCY,
  BROADCAST_SUBJECT_TYPE,
  audienceWhere,
} from './broadcasts/broadcast-audience';
export { BROADCAST_CRITICAL_EVENT_KEY, BROADCAST_EVENT_KEY } from './broadcasts/broadcasts.service';
export { BROADCAST_START_TYPE } from './broadcasts/handlers/broadcast-start.handler';
export { BROADCAST_CHUNK_TYPE } from './broadcasts/handlers/broadcast-chunk.handler';

// ---- permissions ---------------------------------------------------------------------------
export {
  BROADCASTS_PERMISSIONS,
  ORG_BROADCASTS_PERMISSIONS,
  PUSH_PERMISSIONS,
} from './notifications.permissions';
export type { NotificationsPermissionDeclaration } from './notifications.permissions';

// ---- data --------------------------------------------------------------------------------
export { NotificationBroadcastStatus, NotificationDeliveryStatus } from './data/notifications-db';
export type {
  NotificationBroadcastRow,
  NotificationDeliveryRow,
  NotificationRow,
  NotificationsBatchPayload,
  NotificationsBatchTransaction,
  NotificationsDelegate,
  NotificationsForeignDelegate,
  NotificationsInputJsonValue,
  NotificationsJsonValue,
  NotificationsPrisma,
  NotificationsQueryArgs,
  NotificationsTx,
  NotificationsWhere,
  PushSubscriptionRow,
} from './data/notifications-db';
