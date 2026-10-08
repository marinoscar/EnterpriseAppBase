// =============================================================================
// Notifications: the wire contract of `/api/notifications`, the
// `notifications` settings namespaces, `/api/admin/push-config` and
// `/api/admin/broadcasts` (issue #738, PP-8.5; shapes from #121 to #618)
// =============================================================================
//
// The API slice (`@marinoscar/platform-api/notifications`) wraps each with
// `createZodDto` (and, for a request body naming channels, refines the open
// channel ids against its registry at run time); the web slice reads the
// inferred types. Moved from the API slice's dto files and the reference
// app's settings schemas with their meaning unchanged, except one thing:
// CHANNEL IDS ARE OPEN (`notificationChannelIdSchema`), so an app's channel
// needs no edit here and a preference for an unregistered channel is stored,
// not rejected or dropped.
//
// NO SECRET CROSSES THIS CONTRACT. The VAPID private key lives in the
// encrypted credential store and is never part of a stored value or a
// response; the compile-time proofs at the bottom fail the build the moment a
// secret-named field is added.
// =============================================================================

import { z } from 'zod';

import {
  BROADCAST_BODY_MAX,
  BROADCAST_CTA_LABEL_MAX,
  BROADCAST_LINK_MAX,
  BROADCAST_STATUSES,
  BROADCAST_TITLE_MAX,
  MAX_DISABLED_NOTIFICATION_EVENTS,
  NOTIFICATION_CHANNEL_ID_MAX_LENGTH,
  NOTIFICATION_CHANNEL_ID_PATTERN,
  NOTIFICATION_EVENT_KEY_PATTERN,
  NOTIFICATION_MAX_EVENT_KEY_LENGTH,
  PUSH_TEST_CONFIG_SOURCES,
  PUSH_TEST_OVERALL,
  PUSH_TEST_SEND_STATUSES,
  REMOVE_CONFIRMATION,
  ROTATE_CONFIRMATION,
  PUSH_SUBSCRIPTION_PLATFORMS,
} from './constants.js';
import type { BroadcastStatusName, PushTestConfigSource, PushTestOverall, PushTestSendStatus } from './constants.js';

// ---- keys ---------------------------------------------------------------------------

/**
 * A channel id: any id matching `NOTIFICATION_CHANNEL_ID_PATTERN`. Open: the
 * API checks membership in its channel registry where it matters (a request
 * that writes a NEW preference or names a broadcast channel), never on a
 * stored value.
 *
 * @stability stable
 */
export const notificationChannelIdSchema = z
  .string()
  .min(1)
  .max(NOTIFICATION_CHANNEL_ID_MAX_LENGTH)
  .regex(NOTIFICATION_CHANNEL_ID_PATTERN);

/**
 * An event key as a stored preference or a `disabledEvents` entry: a
 * syntactic bound, NOT a registry check (an entry naming an event this build
 * does not declare is stored and simply never matches).
 *
 * @stability stable
 */
export const notificationEventKeySchema = z
  .string()
  .min(1)
  .max(NOTIFICATION_MAX_EVENT_KEY_LENGTH)
  .regex(NOTIFICATION_EVENT_KEY_PATTERN);

// ---- user settings: `notifications` ----------------------------------------------------

/**
 * One channel's preferences: event key to the user's explicit choice.
 * `boolean` only; an absent key means "use the event's default".
 *
 * @stability stable
 */
export const notificationChannelPreferencesSchema = z.record(notificationEventKeySchema, z.boolean());

/**
 * The `notifications` user settings namespace: channel to that channel's
 * preferences, sparse at every level. Keyed by an OPEN channel id; the count
 * of channels and of events per channel is bounded on the merged value by the
 * API (`NOTIFICATION_MAX_CHANNELS`, `NOTIFICATION_MAX_EVENTS_PER_CHANNEL`).
 *
 * @stability stable
 */
export const notificationsSchema = z.record(notificationChannelIdSchema, notificationChannelPreferencesSchema);

/**
 * PATCH form of one channel's preferences: `null` deletes one event key,
 * restoring the default.
 *
 * @stability stable
 */
export const notificationChannelPreferencesPatchSchema = z.record(notificationEventKeySchema, z.boolean().nullable());

/**
 * PATCH form of the `notifications` namespace. Three levels of delete: a
 * `null` namespace clears it, a `null` channel (`email: null`) clears one
 * channel, a `null` event key clears one event. A non-null channel object
 * deep-merges per event.
 *
 * @stability stable
 */
export const notificationsPatchSchema = z.record(
  notificationChannelIdSchema,
  notificationChannelPreferencesPatchSchema.nullable(),
);

