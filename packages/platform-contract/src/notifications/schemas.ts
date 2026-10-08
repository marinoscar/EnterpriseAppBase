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
} from './constants.js';

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
 * One channel's preferences: event key -> the user's explicit choice.
 * `boolean` only; an absent key means "use the event's default".
 *
 * @stability stable
 */
export const notificationChannelPreferencesSchema = z.record(notificationEventKeySchema, z.boolean());

/**
 * The `notifications` user settings namespace: channel -> that channel's
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
 * PATCH form of the `notifications` namespace. Three levels of delete:
 * `{ notifications: null }` clears the namespace, `{ notifications: { email:
 * null } }` one channel, `{ notifications: { email: { 'k': null } } }` one
 * event. A non-null channel object deep-merges per event.
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
  browserEnabled: z.boolean(),
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
  browserEnabled: z.boolean().optional(),
  disabledEvents: z.array(notificationEventKeySchema).max(MAX_DISABLED_NOTIFICATION_EVENTS).optional(),
});

/**
 * The `notifications` block of the `PUT /api/system-settings` body.
 *
 * @stability stable
 */
export const notificationsSettingsSchema = z.object({
  browserEnabled: z.boolean(),
  disabledEvents: z.array(notificationEventKeySchema).max(MAX_DISABLED_NOTIFICATION_EVENTS),
});

/**
 * The `notifications` block of the `PATCH /api/system-settings` body.
 *
 * @stability stable
 */
export const notificationsSettingsPatchSchema = z.object({
  browserEnabled: z.boolean().optional(),
  disabledEvents: z.array(notificationEventKeySchema).max(MAX_DISABLED_NOTIFICATION_EVENTS).optional(),
});

/**
 * The `notifications` block of the system settings response.
 *
 * @stability stable
 */
export const notificationsResponseSchema = z.object({
  browserEnabled: z.boolean(),
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
 * @stability experimental
 */
export const orgNotificationsSchema = z.object({
  browserEnabled: z.boolean().optional(),
  disabledEvents: z.array(notificationEventKeySchema).max(MAX_DISABLED_NOTIFICATION_EVENTS).optional(),
});

/**
 * An organization's stored `notifications` overrides.
 *
 * @stability experimental
 */
export type OrgNotificationsValue = z.infer<typeof orgNotificationsSchema>;

// ---- /api/notifications --------------------------------------------------------------

/**
 * One event as `GET /api/notifications/events` serves it: `channels` is
 * capability narrowed by the policy in force (what the preferences matrix may
 * offer), `declaredChannels` the registry's capability unfiltered.
 *
 * @stability stable
 */
export const notificationEventSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  channels: z.array(notificationChannelIdSchema),
  declaredChannels: z.array(notificationChannelIdSchema),
  defaultEnabled: z.boolean(),
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
  browserEnabled: z.boolean(),
  pushEnabled: z.boolean(),
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
  id: z.uuid(),
  eventKey: z.string(),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  readAt: z.iso.datetime().nullable(),
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
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  unreadOnly: z
    .enum(['true', 'false'])
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
  id: z.string(),
  eventKey: z.string(),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  createdAt: z.string(),
  toast: z.boolean(),
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
  endpoint: z.string().min(1),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  expirationTime: z.number().nullable().optional(),
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
  id: z.uuid(),
  endpoint: z.string(),
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
  enabled: z.boolean(),
  publicKey: z.string().min(1).nullable(),
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
  enabled: z.boolean(),
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
  confirmation: z.literal(ROTATE_CONFIRMATION),
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
  configured: z.boolean(),
  hint: z.string().nullable(),
  updatedAt: z.iso.datetime().nullable(),
  updatedByUserId: z.uuid().nullable(),
});

/**
 * The admin view of the Web Push configuration.
 *
 * @stability stable
 */
