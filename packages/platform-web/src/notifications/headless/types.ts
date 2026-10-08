// =============================================================================
// The notifications web wire types (issue #738; shapes from #121 to #355)
// =============================================================================
//
// Moved from the reference app's `types/index.ts` with their meaning
// unchanged, except that a channel id is OPEN (`NotificationChannel`). The
// app re-exports them under the same names.
// =============================================================================

// =============================================================================
// Notifications — the registry (#124) and the stored preferences (#126, epic #109)
// =============================================================================
//
// TWO DIFFERENT SHAPES THAT ARE EASY TO CONFUSE, so they are named apart here:
//
//   * `NotificationEventDef`  — what events EXIST. Static, identical for every
//     caller, served by `GET /api/notifications/events`. The server owns it;
//     the web app never declares its own copy (see the long argument in
//     `apps/api/src/notifications/notification-events.ts`).
//   * `NotificationPreferences` — what THIS user chose, stored inside the
//     user-settings document under `notifications`.
//
// A definition is not a preference: an account with no stored preferences is
// not "no events", it is every event at its registry default.
// =============================================================================

/**
 * A delivery channel.
 *
 * Mirrors the API's `NOTIFICATION_CHANNELS`. This union is the ONE piece of the
 * registry the web app restates, and only because it is the key type of the
 * patch documents below — an open `string` there would let a typo compile.
 * It is a closed set server-side too (the PATCH schema validates the outer key
 * against the same enum and 400s on anything else), so a channel this union
 * lacks is a channel this app could not write anyway.
 *
 * `'push'` was added here in #228 (epic #215), mirroring the API's widening of
 * `NOTIFICATION_CHANNELS` in the same issue. #228 also builds the
 * preferences-matrix column for it (`pushChannelState()` in
 * `NotificationSettings.tsx`, disabled while the deployment's `pushEnabled` is
 * `false`). The column only has rows for events that declare `push`.
 *
 * Rendering is nonetheless written to survive a NEWER server that declares a
 * channel this build has never heard of — see `CHANNEL_LABELS` in
 * `components/settings/NotificationSettings.tsx`, which falls back to the raw
 * key rather than rendering a blank label.
  *
  * @stability experimental
 */
// OPEN since #738: any channel id the API registered (an app's own included);
// the three platform ids are named for completion.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type NotificationChannel = 'email' | 'browser' | 'push' | (string & {});

/**
 * One entry of the event registry, as served by `GET /api/notifications/events`.
 *
 * Field for field the API's `notificationEventSchema`. Note `mandatory` is a
 * plain `boolean` here, not `boolean | undefined`: the API normalises it on the
 * way out precisely so no client has to know that absent means "the user is in
 * charge".
  *
  * @stability experimental
 */
export interface NotificationEventDef {
  /** Stable key. What a preference is stored against; renaming one server-side is a migration. */
  key: string;
  /** Short human label — the row heading on the preferences page. */
  label: string;
  /** One sentence on what actually triggers this, in the user's terms. */
  description: string;
  /**
   * Channels this event CAN be delivered over — a capability of the event, not
   * a statement about which transports are implemented yet. A cell is rendered
   * only for a channel listed here, so `allowlist.invitation` (email only, its
   * recipient has no session by definition) never offers a browser toggle.
   *
   * NARROWED BY THE ADMIN POLICY: a non-mandatory event does not list
   * `browser` while an administrator has browser notifications off or has
   * suppressed that event. This is what the user will actually receive.
   */
  channels: NotificationChannel[];
  /**
   * The channels the event DECLARES in the registry, before administrator
   * policy (#521). Only the admin notification-policy page should read this:
   * it must keep listing an event whose browser delivery is suppressed, so the
   * suppression can be undone. Everyone else reads `channels`.
   */
  declaredChannels: NotificationChannel[];
  /** What an account that has expressed no preference receives. */
  defaultEnabled: boolean;
  /**
   * The user may not opt out, on ANY channel.
   *
   * A UI HINT ONLY — the gate is server-side in preference resolution, because
   * a client-side check is bypassed by any request that never went near the
   * client. Render the controls disabled WITH the reason rather than hiding
   * them: a dead toggle teaches nothing (epic #109, success criterion 5).
   */
  mandatory: boolean;
}