/**
 * A stored `notifications` value.
 *
 * @stability stable
 */
export type NotificationsValue = z.infer<typeof notificationsSchema>;

/**
 * One channel's stored preferences.
 *
 * @stability stable
 */
export type NotificationChannelPreferencesValue = z.infer<typeof notificationChannelPreferencesSchema>;

/**
 * A `notifications` PATCH branch.
 *
 * @stability stable
 */
export type NotificationsPatchValue = z.infer<typeof notificationsPatchSchema>;

// ---- system settings: `notifications` --------------------------------------------------

/**
 * The deployment-wide browser-notification policy (`system_settings`
 * `notifications`): whether the browser channel is on, and which events are
 * suppressed for everyone. A `mandatory` event's inbox row survives both.
 *
 * @stability stable
 */
export const systemNotificationsSchema = z.object({
  /** Whether the browser channel is on. */
  browserEnabled: z.boolean(),
  /** Event keys whose browser delivery is suppressed. */
  disabledEvents: z.array(notificationEventKeySchema).max(MAX_DISABLED_NOTIFICATION_EVENTS),
});

/**
 * The stored system policy.
 *
 * @stability stable
 */
export type SystemNotificationsValue = z.infer<typeof systemNotificationsSchema>;

/**
 * PATCH counterpart: `disabledEvents` REPLACES wholesale (RFC 7396's rule for
 * arrays: a merge could never re-enable an event).
 *
 * @stability stable
 */
export const systemNotificationsPatchSchema = z.object({
  /** Whether the browser channel is on. */
  browserEnabled: z.boolean().optional(),
  /** Event keys whose browser delivery is suppressed. */
  disabledEvents: z.array(notificationEventKeySchema).max(MAX_DISABLED_NOTIFICATION_EVENTS).optional(),
});

/**
 * The `notifications` block of the `PUT /api/system-settings` body.
 *
 * @stability stable
 */
export const notificationsSettingsSchema = z.object({
  /** Whether the browser channel is on. */
  browserEnabled: z.boolean(),
  /** Event keys whose browser delivery is suppressed. */
  disabledEvents: z.array(notificationEventKeySchema).max(MAX_DISABLED_NOTIFICATION_EVENTS),
});

/**
 * The `notifications` block of the `PATCH /api/system-settings` body.
 *
 * @stability stable
 */
export const notificationsSettingsPatchSchema = z.object({
  /** Whether the browser channel is on. */
  browserEnabled: z.boolean().optional(),
  /** Event keys whose browser delivery is suppressed. */
  disabledEvents: z.array(notificationEventKeySchema).max(MAX_DISABLED_NOTIFICATION_EVENTS).optional(),
});

/**
 * The `notifications` block of the system settings response.
 *
 * @stability stable
 */
export const notificationsResponseSchema = z.object({
  /** Whether the browser channel is on. */
  browserEnabled: z.boolean(),
  /** Event keys whose browser delivery is suppressed. */
  disabledEvents: z.array(z.string()),
});

/**
 * The ORG LAYER of the `notifications` namespace (#738, through #733's
 * `/api/org-settings`): what one organization may set for its own members. It
 * may only TIGHTEN: `browserEnabled: false` turns browser delivery off for
 * the org (the effective value is system AND org), and `disabledEvents`
 * suppresses more events (the effective list is the union). Every field is
 * optional: an org stores only what it overrides.
 *
 * @extensionPoint schema
 * @stability experimental
 */
export const orgNotificationsSchema = z.object({
  /** Whether the browser channel is on. */
  browserEnabled: z.boolean().optional(),
  /** Event keys whose browser delivery is suppressed. */
  disabledEvents: z.array(notificationEventKeySchema).max(MAX_DISABLED_NOTIFICATION_EVENTS).optional(),
});

/**
 * An organization's stored `notifications` overrides.
 *
 * @stability experimental
 */
export type OrgNotificationsValue = z.infer<typeof orgNotificationsSchema>;

// ---- named enum types (the schemas' types read as a reference) ------------------------

/**
 * The broadcast statuses, as `z.enum` types them: each keyed by itself.
 *
 * @stability stable
 */
export type BroadcastStatusEnum = { [K in BroadcastStatusName]: K };

/**
 * The push test verdicts, as `z.enum` types them.
 *
 * @stability stable
 */
export type PushTestOverallEnum = { [K in PushTestOverall]: K };

/**
 * The push test configuration sources, as `z.enum` types them.
 *
 * @stability stable
 */
export type PushTestConfigSourceEnum = { [K in PushTestConfigSource]: K };

/**
 * The push test send outcomes, as `z.enum` types them.
 *
 * @stability stable
 */
