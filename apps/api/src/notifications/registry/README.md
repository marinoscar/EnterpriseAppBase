# Notification registries

The notification events, channels and templates as registries on the
[registry primitive](../../../../../packages/platform-api/src/core/registry/README.md) in `@marinoscar/platform-api/core` (issue #678,
PP-1.6). Before #678 each was a closed literal in a platform file, so an
application that added an event, a template or a transport had to edit
platform code. Now platform modules declare their own entries next to the
code that raises them, an application declares its own in
[`app-registrations/notifications.ts`](../../app-registrations/notifications.ts),
and the manifest registers both.

The recipe for adding a notification or a channel is in the
[module README](../README.md#adding-a-notification). This file is the API.

## Files

| File | What it holds |
|---|---|
| `channel.registry.ts` | `notificationChannelRegistry`, `NotificationChannelDef`, the augmentable `NotificationChannelIds` and `NotificationChannel`, `registerNotificationChannels`. |
| `event.registry.ts` | `notificationEventRegistry`, `NotificationEventDef` (moved from `notification-events.ts`, unchanged), the event invariants. |
| `email-template.registry.ts` | `emailTemplateRegistry`, `EmailTemplateEntry`, `registerEmailTemplates`. |
| `bindings.registry.ts` | `eventEmailTemplateRegistry`, `eventBrowserTemplateRegistry`, `NotificationRegistration`, `registerNotification`, `registerNotifications`. |
| `channel-sender.registry.ts` | `NotificationChannelSenderRegistry`, the DI-held registry of transports. Nest; not re-exported by `index.ts`. |
| `platform-channels.ts` | The platform's three channels: `email`, `browser`, `push`. |
| `notification.manifest.ts` | The one place that registers. Imported only by `index.ts`. |
| `index.ts` | The barrel. Importing it fills the registries. Framework-free. |

Platform declarations live beside their modules:
`auth/auth.notifications.ts`, `allowlist/allowlist.notifications.ts`,
`users/users.notifications.ts`, `notifications/broadcasts/broadcasts.notifications.ts`,
`notifications/ops/ops.notifications.ts`, `nodes/nodes.notifications.ts`,
`db-backup/db-backup.notifications.ts`, and the email templates in
`email/templates/platform-email-templates.ts`. Platform browser renderers are in
`notifications/channels/browser-templates.ts`.

## Registration order

`notification.manifest.ts` registers, in this order:

1. platform channels
2. app channels (`APP_NOTIFICATION_CHANNELS`)
3. platform email templates (`PLATFORM_EMAIL_TEMPLATES`)
4. app email templates (`APP_EMAIL_TEMPLATES`)
5. platform notifications, in the order the preferences matrix shows them
6. app notifications (`APP_NOTIFICATIONS`)

Order is behaviour: `GET /api/notifications/events` lists events in
registration order, `NOTIFICATION_CHANNELS` (and so every `z.enum` built from
it, and the OpenAPI document) lists channels in registration order. An app id
that collides with a platform id fails with `DUPLICATE_ID`.

## The registries

| Registry | Id | Id pattern | Refuses |
|---|---|---|---|
| `notification-channels` | `id` | `/^[a-z][a-z0-9_]*$/` | empty label or description; duplicates |
| `notification-events` | `key` | `/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/`, at most 64 characters | empty label or description; no channels; a repeated channel; an unregistered channel; `mandatory` without `defaultEnabled: true`; duplicates |
| `email-templates` | `name` | `/^[a-z][a-z0-9-]*$/` (kebab-case, matching the file) | a missing render function; duplicates |
| `notification-event-email-templates` | `eventKey` | event key | an unregistered event; an event without `email`; an unregistered template; a second binding |
| `notification-event-browser-templates` | `eventKey` | event key | an unregistered event; an event with neither `browser` nor `push`; a second binding |

Every refusal is a `RegistryError` whose `id` is the offending key. All five
are static (`defineRegistry`) and frozen once the application bootstraps.

**Never rename a key; add a new one.** Event keys and channel ids are stored
in user preferences and `notification_deliveries`; template names in delivery
records.

## API

```ts
// One notification: event plus its renderers. Atomic: everything is checked
// before anything is registered.
registerNotification({
  event: NotificationEventDef,
  emailTemplate?: string,                        // a registered template name
  browserTemplate?: BrowserNotificationTemplate, // also serves push
}): void;
registerNotifications(inputs: readonly NotificationRegistration[]): void; // each one atomic, in order

registerNotificationChannels(channels: readonly NotificationChannelDef[]): void;
registerEmailTemplates(entries: readonly EmailTemplateEntry[]): void;
```

These are what the manifest calls. An application does not call them itself:
it puts data in `app-registrations/notifications.ts`, and the manifest
registers it at import time. Never call them from `onModuleInit` (see the
primitive's README: the second Nest application in a Jest worker would find
the registries frozen).

### Views kept for existing call sites

The old exports keep their names and meaning, so no call site, DTO or
OpenAPI schema changed:

| Export | Now |
|---|---|
| `NOTIFICATION_CHANNELS` (`notification-events.ts`) | frozen non-empty tuple of the channel ids, so `z.enum(NOTIFICATION_CHANNELS)` works |
| `NOTIFICATION_EVENTS` | frozen array of the registered events |
| `findEvent`, `channelsFor`, `supportsChannel`, `isMandatory`, `listNotificationEvents` | read the registry live |
| `EMAIL_TEMPLATES`, `EMAIL_TEMPLATE_NAMES` (`email/templates/index.ts`) | frozen snapshots of the template registry |
| `isEmailTemplateName`, `findEmailTemplate`, `renderEmailTemplate` | read the registry live |
| `EVENT_EMAIL_TEMPLATES`, `EVENT_BROWSER_TEMPLATES` | frozen snapshots of the binding registries |

The snapshots are taken when their module loads, after the manifest has
registered everything, and the registries freeze at bootstrap, so they are
complete in production. Only an entry a test adds with `withTemporaryEntries`
is missing from them; the dispatcher, the channels and
`GET /api/notifications/events` read the registries, so they see it.

### Types an application widens

```ts
// A channel id the type system should know about:
declare module '../notifications/registry/channel.registry' {
  interface NotificationChannelIds { android_app: true }
}

// A template payload for a typed renderEmailTemplate:
declare module '../email/templates' {
  interface EmailTemplateDataMap { 'coach-weekly-review': CoachWeeklyReviewData }
}
```

## Channel senders

`NotificationChannelSenderRegistry` is an instance registry held by
`NotificationsModule`, which exports it. Its constructor registers the
platform's senders from the `NOTIFICATION_CHANNEL_SENDERS` factory; an
application's sender registers itself from `onModuleInit` with
`registry.register(this)`. It refuses a second sender for a channel
(`DUPLICATE_ID`, "Duplicate notification channel sender registered for
'email'."), a sender for an undeclared channel (`INVALID_ENTRY`) and any
registration after bootstrap (`FROZEN`). Its `get` answers only for
application senders, so exporting it never hands a platform channel to a
feature that could call it around the dispatcher's preference and `mandatory`
gates. `NotificationsService` resolves a channel's sender at delivery time: a
platform sender first, then an application one.

## Testing

Add temporary entries with `withTemporaryEntries` from `@marinoscar/platform-api/core`. To
exercise `registerNotification` itself, open the three registries it writes
and call it inside:

```ts
await withTemporaryEntries(notificationEventRegistry, [], () =>
  withTemporaryEntries(eventEmailTemplateRegistry, [], () =>
    withTemporaryEntries(eventBrowserTemplateRegistry, [], () => {
      registerNotification(appNotification);
      return runTheTest();
    }),
  ),
);
```

Every registry is restored afterwards. Examples: `registry.spec.ts`,
`apps/api/test/notifications/notification-registry.integration.spec.ts`.
`no-cycles.spec.ts` loads each entry point first in an isolated module
registry: a declaration file that imports the browser channel class, or a
template file that imports `email/templates/index.ts`, fails it.