/**
 * One channel's stored preferences: event key -> the user's explicit choice.
 *
 * SPARSE. A key is present only where the user deliberately chose something. An
 * absent key is NOT `false` and must never be normalised into one — absent
 * means "use the registry's `defaultEnabled`", resolved at read time.
  *
  * @stability experimental
 */
export type NotificationChannelPreferences = Record<string, boolean>;

/**
 * The `notifications` namespace of the user-settings document, as stored.
 *
 * CHANNEL-OUTER, EVENT-INNER — `{ email: { 'user.welcome': false } }`. Not a
 * choice this file makes: it is the shape the API's
 * `readNotificationPreferences` parses and `isChannelEnabled` resolves, and a
 * document written event-outer would be silently ignored by the dispatcher,
 * i.e. a mute that never takes effect.
 *
 * Every level is optional, all the way down. There is deliberately no shape of
 * this value that asserts "the user has an opinion about every event".
  *
  * @stability experimental
 */
export type NotificationPreferences = Partial<
  Record<NotificationChannel, NotificationChannelPreferences>
>;

/**
 * PATCH form of one channel's preferences.
 *
 * The value is nullable because JSON Merge Patch uses `null` to mean DELETE:
 * `{ email: { 'user.welcome': null } }` removes that one event key, restoring
 * the absent (= registry default) state. That is what the preferences page
 * sends when a control returns to its default — writing the default value
 * explicitly works today and pins the user to today's default forever.
  *
  * @stability experimental
 */
export type NotificationChannelPreferencesPatch = Record<string, boolean | null>;

/**
 * PATCH form of the `notifications` namespace. Three levels of delete, each
 * meaning something different (see `UserSettingsUpdate`).
 *
 * Unlike `dataTables`, a non-null channel object is DEEP-merged per event
 * rather than replacing the channel wholesale — which is exactly what lets the
 * page send one key per toggle and leave every other preference absent.
  *
  * @stability experimental
 */
export type NotificationPreferencesPatch = Partial<
  Record<NotificationChannel, NotificationChannelPreferencesPatch | null>
>;

// =============================================================================
// The notification centre — delivered notifications (#127, epic #109)
// =============================================================================
//
// A THIRD notification shape, and the one most easily confused with the two
// above, so: `NotificationEventDef` is what CAN happen, `NotificationPreferences`
// is what the user WANTS, and `AppNotification` below is something that
// ACTUALLY HAPPENED — one row of the `notifications` table, addressed to this
// user, with its own read state.
//
// NAMED `AppNotification`, NOT `Notification`. The DOM declares a global
// `Notification` (the constructor behind the native toast), and this file's
// types are imported into modules that use BOTH — `services/browserNotifications.ts`
// raises a real `new Notification(...)` from one of these rows. A local
// interface called `Notification` would shadow the global inside every one of
// those modules, so the toast would silently be constructed from the wrong
// thing or fail to compile in a confusing place. The prefix costs one word and
// removes the collision entirely.
// =============================================================================

/**
 * One delivered notification, field for field the API's `notificationSchema`
 * (`apps/api/src/notifications/dto/notification.dto.ts`).
 *
 * THE SAME SHAPE ARRIVES TWO WAYS — fetched from `GET /api/notifications`, or
 * pushed over SSE — and that is deliberate on the API's side: a streamed event
 * is this object minus `readAt`, so both go into the same list with no second
 * mapping. See `streamEventToNotification` in `services/notificationStream.ts`,
 * which is the only place the missing field is filled in.
  *
  * @stability experimental
 */
export interface AppNotification {
  /** The row id. */
  id: string;
  /**
   * The registry key that raised this (`security.role_changed`).
   *
   * For grouping, icons or filtering. NOT what is rendered — `title` and `body`
   * were rendered server-side at write time, so editing a template never
   * rewrites what a user was already told.
   */
  eventKey: string;
  /** One short line. Already length-capped by the API. Render as TEXT. */
  title: string;
  /** The detail. Plain text, never markup. */
  body: string;
  /**
   * Root-relative path to open, or `null`.
   *
   * GUARANTEED INTERNAL by the API — `sanitizeLink` validated it before the row
   * was written, so it is always a single leading `/` with no scheme and no
   * protocol-relative `//`. That is what makes it safe to hand to
   * `navigate()`. The client still refuses anything that does not start with a
   * single `/` (see `isInternalLink` in `NotificationBell.tsx`): the guarantee
   * is the server's to keep, and a client that also checks costs one comparison
   * and survives the day it is broken.
   */
  link: string | null;
  /** ISO-8601. When the user marked it read; `null` while unread. */
  readAt: string | null;
  /** ISO-8601. */
  createdAt: string;
}