export type PushTestSendStatusEnum = { [K in PushTestSendStatus]: K };

/**
 * A boolean query parameter's two spellings, as `z.enum` types them.
 *
 * @stability stable
 */
export type BooleanQueryEnum = { [K in 'true' | 'false']: K };

const broadcastStatusSchema: z.ZodEnum<BroadcastStatusEnum> = z.enum(BROADCAST_STATUSES);
const pushTestOverallSchema: z.ZodEnum<PushTestOverallEnum> = z.enum(PUSH_TEST_OVERALL);
const pushTestConfigSourceSchema: z.ZodEnum<PushTestConfigSourceEnum> = z.enum(PUSH_TEST_CONFIG_SOURCES);
const pushTestSendStatusSchema: z.ZodEnum<PushTestSendStatusEnum> = z.enum(PUSH_TEST_SEND_STATUSES);
const booleanQuerySchema: z.ZodEnum<BooleanQueryEnum> = z.enum(['true', 'false']);

// ---- /api/notifications --------------------------------------------------------------

/**
 * One event as `GET /api/notifications/events` serves it: `channels` is
 * capability narrowed by the policy in force (what the preferences matrix may
 * offer), `declaredChannels` the registry's capability unfiltered.
 *
 * @stability stable
 */
export const notificationEventSchema = z.object({
  /** The event key, `<area>.<event>`; permanent. */
  key: z.string(),
  /** The user-facing name. */
  label: z.string(),
  /** The user-facing description. */
  description: z.string(),
  /** The channels the preferences matrix may offer: declared, narrowed by the policy in force. */
  channels: z.array(notificationChannelIdSchema),
  /** Every channel the event declares, unfiltered by policy. */
  declaredChannels: z.array(notificationChannelIdSchema),
  /** What an account with no stored preference gets. */
  defaultEnabled: z.boolean(),
  /** Whether a user may not opt out. */
  mandatory: z.boolean(),
});

/**
 * One event on the wire.
 *
 * @stability stable
 */
export type NotificationEventResponse = z.infer<typeof notificationEventSchema>;

/**
 * `GET /api/notifications/config`: what a non-admin client needs to know
 * about the capability (the policy in force for the caller, and Web Push).
 *
 * @stability stable
 */
export const notificationConfigSchema = z.object({
  /** Whether the browser channel is on. */
  browserEnabled: z.boolean(),
  /** Whether Web Push is configured and enabled. */
  pushEnabled: z.boolean(),
  /** The VAPID application server key (URL-safe base64), or null. */
  vapidPublicKey: z.string().nullable(),
});

/**
 * The config response.
 *
 * @stability stable
 */
export type NotificationConfigResponse = z.infer<typeof notificationConfigSchema>;

/**
 * One inbox row.
 *
 * @stability stable
 */
export const notificationSchema = z.object({
  /** The id. */
  id: z.uuid(),
  /** The event key. */
  eventKey: z.string(),
  /** The title. */
  title: z.string(),
  /** The body text. */
  body: z.string(),
  /** A root-relative link, or null. */
  link: z.string().nullable(),
  /** When the user read it (ISO 8601), or null. */
  readAt: z.iso.datetime().nullable(),
  /** Creation time (ISO 8601). */
  createdAt: z.iso.datetime(),
});

/**
 * One inbox row on the wire.
 *
 * @stability stable
 */
export type NotificationResponse = z.infer<typeof notificationSchema>;

/**
 * `GET /api/notifications` query: page, page size, unread only.
 *
 * @stability stable
 */
export const notificationListQuerySchema = z.object({
  /** The page number, from 1. */
  page: z.coerce.number().int().min(1).default(1),
  /** Rows per page (at most 100). */
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  /** `true` for unread rows only. */
  unreadOnly: booleanQuerySchema
    .default('false')
    .transform((value) => value === 'true'),
});

/**
 * The inbox page.
 *
 * @stability stable
 */
