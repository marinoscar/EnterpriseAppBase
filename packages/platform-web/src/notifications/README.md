# @marinoscar/platform-web/notifications

The notifications web slice (issue #738, PP-8.5), as two entry points: `/headless` (the configuration, `NotificationProvider` and its hooks, the push subscription services, the wire types and the service-worker helpers) and `/ui` (the AppBar bell, the permission banner, the preferences matrix and the four pages: the user's Notifications, the admin Notifications policy, Web Push and Broadcasts). Moved out of the reference app's `services/`, `hooks/`, `contexts/`, `components/` and `pages/` by #738. It depends on `core`, `settings` (the settings hooks the two settings pages use) and `identity` (the auth context, the permission check, the table seam) of this package (`packages/platform-slices.json`), and on `@marinoscar/platform-contract/notifications` for the broadcast limits.

## Purpose and scope

Everything a browser does with notifications, without the app writing any of it: the live inbox, the OS toast or a service-worker notification, the Web Push subscription and its once-per-load sync, the preferences, and the operator pages.

| Part | Entry | What it is |
|---|---|---|
| Configuration | `/headless` | `configureNotificationsWeb({ api, apiBaseUrl, connectSse })`: the slice's services are plain module functions (logout calls one outside React), so they reach the API through the client the app configures once at startup. |
| Inbox | `/headless` | `NotificationProvider` (the recent list, the authoritative unread count, the SSE stream, the toast, the service worker's click messages and the `?n=` cold-open parameter) and `useNotifications`. |
| Push | `/headless` | `usePushSubscriptionSync` (the shell's once-per-load sync and the auto-prompt), `requestPermissionAndSyncPush`, `removePushSubscription` (the logout hook). |
| Service worker | `/headless` | `registerNotificationServiceWorkerHandlers` and the three handlers it adds (`handlePushEvent`, `handleNotificationClick`, `handlePushSubscriptionChange`), for the app's own `sw.ts`. DOM-free at import. Import it from `@marinoscar/platform-web/notifications/service-worker` (React-free; the `/headless` barrel re-exports it, but pulls React in, which breaks the worker in Vite dev mode, #886). |
| Shell | `/ui` | `NotificationBell` (with slots) and `NotificationPermissionBanner`, placed by the app in its own AppBar and layout: the package never imports the app shell. |
| Pages | `/ui` | `UserNotificationsPage` (`/settings/notifications`), `NotificationSettingsPage` (`/admin/settings/notifications`), `PushConfigPage` (`/admin/settings/push`), `BroadcastsPage` (`/admin/settings/broadcasts`). |

Not here: the settings hub and its cards (the app declares every card in its own registries), the app's service worker itself (precache, SPA fallback, update handshake stay app code, built by the app's Vite PWA config).

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { configureNotificationsWeb, NotificationProvider } from '@marinoscar/platform-web/notifications/headless';
import { NotificationBell } from '@marinoscar/platform-web/notifications/ui';
```

The package's peers: `react`, `react-dom`, `react-router-dom`, `@mui/material`, `@mui/icons-material`, `@emotion/*`. The pages need the app's `PlatformHostProvider` (`@marinoscar/platform-web/core`, for the settings hooks) and `AuthProvider` (`@marinoscar/platform-web/identity/headless`); the broadcasts list renders through the identity adapters' `DataTable` when the app hands one in, else a plain MUI table.

## Quick start

The reference app's binding ([`platform/notifications.ts`](../../../../apps/web/src/platform/notifications.ts)), imported once by `App.tsx` before the first render:

```ts
configureNotificationsWeb({ api, apiBaseUrl: API_BASE_URL, connectSse });
```

Then the provider around the shell and the logout hook ([`App.tsx`](../../../../apps/web/src/App.tsx)), the bell in the AppBar ([`AppBar.tsx`](../../../../apps/web/src/components/navigation/AppBar.tsx)), the sync and the banner in the layout ([`Layout.tsx`](../../../../apps/web/src/components/common/Layout.tsx)), the pages lazy-loaded by name:

```tsx
<AuthProvider client={api} onBeforeLogout={removePushSubscription}>
  <NotificationProvider><Layout /></NotificationProvider>
</AuthProvider>

const BroadcastsPage = lazy(() =>
  import('@marinoscar/platform-web/notifications/ui').then((m) => ({ default: m.BroadcastsPage })),
);
```

And the app's service worker ([`sw.ts`](../../../../apps/web/src/sw.ts)):

```ts
registerNotificationServiceWorkerHandlers(self, { icon: '/icons/icon-192.png', badge: '/icons/badge-96.png' });
```

## Configuration

`configureNotificationsWeb(config)`, once, at startup. A service called before it throws, naming the fix.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `api` | `NotificationsApiClient` | required | The HTTP client: `get`, `post`, `put`, `delete` returning the unwrapped `data`, throwing core's `ApiError`; `getAccessToken` and `refreshToken` for the stream. The reference app's `ApiService` is assignable as it is. |
| `apiBaseUrl` | `string` | `'/api'` | Where the API lives, for the SSE stream's URL. |
| `connectSse` | `(options: SseOptions) => SseConnection` | none | The GET-with-bearer SSE connector that reconnects. Without it the inbox loads but no live stream opens. |

`registerNotificationServiceWorkerHandlers(self, options)`: `icon` (default `/icons/icon-192.png`) and `badge` (default `/icons/badge-96.png`).

Everything else (whether the browser channel is on, which events are suppressed, the user's preferences, the Web Push keys) is runtime configuration served by the API.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `configureNotificationsWeb` | option | `configureNotificationsWeb(config: NotificationsWebConfig): void` | Bind the slice to the app's transport, base URL and SSE connector at startup | experimental | [example](../../../../apps/web/src/platform/notifications.ts) |
| `NotificationProvider` | component | `<NotificationProvider>{children}</NotificationProvider>` | Mount the live inbox once, inside the auth provider, around the shell | experimental | [example](../../../../apps/web/src/App.tsx) |
| `usePushSubscriptionSync` | hook | `usePushSubscriptionSync(): { config, capability, requestPermission, isRequestingPermission }` | Keep this device's Web Push subscription in sync, once, from the shell | experimental | [example](../../../../apps/web/src/components/common/Layout.tsx) |
| `NotificationPermissionBanner` | component | `<NotificationPermissionBanner config capability onRequestPermission isRequestingPermission? />` | Ask for notification permission app-wide, or say why it cannot be granted here | experimental | [example](../../../../apps/web/src/components/common/Layout.tsx) |
| `NotificationBell` | slot | `<NotificationBell slots?={{ emptyState?, footer?({ close }), itemExtra?(notification) }} />` | Place the bell in the app's AppBar; the slots add app content to its popover | experimental | [example](../../../../apps/web/src/components/navigation/AppBar.tsx) |
| `UserNotificationsPage` | component | `<UserNotificationsPage />` | Route `/settings/notifications` | experimental | [example](../../../../apps/web/src/App.tsx) |
| `NotificationSettingsPage` | component | `<NotificationSettingsPage />` | Route `/admin/settings/notifications` | experimental | [example](../../../../apps/web/src/App.tsx) |
| `PushConfigPage` | component | `<PushConfigPage />` | Route `/admin/settings/push` | experimental | [example](../../../../apps/web/src/App.tsx) |
| `BroadcastsPage` | component | `<BroadcastsPage />` | Route `/admin/settings/broadcasts` (either `broadcasts:read` or `org_broadcasts:read`) | experimental | [example](../../../../apps/web/src/App.tsx) |
| `registerNotificationServiceWorkerHandlers` | hook | `registerNotificationServiceWorkerHandlers(scope, options?): void` | Add the `push`, `notificationclick` and `pushsubscriptionchange` listeners from the app's `sw.ts` | experimental | [example](../../../../apps/web/src/sw.ts) |
| `handlePushEvent` | hook | `handlePushEvent(scope, event, options?): Promise<void>` | Compose your own `push` listener (always shows a notification) | experimental | [example](../../../../apps/web/src/sw.ts) |
| `handleNotificationClick` | hook | `handleNotificationClick(scope, event): void` | Compose your own `notificationclick` listener (re-validates the link, hands the click to a page) | experimental | [example](../../../../apps/web/src/sw.ts) |
| `handlePushSubscriptionChange` | hook | `handlePushSubscriptionChange(scope, event): Promise<void>` | Compose your own `pushsubscriptionchange` listener (best-effort resubscribe) | experimental | [example](../../../../apps/web/src/sw.ts) |

Supporting exports (experimental): `useNotifications` and `NotificationContextValue`; `requestPermissionAndSyncPush`, `removePushSubscription`; `NotificationCapability`; the configuration types (`NotificationsWebConfig`, `NotificationsApiClient`, `NotificationsRequestOptions`, `SseOptions`, `SseConnection`, `SseFrame`, `SseState`); the wire types (`AppNotification`, `NotificationEventDef`, `NotificationChannel` (open), the preference and patch types, `NotificationConfigResponse`, the push subscription types, `SystemNotificationSettings`, the settings document types); the service-worker types (`NotificationsServiceWorkerScope` and the event shapes, structural, so an app's `ServiceWorkerGlobalScope` is assignable); `NotificationBellProps`, `NotificationBellSlots`, `NotificationPermissionBannerProps`.

## Data

None. The slice reads and writes through the API (`/api/notifications`, `/api/admin/push-config`, `/api/admin/broadcasts`, `/api/user-settings`, `/api/system-settings`). Browser state: the permission banner's per-session dismissal (`sessionStorage`), the boot-time `?n=` parameter it strips, and a short in-memory cache of "this browser has an active push subscription". The access token is never stored where the service worker can read it.

## Permissions and settings

Declares none. Each page gates on the exact string its controller enforces: `BroadcastsPage` on `broadcasts:read` or `org_broadcasts:read` (writes on the matching `:write`), `PushConfigPage` on `push:read` (`push:write` for its controls), `NotificationSettingsPage` on `system_settings:read` (`system_settings:write` for its controls), `UserNotificationsPage` on nothing (a user's own preferences). The app's settings registries declare the same strings on the cards; the `Broadcasts` card's permission is the list `['broadcasts:read', 'org_broadcasts:read']`, which the settings hub admits for a holder of either (`cardPermissionGranted`, `@marinoscar/platform-web/settings/ui`).

## UI

MUI throughout, light and dark. The bell's accessible name carries the unread count; its popover is a labelled `role="dialog"`; a filled bell, a badge and a bold row are three cues for "unread", never colour alone. The banner and the preferences matrix name each device state's own remedy (allow, unblock, install to the Home Screen on iOS, HTTPS). The broadcasts table renders through the identity adapters' `DataTable` (the reference app's responsive table), so it follows the app's mobile card layout below `sm`.

## Infra

None. The app's PWA build (`vite-plugin-pwa`, `injectManifest`) compiles its own `sw.ts`, which imports the handlers from `/service-worker` (never the `/headless` barrel: in dev mode nothing is tree-shaken and React reaches the worker); the SSE stream needs the reverse proxy's SSE settings the platform infra ships.

## Observability

None of its own. Requests are traced by the app's transport; the API records deliveries.

## Security notes

- **The service worker never calls the API.** It has no token (the access token is memory-only in the page; the refresh cookie is rotated on every use, so a worker refreshing on its own would log the user out). A click is handed to an open page (`postMessage`) or opens one with the id in `?n=`; the page marks it read on its own token.
- **Links are re-validated before any navigation** (`isInternalLink`: one leading `/`, never `//` or another origin), in the bell, the toast and the worker, even though the API sanitises them at write time.
- **Notification text is rendered as text,** never as HTML.
- **Logout drops this device's push subscription** first (`removePushSubscription`, bounded, never throws), so a signed-out account stops receiving pushes on a shared device.

## Conformance suite

None. The API slice's `notifications` suite covers the server-side invariants; this slice's behaviour is covered by its own tests (`packages/platform-web/test/notifications`) and the reference app's route and registry tests.

## Upgrade notes

New subpaths in this version. From the reference app's local copies (#738):

- Call `configureNotificationsWeb({ api, apiBaseUrl, connectSse })` once at startup; import the provider, hooks and services from `/headless`, the bell, banner and pages from `/ui`.
- `NotificationChannel` is open (`'email' | 'browser' | 'push' | string`): render an unknown channel by its id.
- The app's `sw.ts` keeps its precache and update handshake and calls `registerNotificationServiceWorkerHandlers(self, ...)` instead of carrying the three handlers.
- The `Broadcasts` card and route take `['broadcasts:read', 'org_broadcasts:read']`.
- `Broadcast` and `CreateBroadcastRequest` gain `targetOrgId`; the broadcast limits are the contract's constants.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `call configureNotificationsWeb(...) at startup` | A service ran before the app configured the slice | Import the binding module (the reference app's `platform/notifications.ts`) before the first render |
| No bell in the AppBar | No `NotificationProvider` above it (the bell renders nothing without one, on purpose) | Mount the provider around the shell |
| The inbox loads but nothing arrives live | No `connectSse` configured, or the proxy buffers SSE | Pass the connector; check the proxy's SSE settings |
| Android shows nothing after "Allow" | No active service worker (Android Chrome can only notify through one) | Ship the app's `sw.ts` and let it claim the page |
| A push shows Chrome's "updated in the background" notice | A custom `push` listener that resolved without showing a notification | Use `handlePushEvent`, which always shows one |
| The Broadcasts card is missing for an organization administrator | The card or route still gates on `broadcasts:read` alone | Declare the permission list on both |

## Links

- [Package README](../../README.md)
- [API slice](../../../platform-api/src/notifications/README.md)
- [Contract](../../../platform-contract/src/notifications/README.md)
- [Settings web slice (the hub, any-of card permissions)](../settings/README.md)
- [Browser notifications and Web Push spec](../../../../docs/specs/browser-notifications.md)
- [Settings UI spec](../../../../docs/specs/settings-ui.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)
