---
"@marinoscar/platform-api": minor
"@marinoscar/platform-contract": minor
"@marinoscar/platform-web": minor
"@marinoscar/platform-db": minor
---

Add the notifications slice: `@marinoscar/platform-api/notifications` (`NotificationsModule.forRoot`, the event, channel and template registries with open channel ids and `registerNotificationChannel`, `NotificationsService` with org-aware policy, the `notifications` system namespace with an org layer that only tightens, runtime Web Push (VAPID) configuration on `SystemSettingsRowStore`, broadcasts with `targetOrgId` and the org-scoped `org_broadcasts:*` pair, the SSE stream on `NOTIFICATIONS_EVENT_BUS`, the email channel forwarding template attachments, the `notifications` conformance suite at `/notifications/testing`), `@Auth({ anyPermissions })` in the identity slice, a `SystemSettingsRowStore` row key that admits camelCase (`webPush`), `@marinoscar/platform-contract/notifications` (the wire shapes, `BROADCAST_CHUNK_SIZE`), `@marinoscar/platform-web/notifications/{headless,ui}` (`configureNotificationsWeb`, `NotificationProvider`, `usePushSubscriptionSync`, `NotificationBell` with slots, the banner and the four pages, the service-worker helpers `registerNotificationServiceWorkerHandlers`, `handlePushEvent`, `handleNotificationClick`, `handlePushSubscriptionChange`), any-of card permissions in the settings hub (`SettingsCardDef.permission: string | readonly string[]`, `cardPermissionGranted`), and the platform migration `0032_add_broadcast_target_org` (`notification_broadcasts.target_org_id`).