export interface NotificationListResponse {
  /** The rows of this page, newest first. */
  items: NotificationResponse[];
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
 * `GET /api/notifications/unread-count`.
 *
 * @stability stable
 */
export const unreadCountSchema = z.object({
  /** Unread notifications. */
  unreadCount: z.number().int().min(0),
});

/**
 * The unread count.
 *
 * @stability stable
 */
export type UnreadCountResponse = z.infer<typeof unreadCountSchema>;

/**
 * One frame of `GET /api/notifications/stream` (`event: notification`).
 * `toast` says whether the tab may show an OS toast (the policy in force),
 * `pushed` whether this dispatch also sent Web Push (so the tab can skip its
 * own toast).
 *
 * @stability stable
 */
export const notificationStreamEventSchema = z.object({
  /** The id. */
  id: z.string(),
  /** The event key. */
  eventKey: z.string(),
  /** The title. */
  title: z.string(),
  /** The body text. */
  body: z.string(),
  /** A root-relative link, or null. */
  link: z.string().nullable(),
  /** Creation time (ISO 8601). */
  createdAt: z.string(),
  /** Whether the tab may raise an OS toast (the policy in force). */
  toast: z.boolean(),
  /** Whether this dispatch also sent Web Push. */
  pushed: z.boolean(),
});

/**
 * One stream frame.
 *
 * @stability stable
 */
export type NotificationStreamEventPayload = z.infer<typeof notificationStreamEventSchema>;

// ---- push subscriptions -----------------------------------------------------------------

/**
 * `POST /api/notifications/push/subscriptions`: a browser's
 * `PushSubscription.toJSON()`.
 *
 * @stability stable
 */
export const pushSubscribeSchema = z.object({
  /** The push service endpoint (a capability URL). */
  endpoint: z.string().min(1),
  /** The subscription's keys. */
  keys: z.object({
    /** The client's P-256 public key. */
    p256dh: z.string().min(1),
    /** The client's auth secret. */
    auth: z.string().min(1),
  }),
  /** When the browser says it expires (epoch ms), or null. */
  expirationTime: z.number().nullable().optional(),
  /**
   * The surface subscribing (#746): `browser` (default) or `android_app` (the
   * Android companion). An `android_app` post re-tags an existing `browser`
   * row of the same endpoint; a `browser` post never downgrades an
   * `android_app` row.
   */
  platform: z.enum(PUSH_SUBSCRIPTION_PLATFORMS).optional(),
});

/**
 * The subscribe body.
 *
 * @stability stable
 */
export type PushSubscribeRequest = z.infer<typeof pushSubscribeSchema>;

/**
 * The subscribe response.
 *
 * @stability stable
 */
export const pushSubscriptionResponseSchema = z.object({
  /** The id. */
  id: z.uuid(),
  /** The registered endpoint. */
  endpoint: z.string(),
  /** The stored platform (#746): what the row is tagged after this call. */
  platform: z.enum(PUSH_SUBSCRIPTION_PLATFORMS),
  /** Creation time (ISO 8601). */
  createdAt: z.iso.datetime(),
});

/**
 * The subscribe response, typed.
 *
 * @stability stable
 */
export type PushSubscriptionResponse = z.infer<typeof pushSubscriptionResponseSchema>;

/**
 * `DELETE /api/notifications/push/subscriptions` body.
 *
 * @stability stable
 */
export const pushUnsubscribeSchema = z.object({
  /** The endpoint to remove. */
  endpoint: z.string().min(1),
});

/**
 * The unsubscribe body.
 *
 * @stability stable
 */
export type PushUnsubscribeRequest = z.infer<typeof pushUnsubscribeSchema>;

// ---- /api/admin/push-config -------------------------------------------------------------

/**
 * A VAPID subject: a `mailto:` address or an `http(s)://` URL.
 *
 * @stability stable
 */
export const vapidSubjectSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => value.startsWith('mailto:') || value.startsWith('https://') || value.startsWith('http://'), {
    message: 'VAPID subject must be a mailto: address or an http(s):// URL',
  });

/**
 * The stored Web Push settings row (`system_settings` key `webPush`). The
 * private key is NOT here: it lives in the credential store.
 *
 * @stability stable
 */
export const pushConfigSchema = z.object({
  /** Whether Web Push is switched on. */
  enabled: z.boolean(),
  /** The VAPID public key, or null. */
  publicKey: z.string().min(1).nullable(),
  /** The VAPID subject (`mailto:` or `https://`), or null for the default. */
  subject: vapidSubjectSchema.nullable(),
});

/**
 * The stored Web Push settings.
 *
 * @stability stable
 */
export type PushConfig = z.infer<typeof pushConfigSchema>;

/**
 * `POST /api/admin/push-config/generate` body.
 *
 * @stability stable
 */
export const generatePushConfigSchema = z.object({
  /** The VAPID subject; absent or null uses the default. */
  subject: vapidSubjectSchema.nullable().optional(),
});

/**
 * The generate body.
 *
 * @stability stable
 */
export type GeneratePushConfigInput = z.infer<typeof generatePushConfigSchema>;

/**
 * `PUT /api/admin/push-config` body (with `If-Match`).
 *
 * @stability stable
 */
export const updatePushConfigSchema = z.object({
  /** Whether Web Push is switched on. */
  enabled: z.boolean(),
  /** The VAPID subject, or null for the default. */
  subject: vapidSubjectSchema.nullable(),
});

