---
"@marinoscar/platform-api": minor
"@marinoscar/platform-contract": minor
"@marinoscar/platform-web": minor
---

Notifications: dismiss-on-disable, dismiss-all and the `sync` stream frame (#1090). Settings: namespace `onWrite` hooks (#1105).

- Settings: a system or user namespace declaration may carry `onWrite(tx, { userId, scope, before, after })` (`SettingsWriteHook`, `SettingsWriteContext`, `SettingsTx`). `SystemSettingsService` and `UserSettingsService` run it inside the write's transaction, after the row and before commit, for each namespace whose value changed, in registration order; a throw rolls the write back. A write that triggers no hook stays a single write. `SettingsPrisma` gains `$transaction`.
- Notifications: disabling an event dismisses its live inbox rows in the settings write's transaction, per user (the `browser` channel preference, the `notifications` user namespace) and deployment-wide (`notifications.disabledEvents`, non-mandatory events only). Re-enabling restores nothing. New exports `dismissEventsForUser`, `dismissEventsGlobally`, `inboxDisabledEventKeys`, `dismissibleEventKeys`.
- Notifications: `POST /api/notifications/dismiss-all` (optional `scopeId`), `GET /api/notifications?status=all|unread|read|dismissed`, and a `sync` SSE frame (`NotificationStreamService.publishSync`, bus message `{ userId, sync, reason }`) published after read, read-all, dismiss and dismiss-all. The oversize by-reference stream path now keeps `count`, `scopeId`, `updatedAt` and `reason`.
- Contract: `NOTIFICATION_LIST_STATUSES`, `NOTIFICATION_SSE_SYNC_EVENT`, `NOTIFICATION_SYNC_REASONS`, `dismissAllNotificationsSchema`, `dismissAllResultSchema`, `notificationSyncFrameSchema`, and `status` on `notificationListQuerySchema`.
- Web: `connectNotificationStream` takes `onSync`; `NotificationProvider` refetches on a `sync` frame and `useNotifications` gains `dismissAll(scopeId?)`; `getNotifications` accepts `status`.
