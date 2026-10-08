# @marinoscar/platform-api/notifications

The platform's notification framework: the event, channel and template registries, the dispatcher that applies the deployment policy (system, then organization), the recipient's preferences and the `mandatory` rule, the three platform channels (email, the in-app inbox with its SSE stream, Web Push), the runtime-configured Web Push (VAPID) keys, and admin broadcasts to every active user or to one organization's members. Moved out of the reference app's `src/notifications/` by issue #738 (PP-8.5). It depends on `core`, `doctor`, `otel-core`, `identity` (the `@Auth` decorators, the permission strings), `settings` (the namespaces, the org layer, the row store), `credentials` (the VAPID private key), `email` (the template registry and the transports), `jobs` (the broadcast fan-out), `nodes` (the `nodes.node.offline` event) and `testing` of this package (`packages/platform-slices.json`), and on `@marinoscar/platform-contract/notifications` for the wire shapes. The conformance suite and the internals an app's unit tests need are the nested subpath `@marinoscar/platform-api/notifications/testing`, catalogued here.

## Purpose and scope

One way to tell a user something: raise a registered event by key, after the write that caused it commits, and let the dispatcher decide which channels it reaches.

| Part | Source | What it is |
|---|---|---|
| Module | `notifications.module.ts`, `notifications.options.ts` | `NotificationsModule.forRoot({ imports })`: global; the dispatcher, the channels, the inbox and push routes, the doctor check. `BroadcastsModule` (`broadcasts/`) is a sibling module. |
| Registries | `registry/` | Events (`registerNotificationEvent`), channels (`registerNotificationChannel`, open ids), the event-to-template bindings (`registerEmailNotificationTemplate`, `registerBrowserNotificationTemplate`), the one-call `registerNotification`, and the DI-held `NotificationChannelSenderRegistry` (the transports). |
| Dispatcher | `notifications.service.ts` | `notify`, `notifyNow`, `notifyAddress`, `notifyPermissionHolders`, `notifyPermissionHoldersNow`; one delivery row per channel attempt; never throws to its caller. |
| Policy | `notification-policy*.ts`, `notifications.system-settings.ts` | The `notifications` system namespace (`browserEnabled`, `disabledEvents`) with an org layer that may only tighten it (#738). |
| Preferences | `notification-preferences.ts`, `notifications.user-settings.ts` | The `notifications` user namespace, sparse, keyed by open channel ids. |
| Channels | `channels/` | Email (renders a registered template, forwards its inline `attachments`), browser (the `notifications` row plus the SSE publish), push (Web Push to each subscription). |
| Inbox and stream | `notification-store.service.ts`, `notification-stream.service.ts`, `notifications.controller.ts` | `/api/notifications`: events, config, the SSE stream (cross-replica through `NOTIFICATIONS_EVENT_BUS`), the inbox, push subscriptions. |
| Web Push | `push-config.*`, `push-subscription.service.ts`, `push-test.service.ts` | `/api/admin/push-config`: generate, rotate, remove, enable, test. The private key lives in the credential store; the rest in the `webPush` row of `system_settings`. |
| Broadcasts | `broadcasts/` | `/api/admin/broadcasts` and the `admin.broadcast.start` / `admin.broadcast.chunk` jobs; `targetOrgId` (#738) narrows the audience to one organization. |
| Ops | `ops/` | `jobs.job_failed` (a job that failed for good) and `nodes.node_offline` (from the nodes slice's `nodes.node.offline` event), raised to the holders of the permission that can act. |
| Doctor | `doctor/` | `push.vapid` (the key pair is usable) and the Web Push egress entries. |
| Test seams | `testing/` (`/notifications/testing`) | The `notifications` conformance suite, plus the slice's internals (`@internal`) for an app's own unit tests. |

Not here: the notification-retention purge (the reference app's `common/retention`, which owns every retention policy), the email transports and templates themselves (`@marinoscar/platform-api/email`), and any digest or batching of events (no consumer).

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`; import it by its subpath:

```ts
import { NotificationsModule, NotificationsService, registerNotification } from '@marinoscar/platform-api/notifications';
```

`web-push` is a dependency of the package. Beyond the package's peers (`@nestjs/common`, `@nestjs/event-emitter`, `nestjs-zod`, `zod`), the slice needs from the app: core's `PlatformHostModule` (`PLATFORM_PRISMA`, `AUDIT_SINK`), `SettingsModule.forRoot()` (the namespaces and the row store), the email module (`EmailModule.forRoot(...)`, passed in `imports`), the jobs module (the broadcast handlers), the composed `notifications` fragment of `@marinoscar/platform-db`, and `SECRETS_ENCRYPTION_KEY` for the credential store.

## Quick start

The reference app's binding ([`notifications.config.ts`](../../../../apps/api/src/platform/notifications/notifications.config.ts)) and host ports ([`notifications-host.module.ts`](../../../../apps/api/src/platform/notifications/notifications-host.module.ts)):

```ts
import './index'; // the manifest: channels, events and bindings, before any module composes

export const NotificationsModule = PlatformNotificationsModule.forRoot({
  imports: [EmailModule, NotificationsHostModule], // NOTIFICATIONS_METRICS, NOTIFICATIONS_EVENT_BUS
});
export const BroadcastsModule = PlatformBroadcastsModule;
```

The manifest ([`notification.manifest.ts`](../../../../apps/api/src/platform/notifications/notification.manifest.ts)) registers at import time, never from `onModuleInit`:

```ts
registerPlatformNotificationChannels();   // email, browser, push (idempotent)
registerNotifications(BROADCASTS_NOTIFICATIONS);
registerNotifications(APP_NOTIFICATIONS);
```

An app's own notification is one call ([`invoice-ready.notification.ts`](../../../../apps/api/src/examples/notifications/invoice-ready.notification.ts)), raised after the write commits:

```ts
registerNotification({ event, emailTemplate: 'example-invoice-ready', browserTemplate });
await this.notifications.notify('example.invoice_ready', userId, { invoiceNumber, amount });
```

## Configuration

`NotificationsModule.forRoot(options)`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `imports` | `NotificationsImport[]` | `[]` | The modules the slice needs from the app: the email module, and the module binding the host ports (`NOTIFICATIONS_METRICS`, `NOTIFICATIONS_EVENT_BUS`, both optional). |

**None of this is runtime notification configuration.** The deployment policy (`/admin/settings/notifications`), an organization's tightening (`/admin/settings/org-settings`), each user's preferences (`/settings/notifications`) and the Web Push key pair (`/admin/settings/push`) are configured at run time. There is no environment variable for any of them: no VAPID key, subject or switch in `.env`.

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `NotificationsModule.forRoot` | option | `forRoot(options?: NotificationsModuleOptions): DynamicModule` | Mount the slice once, with the email module and the host ports | experimental | [example](../../../../apps/api/src/platform/notifications/notifications.config.ts) |
| `registerNotification` | registry | `registerNotification({ event, emailTemplate?, browserTemplate? }): void` | Add a notification: the event and its renderers, validated together | stable | [example](../../../../apps/api/src/examples/notifications/invoice-ready.notification.ts) |
| `registerNotificationEvent` | registry | `registerNotificationEvent(event: NotificationEventDef): void` | Declare an event alone (its bindings registered elsewhere) | stable | [example](../../../../apps/api/src/examples/notifications/shipment-sent.notification.ts) |
| `registerEmailNotificationTemplate` | registry | `registerEmailNotificationTemplate(eventKey: string, template: string): void` | Bind a registered email template to an event that declares `email` | stable | [example](../../../../apps/api/src/examples/notifications/shipment-sent.notification.ts) |
| `registerBrowserNotificationTemplate` | registry | `registerBrowserNotificationTemplate(eventKey: string, render: BrowserNotificationTemplate): void` | Bind the bell row, OS toast and push renderer to an event | stable | [example](../../../../apps/api/src/examples/notifications/shipment-sent.notification.ts) |
| `registerNotificationChannel` | registry | `registerNotificationChannel(channel: NotificationChannelDef): void` | Declare an app channel id (open: no package edit) | stable | [example](../../../../apps/api/src/examples/notifications/example-webhook.channel.ts) |
| `registerAndroidAppNotificationChannel` | registry | `registerAndroidAppNotificationChannel(): void` | Declare the `android_app` channel (Web Push to Android app subscriptions only, `coveredBy: 'push'`); its sender comes with `AndroidAppModule` | experimental | [example](../../../../apps/api/src/platform/notifications/notification.manifest.ts) |
| `notificationChannelRegistry` | registry | `Registry<NotificationChannelDef>` | List the channels, or extend them in a test | stable | [example](../../../../apps/api/test/examples/notifications/app-channel-and-event.example.spec.ts) |
| `NotificationChannelSenderRegistry` | registry | `register(sender: NotificationChannelSender): void` | Provide the transport of an app channel, from its `onModuleInit` | stable | [example](../../../../apps/api/src/examples/notifications/example-webhook.channel.ts) |
| `NotificationsService` | token | `notify(eventKey, userId, data, options?)`, `notifyNow`, `notifyAddress(eventKey, email, data)`, `notifyPermissionHolders(eventKey, permission, data)`, `notifyPermissionHoldersNow` | Raise an event, after the triggering write commits and outside any `$transaction` | stable | [example](../../../../apps/api/src/platform/identity/identity-notifier.adapter.ts) |
| `NOTIFICATIONS_SYSTEM_SETTINGS` | schema | `SystemSettingsNamespace<'notifications', ...>` with `org: { schema, merge: tightenNotificationsPolicy }` | Register the deployment policy and its org layer (an organization may only tighten it) | stable | [example](../../../../apps/api/src/settings/registry/system-settings.manifest.ts) |
| `NOTIFICATIONS_USER_SETTINGS` | schema | `UserSettingsNamespace<'notifications', ...>` | Register the per-user, per-channel preferences | stable | [example](../../../../apps/api/src/settings/registry/user-settings.manifest.ts) |
| `NOTIFICATIONS_METRICS` | token | `unique symbol` -> `NotificationsMetrics` | Bind the app's delivery counter (no method takes an organization or a user) | experimental | [example](../../../../apps/api/src/platform/notifications/notifications-host.module.ts) |
| `NOTIFICATIONS_EVENT_BUS` | token | `unique symbol` -> `NotificationsEventBus` | Bind the cross-replica bus the SSE stream fans out on | experimental | [example](../../../../apps/api/src/platform/notifications/notifications-host.module.ts) |
| `notificationsConformanceSuite` | registry | `ConformanceSuite<NotificationsConformanceOptions>` | Run the slice's invariants in the app through `runPlatformConformance({ suites: { notifications } })` | experimental | [example](../../../../apps/api/test/notifications/notifications-conformance.spec.ts) |

Supporting exports (experimental unless noted): `ANDROID_APP_NOTIFICATION_CHANNEL` and `collapseOverlappingChannels` (#746); `endpointHost`; `BroadcastsModule`; the options and `NOTIFICATIONS_OPTIONS`; `registerNotifications`, `registerNotificationChannels`, `registerPlatformNotificationChannels`, `isRegisteredNotificationChannel`, `listNotificationChannels`, `notificationEventRegistry`, `eventEmailTemplateRegistry`, `eventBrowserTemplateRegistry`, `PLATFORM_NOTIFICATION_CHANNELS`; `findEvent`, `channelsFor`, `supportsChannel`, `isMandatory`, `listNotificationEvents`; the channel sender contract (`NotificationChannelSender`, `NotificationDispatchContext`, `ChannelDeliveryResult`, `NotifyOptions`); the platform's declarations (`BROADCASTS_NOTIFICATIONS`, `OPS_NOTIFICATIONS`, `NODES_NOTIFICATIONS`, stable) and browser renderers; `sanitizeLink`; the policy (`DEFAULT_NOTIFICATION_POLICY`, `policyChannels`, `isBrowserToastAllowed`, `tightenNotificationsPolicy`); `notificationsPatchSchema`; the stream's bus message types; `PushConfigService`, `PUSH_CONFIG_KEY`, the VAPID credential address and purpose; the broadcast event keys and job types (stable); the permission declarations (`BROADCASTS_PERMISSIONS`, `ORG_BROADCASTS_PERMISSIONS`, `PUSH_PERMISSIONS`); the structural data types (`NotificationsPrisma` and the rows); the DTO classes over the contract schemas.

### The three rungs, for notifications

1. **Option.** `forRoot({ imports })` and the runtime settings: an operator turns the browser channel off or suppresses events for everyone; an organization's administrator tightens that for their members; a user mutes what they may.
2. **Registry.** `registerNotification` adds an event and its renderers; `registerNotificationChannel` adds a channel id. Neither edits a package file. **An event key and a channel id are permanent** once preferences or delivery rows name them: add one, never rename one (a user who muted the old key would silently start receiving the new one).
3. **Token.** A transport for an app channel is a `NotificationChannelSender` that registers itself with `NotificationChannelSenderRegistry` in `onModuleInit` (the example webhook channel). A second sender for a channel that has one fails at bootstrap (`Duplicate notification channel sender registered for 'email'.`); a declared channel with no sender is skipped quietly, so declaring the id before the transport ships is safe.

### Adding a notification

1. **Declare the event.** `key` is `<area>.<event>`, lower snake case, at most 64 characters; `channels` are the channels it can genuinely be delivered over (an event whose recipient may have no account declares `email` only); `defaultEnabled` is what an account with no stored preference gets; `mandatory: true` (only for privilege and security changes) requires `defaultEnabled: true`. A malformed or duplicate key, an unregistered channel or a binding the event cannot use fails at import time with a `RegistryError` naming the key.
2. **Write the renderers.** The email template is registered with the email slice's `registerEmailTemplate` (its data typed by augmenting `EmailTemplateDataMap`) and named in the binding; an event that declares `email` with no template is a recorded delivery failure. The browser renderer returns `{ title, body, link? }`, `link` root-relative; push uses it too; without one the event's `label` and `description` are shown.
3. **Call `notify()` at the real trigger,** after the write commits and outside any `$transaction`. `notify` is detached: it never rejects, never joins your transaction and never delays your response. `notifyNow` is the awaited form for a job handler; `notifyAddress` for a recipient who may have no account; `notifyPermissionHolders` for "whoever can act on this" (the permission constant the area's controller enforces). `NotifyOptions.orgId` names the organization whose policy applies; omitted, the recipient's most recently active membership decides.

### The `android_app` channel (#746)

`registerAndroidAppNotificationChannel()` declares `android_app`: Web Push restricted to the subscriptions registered from inside the Android companion (`push_subscriptions.platform = 'android_app'`). Its transport, `AndroidAppNotificationChannel` (the push sender with a narrower subscription scope), is provided and self-registered by `AndroidAppModule` of `@marinoscar/platform-api/android-app`. An event opts in by listing `android_app` in its `channels`. The channel def carries `coveredBy: 'push'`: when a dispatch resolves both (after preferences and narrowing), `collapseOverlappingChannels` drops `android_app`, so a phone never shows two toasts, and a user who muted `push` still gets `android_app`. Any app channel may declare `coveredBy` the same way.

`POST /api/notifications/push/subscriptions` takes an optional `platform` (`browser` default, `android_app`). An `android_app` post re-tags an existing `browser` row of the same endpoint; a `browser` post never downgrades an `android_app` row (the app's TWA and the phone's Chrome share an endpoint). The CHECK constraint `push_subscriptions_platform_check` limits the column.

### Adding a channel

Declare the id ([`example-webhook.channel.ts`](../../../../apps/api/src/examples/notifications/example-webhook.channel.ts)), provide the sender in the app's own module (its `deliver` returns `{ success: false, error }`, never throws), and list the channel on the events that can use it. A channel with `userConfigurable: false` follows its event default and takes no user preference.

## Data

Models of the `notifications` fragment of `@marinoscar/platform-db`: `Notification` (`notifications`, the inbox), `NotificationDelivery` (`notification_deliveries`, one row per channel attempt: `queued`, then `sent` or `failed`), `PushSubscription` (`push_subscriptions`) and `NotificationBroadcast` (`notification_broadcasts`). #746 adds `push_subscriptions.platform` (`TEXT NOT NULL DEFAULT 'browser'`, CHECK `browser`/`android_app`; platform migration `0033_add_android_app`). #738 adds `notification_broadcasts.target_org_id` (nullable, FK to `organizations`, `Cascade`, indexed): platform migration `0032_add_broadcast_target_org`. The slice reads `users`, `memberships`, `user_settings`, `system_settings`, `jobs` and `organizations`, and appends to `audit_events`, all through `PLATFORM_PRISMA` as structural types (it never imports a generated client). The Web Push configuration is the `webPush` row of `system_settings`, through `SystemSettingsRowStore` (audited `push_config:*`); the private key is the credential-store row of `PUSH_VAPID_CREDENTIAL_PURPOSE`. None of these tables has row-level security: a broadcast is scoped by its `target_org_id` in the service.

## Permissions and settings

| Permission | Scope | Seeded to | Gates |
|---|---|---|---|
| `broadcasts:read`, `broadcasts:write` | system | `admin` | Every broadcast, any audience (`/api/admin/broadcasts`) |
| `org_broadcasts:read`, `org_broadcasts:write` | org | `org_admin` | The active organization's broadcasts only; the target is forced to it, and another organization's broadcast reads as 404 |
| `push:read`, `push:write` | system | `admin` | `/api/admin/push-config` |

The broadcast routes declare `@Auth({ anyPermissions: [system, org] })`: either string admits, and the service scopes by which one the caller holds. The `Broadcasts` card declares the same list (`['broadcasts:read', 'org_broadcasts:read']`). `/api/notifications/*` needs only a signed-in user. Settings: the `notifications` system namespace (`system_settings:read` / `system_settings:write`; its org layer through `/api/org-settings` with `org_settings:read` / `org_settings:write`) and the `notifications` user namespace (`user_settings:*`).

## UI

None in this slice. The bell, the permission banner, the preferences matrix, the admin pages and the service-worker helpers are `@marinoscar/platform-web/notifications`.

## Infra

None. No environment variable: Web Push keys, subject and switch are runtime-configured. The SSE stream needs the reverse proxy's SSE settings (`infra/nginx/platform/`), which the platform infra already ships.

## Observability

Every dispatch is a `notifications.dispatch` span with `notification.event_key`, `notification.channels` and `org.id` (a span attribute, never a metric label). The delivery counter is the app's (`NOTIFICATIONS_METRICS`; the reference app's `app.notifications.deliveries`, labelled by channel, outcome and event key, never by organization or user). Logs: a channel failure (event, channel, the redacted error), an unknown event key (`debug`), a broadcast's progress and failure, each push-config change (never key material).

## Security notes

- **`notify()` runs after the triggering write commits, outside any `$transaction`.** A notification about a rolled-back write is a lie, and a dispatch inside a transaction holds it open across a network round trip. The conformance suite's `after-commit` case scans the app's sources for it.
- **The VAPID private key never leaves the credential store** except into the push channel's signing call: no route, log line, audit row or response carries it, and the contract carries compile-time proofs of that (`PUSH_CONTRACT_CARRIES_NO_SECRET`). A subscription endpoint is a capability URL: logged by host only.
- **Links are root-relative.** `sanitizeLink` drops anything else at write time, and the web client re-validates before navigating.
- **A `mandatory` event ignores stored preferences;** the admin kill switch still withholds its OS toast but keeps its inbox row.
- **Broadcast scope is enforced in the service,** not only by the route gate: an organization administrator's target is forced to their active organization, and naming another (or an unknown one) is a 422.

## Conformance suite

Importing `@marinoscar/platform-api/notifications/testing` registers the `notifications` suite with `runPlatformConformance()`. Run it after the app's manifest has registered:

```ts
import { runPlatformConformance } from '@marinoscar/platform-api/testing';
import '@marinoscar/platform-api/notifications/testing';
import '../../src/platform/notifications';

runPlatformConformance({ sourceRoots: [API_SOURCE_ROOT], suites: { notifications: { afterCommitAllowlist: [] } } });
```

| Case | Fails when |
|---|---|
| `platform` | The platform channels (`email`, `browser`, `push`) or the platform notifications are not registered |
| `templates` | An event that declares `email` has no registered email template |
| `after-commit` | A `notify*()` call sits inside a `$transaction` callback in the app's sources (minus `afterCommitAllowlist`) |
| `no-secret` | The Web Push settings or their admin view declare a secret-bearing field |

## Upgrade notes

New subpath in this version. From the reference app's local `src/notifications/` (#738):

- Import from `@marinoscar/platform-api/notifications`; mount `NotificationsModule.forRoot({ imports: [EmailModule, <host ports module>] })` once. It is global.
- Channel ids are open strings: `NOTIFICATION_CHANNELS` and the `NotificationChannelIds` augmentation are gone; register a channel with `registerNotificationChannel`. Preference keys and broadcast channels are checked against the registry at run time; the OpenAPI channel fields are patterns, not enums.
- The `notifications` system namespace has an org layer: an organization may turn the browser channel off and suppress more events for its members. `NotificationPolicyService.getPolicy(orgId?)` resolves it.
- Broadcasts take an optional `targetOrgId`, and the org-scoped `org_broadcasts:*` pair exists (seed it to `org_admin`). The routes accept either pair.
- The email channel forwards the rendered template's `attachments` (the layout's brand mark), as the test email always did.
- Web Push configuration is read and written through the settings slice's `SystemSettingsRowStore` (the `webPush` row; stored values and audit actions unchanged).
- The cross-replica stream rides `NOTIFICATIONS_EVENT_BUS`; the delivery counter `NOTIFICATIONS_METRICS`. Both optional.
- Internals an app's unit tests used (the channels, the stream, the controllers, the broadcast handlers) are on `/notifications/testing`, `@internal`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `RegistryError ... is not a registered notification channel` at import | An event names a channel no one registered (or registers before the channel) | Register the channel first (`registerNotificationChannel`, or `registerPlatformNotificationChannels()` for the platform's) |
| `Duplicate notification channel sender registered for 'x'.` at bootstrap | Two senders for one channel | Remove one; a platform channel's sender is not replaceable (file a seam request if you need that) |
| `PATCH /user-settings` 400 `"x" is not a registered notification channel` | A preference for a channel this deployment does not register | Register the channel, or drop the key from the client |
| An event never reaches the bell | `browserEnabled: false` (system or the recipient's organization), the event in `disabledEvents`, or the user muted it | Check `/admin/settings/notifications`, the organization's settings, the user's preferences |
| Web Push: nothing arrives, the doctor's `push.vapid` fails | No key pair, the switch off, or the private key unreadable (rotated `SECRETS_ENCRYPTION_KEY`) | Generate or rotate at `/admin/settings/push`; run its test |
| Broadcast `422` naming the organization | An org administrator named another organization, or the organization does not exist | Omit `targetOrgId` (it defaults to the active organization) |
| The stream shows a notification on one replica only | No `NOTIFICATIONS_EVENT_BUS` bound | Bind the app's event bus in the host ports module |
| The conformance `after-commit` case fails | A `notify` inside `$transaction(async (tx) => ...)` | Move the call after the transaction resolves |

## Links

- [Package README](../../README.md)
- [Platform packages spec](../../../../docs/specs/platform-packages.md)
- [Contract](../../../platform-contract/src/notifications/README.md)
- [Web counterpart](../../../platform-web/src/notifications/README.md)
- [Email slice (templates, transports)](../email/README.md)
- [Settings slice (namespaces, the org layer, the row store)](../settings/README.md)
- [Jobs slice (the broadcast fan-out)](../jobs/README.md)
- [Browser notifications and Web Push spec](../../../../docs/specs/browser-notifications.md)
- [Notification broadcasts spec](../../../../docs/specs/notification-broadcasts.md)
- [VAPID keys runbook](../../../../docs/runbooks/vapid-keys.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)