/**
 * The update body.
 *
 * @stability stable
 */
export type UpdatePushConfigInput = z.infer<typeof updatePushConfigSchema>;

/**
 * `POST /api/admin/push-config/rotate` body.
 *
 * @stability stable
 */
export const rotatePushConfigSchema = z.object({
  /** The literal confirmation word. */
  confirmation: z.literal(ROTATE_CONFIRMATION),
  /** A new VAPID subject; absent keeps the current one. */
  subject: vapidSubjectSchema.nullable().optional(),
});

/**
 * The rotate body.
 *
 * @stability stable
 */
export type RotatePushConfigInput = z.infer<typeof rotatePushConfigSchema>;

/**
 * `DELETE /api/admin/push-config` body.
 *
 * @stability stable
 */
export const removePushConfigSchema = z.object({
  /** The literal confirmation word. */
  confirmation: z.literal(REMOVE_CONFIRMATION),
});

/**
 * The remove body.
 *
 * @stability stable
 */
export type RemovePushConfigInput = z.infer<typeof removePushConfigSchema>;

/**
 * The private key's masked status: never the key.
 *
 * @stability stable
 */
export const privateKeyStatusSchema = z.object({
  /** Whether a value is stored. */
  configured: z.boolean(),
  /** A short, non-secret hint of the stored value, or null. */
  hint: z.string().nullable(),
  /** When it was stored (ISO 8601), or null. */
  updatedAt: z.iso.datetime().nullable(),
  /** Who stored it, or null. */
  updatedByUserId: z.uuid().nullable(),
});

/**
 * The admin view of the Web Push configuration.
 *
 * @stability stable
 */
export const pushConfigResponseSchema = pushConfigSchema.extend({
  /** Whether a key pair is stored. */
  configured: z.boolean(),
  /** The VAPID private key's status (never its value). */
  privateKeyStatus: privateKeyStatusSchema,
  /** Why the stored row failed validation, or null. */
  settingsError: z.string().nullable(),
  /** The row version, sent back as `If-Match`. */
  version: z.number().int(),
  /** Last update (ISO 8601), or null. */
  updatedAt: z.iso.datetime().nullable(),
  /** Who saved last, or null. */
  updatedBy: z
    .object({
      /** The id. */
      id: z.uuid(),
      /** Their address. */
      email: z.email(),
    })
    .nullable(),
});

/**
 * The admin view, typed.
 *
 * @stability stable
 */
export type PushConfigResponse = z.infer<typeof pushConfigResponseSchema>;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/;

/**
 * `POST /api/admin/push-config/test` body: optionally this browser's endpoint
 * and the server key it subscribed with, to diagnose the pair.
 *
 * @stability stable
 */
export const pushTestRequestSchema = z
  .object({
    /** This browser's endpoint, to check it is registered. */
    endpoint: z.url().max(2048).optional(),
    /** This browser's subscription key (base64url), to compare with the server's. */
    applicationServerKey: z
      .string()
      .max(200)
      .regex(BASE64URL_PATTERN, 'applicationServerKey must be base64url-encoded')
      .optional(),
  })
  .strict();

/**
 * The test body.
 *
 * @stability stable
 */
export type PushTestRequest = z.infer<typeof pushTestRequestSchema>;

/**
 * The push test's verdicts on the active configuration.
 *
 * @stability stable
 */
export const pushTestConfigDiagnosticsSchema = z.object({
  /** Where the configuration was read from. */
  source: pushTestConfigSourceSchema,
  /** The stored switch, or null without a configuration. */
  enabled: z.boolean().nullable(),
  /** Whether push would send right now. */
  active: z.boolean(),
  /** The public key in force, or null. */
  publicKey: z.string().nullable(),
  /** Whether the public key is a valid P-256 point. */
  publicKeyValid: z.boolean(),
  /** Whether the stored private key matches the public key, or null when either is missing. */
  privateKeyMatchesPublicKey: z.boolean().nullable(),
  /** The subject in force, or null. */
  subject: z.string().nullable(),
  /** Whether the subject is a valid `mailto:` or `http(s)` URL. */
  subjectValid: z.boolean(),
  /** What is wrong, in words. */
  problems: z.array(z.string()),
});

/**
 * Configuration verdicts, typed.
 *
 * @stability stable
 */
export type PushTestConfigDiagnostics = z.infer<typeof pushTestConfigDiagnosticsSchema>;

/**
 * The push test's verdicts on the calling browser.
 *
 * @stability stable
 */
