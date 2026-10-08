// `@marinoscar/platform-web/notifications/headless`: the notifications web
// slice's configuration, provider, hooks, services, wire types and the
// service-worker helpers (issue #738, PP-8.5), with no component. Documented
// in ../README.md.
//
// The service-worker helpers are DOM-free at import time (no React, no
// `window`), so an app's `sw.ts` imports them from here without pulling the
// page's code into the worker bundle (the package is `sideEffects: false`).

export { configureNotificationsWeb } from './api.js';
export type { NotificationsApiClient, NotificationsRequestOptions, NotificationsWebConfig } from './api.js';
export type { SseConnection, SseFrame, SseOptions, SseState } from './sse.js';

export { NotificationProvider, useNotifications } from './NotificationContext.js';
export type { NotificationContextValue } from './NotificationContext.js';
export { usePushSubscriptionSync } from './usePushSubscriptionSync.js';
export type { UsePushSubscriptionSyncResult } from './usePushSubscriptionSync.js';
export type { NotificationCapability } from './useNotificationCapability.js';
export { removePushSubscription, requestPermissionAndSyncPush } from './pushSubscription.js';

export type {
  AppNotification,
  NotificationChannel,
  NotificationChannelPreferences,
  NotificationChannelPreferencesPatch,
  NotificationConfigResponse,
  NotificationEventDef,
  NotificationListResponse,
  NotificationPreferences,
  NotificationPreferencesPatch,
  NotificationStreamEvent,
  NotificationsSystemSettingsDocument,
  NotificationsUserSettingsDocument,
  NotificationsUserSettingsUpdate,
  PushSubscriptionPayload,
  PushSubscriptionResponse,
  SystemNotificationSettings,
  UnreadCountResponse,
} from './types.js';

export {
  handleNotificationClick,
  handlePushEvent,
  handlePushSubscriptionChange,
  registerNotificationServiceWorkerHandlers,
} from './service-worker.js';
export type {
  NotificationPushPayload,
  NotificationServiceWorkerOptions,
  NotificationsClickEvent,
  NotificationsExtendableEvent,
  NotificationsPushEvent,
  NotificationsPushSubscriptionChangeEvent,
  NotificationsServiceWorkerClient,
  NotificationsServiceWorkerScope,
  NotificationsShowOptions,
} from './service-worker.js';
