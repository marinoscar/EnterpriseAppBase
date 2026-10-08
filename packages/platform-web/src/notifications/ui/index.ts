// `@marinoscar/platform-web/notifications/ui`: the notifications web slice's
// components and pages (issue #738, PP-8.5). The app places the bell in its
// own AppBar and the banner in its own layout (the package never imports the
// app shell), and lazy-loads the pages by name:
// `lazy(() => import('@marinoscar/platform-web/notifications/ui').then((m) => ({ default: m.BroadcastsPage })))`.
// Documented in ../README.md.

export { NotificationBell } from './NotificationBell.js';
export type { NotificationBellProps, NotificationBellSlots } from './NotificationBell.js';
export { NotificationPermissionBanner } from './NotificationPermissionBanner.js';
export type { NotificationPermissionBannerProps } from './NotificationPermissionBanner.js';
export { default as BroadcastsPage } from './BroadcastsPage.js';
export { default as NotificationSettingsPage } from './NotificationSettingsPage.js';
export { default as PushConfigPage } from './PushConfigPage.js';
export { default as UserNotificationsPage } from './UserNotificationsPage.js';