export const pushTestBrowserDiagnosticsSchema = z.object({
  /** Whether the caller sent its own endpoint. */
  endpointProvided: z.boolean(),
  /** Whether that endpoint is registered for the caller, or null. */
  endpointRegistered: z.boolean().nullable(),
  /** Whether this browser's key matches the server's, or null. */
  keyMatchesServer: z.boolean().nullable(),
});

/**
 * Browser verdicts, typed.
 *
 * @stability stable
 */
export type PushTestBrowserDiagnostics = z.infer<typeof pushTestBrowserDiagnosticsSchema>;

/**
 * Whether each push-capable event would reach the caller.
 *
 * @stability stable
 */
export const pushTestEventDiagnosticsSchema = z.object({
  /** The event key. */
  eventKey: z.string(),
  /** The user-facing name. */
  label: z.string(),
  /** Whether a user may not opt out. */
  mandatory: z.boolean(),
  /** Whether the deployment policy allows push for it. */
  policyAllows: z.boolean(),
  /** Whether the caller's preference allows push for it. */
  preferenceAllows: z.boolean(),
});

/**
 * Event verdicts, typed.
 *
 * @stability stable
 */
export type PushTestEventDiagnostics = z.infer<typeof pushTestEventDiagnosticsSchema>;

/**
 * One test send's result.
 *
 * @stability stable
 */
export const pushTestSendResultSchema = z.object({
  /** How the send ended. */
  status: pushTestSendStatusSchema,
  /** The push service's HTTP status, or null. */
  statusCode: z.number().int().nullable(),
  /** A short explanation, or null. */
  message: z.string().nullable(),
  /** The push service's response body (capped), or null. */
  responseBody: z.string().nullable(),
  /** How long it took, in milliseconds. */
  durationMs: z.number(),
});

/**
 * One send result, typed.
 *
 * @stability stable
 */
export type PushTestSendResult = z.infer<typeof pushTestSendResultSchema>;

/**
 * One of the caller's subscriptions and its test send. The endpoint appears
 * only as a preview and its push service host.
 *
 * @stability stable
 */
export const pushTestSubscriptionResultSchema = z.object({
  /** The subscription id. */
  id: z.string(),
  /** The push service's host. */
  pushService: z.string(),
  /** A shortened, non-capability form of the endpoint. */
  endpointPreview: z.string(),
  /** Whether it is the calling browser's subscription. */
  isThisBrowser: z.boolean(),
  /** The subscribing browser, or null. */
  userAgent: z.string().nullable(),
  /** When it subscribed (ISO 8601). */
  createdAt: z.iso.datetime(),
  /** The last successful delivery (ISO 8601), or null. */
  lastSuccessAt: z.iso.datetime().nullable(),
  /** Consecutive delivery failures. */
  failureCount: z.number().int(),
  /** The test send to it. */
  result: pushTestSendResultSchema,
});

/**
 * One subscription result, typed.
 *
 * @stability stable
 */
export type PushTestSubscriptionResult = z.infer<typeof pushTestSubscriptionResultSchema>;

/**
 * `POST /api/admin/push-config/test` response.
 *
 * @stability stable
 */
export const pushTestResponseSchema = z.object({
  /** When the test ran (ISO 8601). */
  ranAt: z.iso.datetime(),
  /** How long the whole test took, in milliseconds. */
  durationMs: z.number(),
  /** The verdict. */
  overall: pushTestOverallSchema,
  /** The id the service worker acknowledges. */
  testId: z.string(),
  /** The configuration diagnostics. */
  config: pushTestConfigDiagnosticsSchema,
  /** The calling browser's diagnostics. */
  browser: pushTestBrowserDiagnosticsSchema,
  /** The events that may push, and whether each would. */
  events: z.array(pushTestEventDiagnosticsSchema),
  /** The caller's subscriptions and each one's send result. */
  subscriptions: z.array(pushTestSubscriptionResultSchema),
  /** What to do next, in words. */
  hints: z.array(z.string()),
});

/**
 * The test response, typed.
 *
 * @stability stable
 */
export type PushTestResponse = z.infer<typeof pushTestResponseSchema>;

// ---- /api/admin/broadcasts --------------------------------------------------------------

const FORBIDDEN_LINK_CHARS = /[\u0000- \u007F]/;

const rootRelativeLink = z
  .string()
  .trim()
  .min(1, 'link must not be empty')
  .max(BROADCAST_LINK_MAX)
  .refine((value) => !FORBIDDEN_LINK_CHARS.test(value), {
    message: 'link must not contain spaces or control characters',
  })
  .refine((value) => value.startsWith('/'), {
    message: 'link must be root-relative and start with "/"',
  })
  .refine((value) => !value.startsWith('//'), {
    message: 'link must not be protocol-relative ("//…")',
  })
  .refine((value) => !value.startsWith('/\\'), {
    message: 'link must not start with "/\\"',
  });