/**
 * A page of `GET /api/notifications`.
 *
 * FLAT pagination (`items`/`total`/`page`/`pageSize`/`totalPages`), matching
 * `/users` and `/allowlist` rather than storage's nested `pagination` object —
 * the API deliberately picked the more common of its two existing list shapes.
  *
  * @stability experimental
 */
export interface NotificationListResponse {
  /** This page's rows, newest first. */
  items: AppNotification[];
  /** Matching rows in total. */
  total: number;
  /** The page number. */
  page: number;
  /** The page size. */
  pageSize: number;
  /** Pages in total. */
  totalPages: number;
}

/**
 * The badge number.
 *
 * Returned by `GET /api/notifications/unread-count` AND by BOTH mark-read
 * endpoints — which is why marking one read costs a single round trip: the
 * client already holds the row it marked, and the count is the only thing it
 * cannot compute for itself. Do not follow a mark-read with a count fetch.
  *
  * @stability experimental
 */
export interface UnreadCountResponse {
  /** Unread notifications. */
  unreadCount: number;
}

/**
 * One `event: notification` frame's payload, as `NotificationStreamService`
 * publishes it.
 *
 * `AppNotification` WITHOUT `readAt`, PLUS `toast` — not an oversight and not a
 * different model. `readAt` is absent because a notification is unread by
 * definition at the instant it is published, so the field would carry no
 * information. `toast` is present because it is an instruction about THIS
 * delivery rather than a property of the stored row. Everything else is
 * identical, which is the property that lets a streamed event be pushed
 * straight into the fetched list.
 *
 * Carries NO user id. The recipient is implicit in which stream it arrived on;
 * the API omits it specifically so no client is ever tempted to filter on it.
  *
  * @stability experimental
 */
export type NotificationStreamEvent = Omit<AppNotification, 'readAt'> & {
  /**
   * May this client raise an OS notification for this event? (#226, epic #215)
   *
   * SERVER-COMPUTED, from the administrator's deployment-wide policy:
   * `browserEnabled && !disabledEvents.includes(eventKey)`. It travels with the
   * event rather than being derived from a cached
   * `GET /api/notifications/config`, so a tab open since before an
   * administrator changed the setting still honours the current policy.
   *
   * `false` DOES NOT MEAN SUPPRESSED. The notification was recorded and this
   * frame was sent; the bell, the unread count and the notification centre are
   * unaffected. Only the OS bubble is withheld — which is what lets an
   * administrator mute toasts without muting a mandatory security alert's
   * durable record. Only a mandatory event arrives with `false`: a
   * non-mandatory event the policy suppresses is not recorded or streamed.
   *
   * #227 is what acts on it. Until then it is parsed and carried, which is the
   * harmless direction: a field ignored is cheaper than a field the client
   * cannot see when it finally needs it.
   */
  toast: boolean;
  /**
   * Is this same notification ALSO being delivered to this user over Web Push?
   * (#625) SERVER-COMPUTED at publish time: `true` when the event declares the
   * push channel and the user has push subscriptions it will be sent to.
   *
   * Lets a tab with a live push subscription leave the OS bubble to the service
   * worker instead of raising a second one of its own (see `handleNotification`
   * in `contexts/NotificationContext.tsx`). It is a hint about delivery, never
   * about the row, and it never affects the bell or the unread count.
   *
   * OPTIONAL, and a missing value means `false`: an older server does not send
   * it, and "not pushed" is the safe reading — the page keeps its own toast.
   */
  pushed?: boolean;
};

/**
 * `GET /api/notifications/config` — this deployment's client-facing
 * notification capabilities (#226, epic #215). Field for field the API's
 * `notificationConfigSchema` (`apps/api/src/notifications/dto/notification-config.dto.ts`),
 * which carries the full argument for why this is its own narrow, unauthenticated-
 * by-permission endpoint rather than a widening of `system_settings:read` — cited
 * here rather than re-derived: a viewer holds no `system_settings:read`, so this
 * is the one place that lets a non-admin learn the toggle without exposing the
 * whole settings blob.
  *
  * @stability experimental
 */