export const pushConfigResponseSchema = pushConfigSchema.extend({
  configured: z.boolean(),
  privateKeyStatus: privateKeyStatusSchema,
  settingsError: z.string().nullable(),
  version: z.number().int(),
  updatedAt: z.iso.datetime().nullable(),
  updatedBy: z
    .object({
      id: z.uuid(),
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
    endpoint: z.url().max(2048).optional(),
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
  source: z.enum(PUSH_TEST_CONFIG_SOURCES),
  enabled: z.boolean().nullable(),
  active: z.boolean(),
  publicKey: z.string().nullable(),
  publicKeyValid: z.boolean(),
  privateKeyMatchesPublicKey: z.boolean().nullable(),
  subject: z.string().nullable(),
  subjectValid: z.boolean(),
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
  endpointProvided: z.boolean(),
  endpointRegistered: z.boolean().nullable(),
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
  eventKey: z.string(),
  label: z.string(),
  mandatory: z.boolean(),
  policyAllows: z.boolean(),
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
  status: z.enum(PUSH_TEST_SEND_STATUSES),
  statusCode: z.number().int().nullable(),
  message: z.string().nullable(),
  responseBody: z.string().nullable(),
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
  id: z.string(),
  pushService: z.string(),
  endpointPreview: z.string(),
  isThisBrowser: z.boolean(),
  userAgent: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastSuccessAt: z.iso.datetime().nullable(),
  failureCount: z.number().int(),
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
  ranAt: z.iso.datetime(),
  durationMs: z.number(),
  overall: z.enum(PUSH_TEST_OVERALL),
  testId: z.string(),
  config: pushTestConfigDiagnosticsSchema,
  browser: pushTestBrowserDiagnosticsSchema,
  events: z.array(pushTestEventDiagnosticsSchema),
  subscriptions: z.array(pushTestSubscriptionResultSchema),
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
 * @stability stable
 */
export const createBroadcastSchema = z
  .object({
    title: z.string().trim().min(1, 'title must not be empty').max(BROADCAST_TITLE_MAX),
    body: z.string().trim().min(1, 'body must not be empty').max(BROADCAST_BODY_MAX),
    link: rootRelativeLink.optional(),
    ctaLabel: z.string().trim().min(1).max(BROADCAST_CTA_LABEL_MAX).optional(),
    channels: z
      .array(notificationChannelIdSchema)
      .min(1, 'select at least one channel')
      .refine((value) => new Set(value).size === value.length, {
        message: 'channels must not contain duplicates',
      }),
    scheduledFor: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value))
      .refine((value) => value.getTime() > Date.now(), {
        message: 'scheduledFor must be in the future',
      })
      .optional(),
    critical: z.boolean().default(false),
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
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  ctaLabel: z.string().nullable(),
  eventKey: z.string(),
  channels: z.array(z.string()),
  status: z.enum(BROADCAST_STATUSES),
  scheduledFor: z.iso.datetime().nullable(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  canceledAt: z.iso.datetime().nullable(),
  audienceCutoff: z.iso.datetime().nullable(),
  recipientsTargeted: z.number().int().nullable(),
  recipientsDispatched: z.number().int(),
  lastError: z.string().nullable(),
  createdById: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
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
  channel: z.string(),
  status: z.string(),
  count: z.number().int(),
});

/**
 * A broadcast with its approximate delivery counts.
 *
 * @stability stable
 */
export const broadcastDetailSchema = broadcastSchema.extend({
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
  broadcast: broadcastSchema,
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
  eventKey: z.string(),
  channels: z.array(z.string()),
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
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(BROADCAST_STATUSES).optional(),
});

/**
 * The parsed list query.
 *
 * @stability stable
 */
export type BroadcastListQuery = z.output<typeof broadcastListQuerySchema>;

// ---- compile-time proofs: no secret crosses this contract ------------------------------

type SecretFieldNames =
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

type NoSecretIn<T> = Extract<keyof T, SecretFieldNames> extends never ? true : never;

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