/**
 * `POST /api/admin/broadcasts` (and `/test`) body. `channels` are open ids
 * (the API refuses an unregistered one); `targetOrgId` (#738) addresses one
 * organization's active members instead of every active user, and only a
 * system `broadcasts:write` holder may name one (an `org_broadcasts:write`
 * holder's target is forced to their active organization).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const createBroadcastSchema = z
  .object({
    /** The title. */
    title: z.string().trim().min(1, 'title must not be empty').max(BROADCAST_TITLE_MAX),
    /** The body text. */
    body: z.string().trim().min(1, 'body must not be empty').max(BROADCAST_BODY_MAX),
    /** A root-relative link (`/...`; never `//` or another origin). */
    link: rootRelativeLink.optional(),
    /** The email call-to-action label; needs `link`. */
    ctaLabel: z.string().trim().min(1).max(BROADCAST_CTA_LABEL_MAX).optional(),
    /** The channels (open channel ids). */
    channels: z
      .array(notificationChannelIdSchema)
      .min(1, 'select at least one channel')
      .refine((value) => new Set(value).size === value.length, {
        message: 'channels must not contain duplicates',
      }),
    /** When to send (ISO 8601 with offset, in the future); absent sends now. */
    scheduledFor: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value))
      .refine((value) => value.getTime() > Date.now(), {
        message: 'scheduledFor must be in the future',
      })
      .optional(),
    /** A critical broadcast cannot be muted (needs the `browser` channel). */
    critical: z.boolean().default(false),
    /** Target one organization's active members. A system administrator may name any organization or omit it (every active user); an organization administrator's broadcast always targets their active organization. */
    targetOrgId: z.uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.ctaLabel && !value.link) {
      ctx.addIssue({ code: 'custom', path: ['ctaLabel'], message: 'ctaLabel requires link' });
    }
    if (value.critical && !value.channels.includes('browser')) {
      ctx.addIssue({
        code: 'custom',
        path: ['channels'],
        message:
          'a critical broadcast must include the "browser" channel: the durable in-app ' +
          'notification is the only record a recipient can go back and read',
      });
    }
  });

/**
 * The parsed create body (`scheduledFor` is a `Date`).
 *
 * @stability stable
 */
export type CreateBroadcastInput = z.output<typeof createBroadcastSchema>;

/**
 * The create body as a client sends it.
 *
 * @stability stable
 */
export type CreateBroadcastRequest = z.input<typeof createBroadcastSchema>;

/**
 * One broadcast.
 *
 * @stability stable
 */
export const broadcastSchema = z.object({
  /** The id. */
  id: z.uuid(),
  /** The title. */
  title: z.string(),
  /** The body text. */
  body: z.string(),
  /** A root-relative link, or null. */
  link: z.string().nullable(),
  /** The email call-to-action label (needs `link`), or null. */
  ctaLabel: z.string().nullable(),
  /** The event key. */
  eventKey: z.string(),
  /** The channels (open channel ids). */
  channels: z.array(z.string()),
  /** The lifecycle status. */
  status: broadcastStatusSchema,
  /** When it is due (ISO 8601), or null for now. */
  scheduledFor: z.iso.datetime().nullable(),
  /** When the start job froze the audience, or null. */
  startedAt: z.iso.datetime().nullable(),
  /** When it settled, or null. */
  finishedAt: z.iso.datetime().nullable(),
  /** When it was canceled, or null. */
  canceledAt: z.iso.datetime().nullable(),
  /** The frozen audience cutoff, or null before it starts. */
  audienceCutoff: z.iso.datetime().nullable(),
  /** The frozen audience size, or null before it is counted (never 0 for unknown). */
  recipientsTargeted: z.number().int().nullable(),
  /** Recipients dispatched so far. */
  recipientsDispatched: z.number().int(),
  /** The last failure, or null. */
  lastError: z.string().nullable(),
  /** The author, or null once deleted. */
  createdById: z.uuid().nullable(),
  /** Creation time (ISO 8601). */
  createdAt: z.iso.datetime(),
  /** Last update (ISO 8601), or null. */
  updatedAt: z.iso.datetime(),
  /** The organization targeted (its active members only), or null for every active user. */
  targetOrgId: z.uuid().nullable(),
});

/**
 * One broadcast on the wire.
 *
 * @stability stable
 */
export type BroadcastResponse = z.infer<typeof broadcastSchema>;

/**
 * One (channel, status) delivery count of a broadcast.
 *
 * @stability stable
 */