export interface NotificationConfigResponse {
  /**
   * May this client raise browser notifications at all? THE PERMISSION-PROMPT
   * GATE — see the DTO's own doc comment. `false` stops browser delivery of
   * NON-MANDATORY events outright: no row is written, so they never reach the
   * notification centre. MANDATORY events are still written and still reach
   * the centre; only their OS bubble is withheld. Email is unaffected.
   * Consumed by #227 as `useNotificationCapability`'s `adminDisabled` input
   * (`!browserEnabled`).
   */
  browserEnabled: boolean;
  /**
   * May this client subscribe to Web Push? `true` once an administrator has
   * generated and enabled a VAPID key pair (#355). Drives the boot-time
   * subscription sync (`hooks/usePushSubscriptionSync.ts`, #365) and the
   * settings page's push column.
   */
  pushEnabled: boolean;
  /**
   * The VAPID application server key (URL-safe base64) for
   * `pushManager.subscribe`, or `null` when push is unavailable. Changes when
   * the key pair is rotated, which is how the sync detects a stale
   * subscription.
   */
  vapidPublicKey: string | null;
}

/**
 * `POST /api/notifications/push/subscriptions` body — exactly the browser's
 * `PushSubscription.toJSON()` shape, so the client passes it through unmodified
 * (#229, wired by #365).
  *
  * @stability experimental
 */
export interface PushSubscriptionPayload {
  /** The push service endpoint. */
  endpoint: string;
  /** When the browser says it expires (epoch ms), or null. */
  expirationTime?: number | null;
  /** The subscription's keys. */
  keys: {
    /** The client's P-256 public key. */
    p256dh: string;
    /** The client's auth secret. */
    auth: string;
  };
}

/**
 * `POST /api/notifications/push/subscriptions` response.
 *
 * @stability experimental
 */
export interface PushSubscriptionResponse {
  /** The subscription id. */
  id: string;
  /** The registered endpoint. */
  endpoint: string;
  /** Creation time (ISO 8601). */
  createdAt: string;
}


/**
 * The deployment-wide notification policy (`system_settings.notifications`,
 * #225), as the admin Notifications page edits it. The organization layer
 * (#738) has the same shape and can only tighten it.
 *
 * @stability experimental
 */
export interface SystemNotificationSettings {
  /** The whole browser channel, for everyone. */
  browserEnabled: boolean;
  /**
   * Event keys whose OS notification is suppressed for everyone. A plain
   * `string[]`: a key this build has never heard of may still legitimately be
   * suppressed, so the page leaves unknown stored keys alone.
   */
  disabledEvents: string[];
}

/**
 * The least of the system settings document the admin Notifications page
 * reads: the `notifications` block, the audit line and the row version. An
 * app's own document type (with its other namespaces) is assignable to it.
 *
 * @stability experimental
 */
export interface NotificationsSystemSettingsDocument {
  /** The notification policy. */
  notifications: SystemNotificationSettings;
  /** Last update (ISO 8601). */
  updatedAt: string;
  /** Who saved it last, or null. */
  updatedBy: {
    /** Their user id. */
    id: string;
    /** Their address. */
    email: string;
  } | null;
  /** The row version, sent back as `If-Match`. */
  version: number;
}

/**
 * The least of the user settings document the user Notifications page reads:
 * the stored preferences (absent until the user changes one) and the fields
 * the settings hook needs.
 *
 * @stability experimental
 */
export interface NotificationsUserSettingsDocument {
  /** The theme preference (unused by the page; the hook's document shape). */
  theme: 'light' | 'dark' | 'system';
  /** The profile preferences (unused by the page). */
  profile: unknown;
  /** The stored notification preferences; absent is the normal case. */
  notifications?: NotificationPreferences;
  /** Last update (ISO 8601). */
  updatedAt: string;
  /** The row version. */
  version: number;
}

/**
 * The `PATCH /user-settings` body the user Notifications page sends: the
 * notification preferences, JSON Merge Patch (`null` deletes).
 *
 * @stability experimental
 */
export interface NotificationsUserSettingsUpdate {
  /** The preferences patch, or null to clear the namespace. */
  notifications?: NotificationPreferencesPatch | null;
}
