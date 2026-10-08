// =============================================================================
// Notifications: plain values of the notifications wire contract (issue #738,
// PP-8.5; shapes from #121, #126, #225, #229, #355, #366, #618)
// =============================================================================
//
// Zod-free, so a consumer that needs only a bound, a pattern or an enum (the
// web app, the service worker) never bundles schemas.ts or zod. Moved from the
// API slice's dto files and the app's settings schemas; the API re-exports
// them.
//
// CHANNEL IDS ARE OPEN. Since #738 no list of channels is part of the wire
// contract: a channel is any id matching NOTIFICATION_CHANNEL_ID_PATTERN, and
// the API checks it against its channel registry at run time. An app adds a
// channel without editing a package file; a preference stored for a channel
// that is later unregistered survives (a row outlives the registry that
// produced it).
// =============================================================================

/**
 * What every channel id looks like: lower-case letters, digits and `_`,
 * starting with a letter (`email`, `browser`, `push`, `android_app`).
 * Persisted in preferences and delivery rows: a channel id is never renamed.
 *
 * @stability stable
 */
export const NOTIFICATION_CHANNEL_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * The longest channel id the wire accepts.
 *
 * @stability stable
 */
export const NOTIFICATION_CHANNEL_ID_MAX_LENGTH = 32;

/**
 * The most channel keys one user's `notifications` preferences may hold. A
 * bound on abuse (the channel level is an open map the user writes), far above
 * any real registry.
 *
 * @stability stable
 */
export const NOTIFICATION_MAX_CHANNELS = 16;

/**
 * The three channels the platform itself registers, in registration order.
 * Informational: the registry, not this list, decides which channels exist.
 *
 * @stability stable
 */
export const PLATFORM_NOTIFICATION_CHANNEL_IDS = ['email', 'browser', 'push'] as const;

/**
 * A channel the platform registers.
 *
 * @stability stable
 */
export type PlatformNotificationChannelId = (typeof PLATFORM_NOTIFICATION_CHANNEL_IDS)[number];

/**
 * Maximum number of event preferences one user may persist PER CHANNEL. A
 * bound on abuse, not a product limit; checked against the MERGED value.
 *
 * @stability stable
 */
export const NOTIFICATION_MAX_EVENTS_PER_CHANNEL = 100;

/**
 * Maximum length of a persisted event key.
 *
 * @stability stable
 */
export const NOTIFICATION_MAX_EVENT_KEY_LENGTH = 64;

/**
 * Allowed shape of an event key in stored preferences and in
 * `disabledEvents`: a syntactic bound, deliberately at least as permissive as
 * the registry's own `<area>.<event>` convention, so a preference for a real
 * event is never unwritable.
 *
 * @stability stable
 */
export const NOTIFICATION_EVENT_KEY_PATTERN = /^[a-z0-9][a-z0-9_.-]*$/;

/**
 * Upper bound on `notifications.disabledEvents` (system and org layer): the
 * same ceiling as the per-channel preferences, since both lists are keyed by
 * the same registry.
 *
 * @stability stable
 */
export const MAX_DISABLED_NOTIFICATION_EVENTS = NOTIFICATION_MAX_EVENTS_PER_CHANNEL;

/**
 * The SSE event name `GET /api/notifications/stream` uses for a new
 * notification (heartbeats are comments).
 *
 * @stability stable
 */
export const NOTIFICATION_SSE_EVENT = 'notification';

/**
 * The generic VAPID subject a delivery falls back to when none is configured.
 *
 * @stability stable
 */
export const DEFAULT_VAPID_SUBJECT = 'mailto:admin@example.com';

/**
 * The literal `POST /api/admin/push-config/rotate` requires in `confirmation`.
 *
 * @stability stable
 */
export const ROTATE_CONFIRMATION = 'ROTATE';

/**
 * The literal `DELETE /api/admin/push-config` requires in `confirmation`.
 *
 * @stability stable
 */
export const REMOVE_CONFIRMATION = 'REMOVE';

/**
 * The overall verdicts of a push test.
 *
 * @stability stable
 */
export const PUSH_TEST_OVERALL = ['sent', 'partial', 'failed', 'not_configured', 'no_subscriptions'] as const;

/**
 * One push test verdict.
 *
 * @stability stable
 */
export type PushTestOverall = (typeof PUSH_TEST_OVERALL)[number];

/**
 * Where a push test read its configuration from.
 *
 * @stability stable
 */
export const PUSH_TEST_CONFIG_SOURCES = ['admin', 'none'] as const;

/**
 * One push test configuration source.
 *
 * @stability stable
 */
export type PushTestConfigSource = (typeof PUSH_TEST_CONFIG_SOURCES)[number];

/**
 * The outcome of one test send to one subscription.
 *
 * @stability stable
 */
export const PUSH_TEST_SEND_STATUSES = ['sent', 'failed', 'pruned', 'skipped'] as const;

/**
 * One test send outcome.
 *
 * @stability stable
 */
export type PushTestSendStatus = (typeof PUSH_TEST_SEND_STATUSES)[number];

/**
 * The six broadcast lifecycle statuses (`NotificationBroadcastStatus`).
 *
 * @stability stable
 */
export const BROADCAST_STATUSES = ['draft', 'scheduled', 'sending', 'sent', 'canceled', 'failed'] as const;

/**
 * One broadcast status.
 *
 * @stability stable
 */
export type BroadcastStatusName = (typeof BROADCAST_STATUSES)[number];

/**
 * The longest broadcast title.
 *
 * @stability stable
 */
export const BROADCAST_TITLE_MAX = 120;

/**
 * The longest broadcast body.
 *
 * @stability stable
 */
export const BROADCAST_BODY_MAX = 2_000;

/**
 * The longest email call-to-action label.
 *
 * @stability stable
 */
export const BROADCAST_CTA_LABEL_MAX = 40;

/**
 * The longest broadcast link.
 *
 * @stability stable
 */
export const BROADCAST_LINK_MAX = 500;