export const broadcastDeliveryCountSchema = z.object({
  /** The channel id. */
  channel: z.string(),
  /** The delivery status. */
  status: z.string(),
  /** Delivery attempts. */
  count: z.number().int(),
});

/**
 * A broadcast with its approximate delivery counts.
 *
 * @stability stable
 */
export const broadcastDetailSchema = broadcastSchema.extend({
  /** Delivery attempts by channel and status, approximate (attributed by event key and time window). */
  approximateDeliveryAttempts: z.array(broadcastDeliveryCountSchema),
});

/**
 * The detail view, typed.
 *
 * @stability stable
 */
export type BroadcastDetailResponse = z.infer<typeof broadcastDetailSchema>;

/**
 * The create result: the row and any warnings (an unconfigured channel).
 *
 * @stability stable
 */
export const broadcastCreateResultSchema = z.object({
  /** The broadcast row. */
  broadcast: broadcastSchema,
  /** Non-fatal warnings to show (for example, browser notifications are off). */
  warnings: z.array(z.string()),
});

/**
 * The create result, typed.
 *
 * @stability stable
 */
export type BroadcastCreateResult = z.infer<typeof broadcastCreateResultSchema>;

/**
 * `GET /api/admin/broadcasts/audience` query (#738): the target to count;
 * absent counts every active user.
 *
 * @stability stable
 */
export const broadcastAudienceQuerySchema = z.object({
  /** Count one organization's active members instead of every active user. */
  targetOrgId: z.uuid().optional(),
});

/**
 * The audience query, typed.
 *
 * @stability stable
 */
export type BroadcastAudienceQuery = z.infer<typeof broadcastAudienceQuerySchema>;

/**
 * The audience size a broadcast sent now would reach.
 *
 * @stability stable
 */
export const broadcastAudienceSchema = z.object({
  /** Active users the broadcast would reach now. */
  activeUsers: z.number().int(),
});

/**
 * The audience, typed.
 *
 * @stability stable
 */
export type BroadcastAudienceResponse = z.infer<typeof broadcastAudienceSchema>;

/**
 * `POST /api/admin/broadcasts/test` result: sent to the caller only.
 *
 * @stability stable
 */
export const broadcastTestResultSchema = z.object({
  /** The event the test raised. */
  eventKey: z.string(),
  /** The channels the test went to. */
  channels: z.array(z.string()),
  /** The caller, the only recipient of a test. */
  sentToUserId: z.uuid(),
});

/**
 * The test result, typed.
 *
 * @stability stable
 */
export type BroadcastTestResult = z.infer<typeof broadcastTestResultSchema>;

/**
 * `GET /api/admin/broadcasts` query.
 *
 * @stability stable
 */
export const broadcastListQuerySchema = z.object({
  /** The page number, from 1. */
  page: z.coerce.number().int().min(1).default(1),
  /** Rows per page (at most 100). */
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  /** Only broadcasts in this status. */
  status: broadcastStatusSchema.optional(),
});

/**
 * The parsed list query.
 *
 * @stability stable
 */
export type BroadcastListQuery = z.output<typeof broadcastListQuerySchema>;

// ---- compile-time proofs: no secret crosses this contract ------------------------------

/**
 * The field names no push response may carry: key material, the subscription
 * keys and the endpoint (a capability URL).
 *
 * @stability stable
 */
export type SecretFieldNames =
  | 'privateKey'
  | 'vapidPrivateKey'
  | 'secret'
  | 'password'
  | 'apiKey'
  | 'ciphertext'
  | 'p256dh'
  | 'auth'
  | 'keys'
  | 'endpoint';

/**
 * `true` when `T` names none of the secret-bearing field names, `never`
 * otherwise: the building block of {@link PushContractCarriesNoSecret}.
 *
 * @stability stable
 */
export type NoSecretIn<T> = Extract<keyof T, SecretFieldNames> extends never ? true : never;

/**
 * Resolves to `true` while neither the stored Web Push settings, the admin
 * view nor the push test response carries a secret-named field; to `never`
 * (a compile error below) the moment one does.
 *
 * @stability stable
 */
export type PushContractCarriesNoSecret = NoSecretIn<PushConfig> &
  NoSecretIn<PushConfigResponse> &
  NoSecretIn<PushTestResponse> &
  NoSecretIn<PushTestConfigDiagnostics> &
  NoSecretIn<PushTestBrowserDiagnostics> &
  NoSecretIn<PushTestSubscriptionResult> &
  NoSecretIn<PushTestSendResult>;

/**
 * The proof, as a value: fails to compile when {@link PushContractCarriesNoSecret} is `never`.
 *
 * @stability stable
 */
export const PUSH_CONTRACT_CARRIES_NO_SECRET: PushContractCarriesNoSecret = true;
