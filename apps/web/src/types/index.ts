// The identity shapes (the signed-in user, the admin lists, device
// activation, personal access tokens, organizations) are defined once, in
// `@marinoscar/platform-web/identity/headless` (#727, PP-6.6); import them
// from there.

export type ProfileImageSource = 'none' | 'provider' | 'upload';

export type DataTableDensity = 'compact' | 'standard' | 'comfortable';

/**
 * Navigation preferences. Every field is optional and an ABSENT field means
 * "use the built-in default" — absence is meaningful, not incidental, so never
 * backfill these with literal defaults when reading settings.
 */
export interface NavigationSettings {
  railCollapsed?: boolean;
}

/**
 * Per-table preferences, keyed by table id. As with navigation, every field is
 * optional and an ABSENT field means "use the built-in default" for that table
 * (an absent `visibleColumns` is not an empty column set).
 */
export interface DataTableSettings {
  visibleColumns?: string[];
  density?: DataTableDensity;
  sort?: { field: string; direction: 'asc' | 'desc' };
  pageSize?: number;
}

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
 */
export type NotificationChannel = 'email' | 'browser' | 'push';

/**
 * One entry of the event registry, as served by `GET /api/notifications/events`.
 *
 * Field for field the API's `notificationEventSchema`. Note `mandatory` is a
 * plain `boolean` here, not `boolean | undefined`: the API normalises it on the
 * way out precisely so no client has to know that absent means "the user is in
 * charge".
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
 */
export type NotificationChannelPreferencesPatch = Record<string, boolean | null>;

/**
 * PATCH form of the `notifications` namespace. Three levels of delete, each
 * meaning something different (see `UserSettingsUpdate`).
 *
 * Unlike `dataTables`, a non-null channel object is DEEP-merged per event
 * rather than replacing the channel wholesale — which is exactly what lets the
 * page send one key per toggle and leave every other preference absent.
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
 */
export interface AppNotification {
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
 */
export interface NotificationListResponse {
  items: AppNotification[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * The badge number.
 *
 * Returned by `GET /api/notifications/unread-count` AND by BOTH mark-read
 * endpoints — which is why marking one read costs a single round trip: the
 * client already holds the row it marked, and the count is the only thing it
 * cannot compute for itself. Do not follow a mark-read with a count fetch.
 */
export interface UnreadCountResponse {
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
 */
export interface PushSubscriptionPayload {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/** `POST /api/notifications/push/subscriptions` response. */
export interface PushSubscriptionResponse {
  id: string;
  endpoint: string;
  createdAt: string;
}

export interface UserSettings {
  theme: 'light' | 'dark' | 'system';
  profile: {
    displayName?: string;
    /**
     * Which picture to show (#367). `'upload'` is only accepted by PATCH once a
     * picture has been uploaded; the upload endpoint sets it itself.
     */
    imageSource: ProfileImageSource;
    /**
     * The uploaded picture's storage object id. Kept when switching to
     * `none`/`provider` so switching back to `upload` works; cleared only by
     * `DELETE /api/user-settings/profile-image`. Set by the server, never PATCHed.
     */
    imageObjectId?: string | null;
  };
  navigation?: NavigationSettings;
  dataTables?: Record<string, DataTableSettings>;
  /**
   * Per-channel, per-event notification preferences (#126, epic #109).
   *
   * OPTIONAL, AND ABSENT IS THE NORMAL CASE — not a loading state and not
   * "notifications off". No account has this key until it deliberately changes
   * a preference, so `settings.notifications ?? {}` resolves every event to its
   * registry default. Never backfill it with a materialised object.
   */
  notifications?: NotificationPreferences;
  /**
   * AI preferences (#430, epic #419). Optional and usually absent: no account
   * has it until the user picks a default model on `/settings/ai`.
   */
  ai?: UserAiSettings;
  updatedAt: string;
  version: number;
}

/** The model a user's AI requests default to — a provider/model pair, never a key. */
export interface AiDefaultModel {
  provider: string;
  modelId: string;
}

/** `user_settings.ai` — `defaultModel: null` means "no default chosen". */
export interface UserAiSettings {
  defaultModel?: AiDefaultModel | null;
}

/**
 * PATCH form of `navigation`: each field may additionally be `null`, meaning
 * "delete this field and fall back to the built-in default".
 */
export type NavigationSettingsPatch = {
  [K in keyof NavigationSettings]?: NavigationSettings[K] | null;
};

/**
 * PATCH form of `dataTables`: the per-table VALUE may be `null` to delete that
 * table's entry. Note the asymmetry with navigation — a non-null entry REPLACES
 * the stored entry wholesale rather than being deep-merged, so its fields are
 * plain optionals and are NOT individually nullable. The server rejects
 * `{ [id]: { sort: null } }`; omit the field or replace the whole entry.
 */
export type DataTablesPatch = Record<string, DataTableSettings | null>;

/**
 * `POST` / `DELETE /api/user-settings/profile-image` response, after the
 * client's `data` unwrap (#367). `settings` carries the new `version`, which
 * the caller MUST adopt or its next `If-Match` PATCH will 409.
 */
export interface ProfileImageMutationResponse {
  settings: UserSettings;
  /** The resolved picture after the change (same meaning as `User.profileImageUrl`). */
  profileImageUrl: string | null;
}

/**
 * Payload accepted by `PATCH /api/user-settings`.
 *
 * This deliberately is NOT `Partial<UserSettings>`: the endpoint uses JSON
 * Merge Patch semantics, where `null` is a DELETE signal rather than a value.
 *   - `{ navigation: null }`                    clears the whole namespace
 *   - `{ navigation: { railCollapsed: null } }` deletes just that field
 *   - `{ dataTables: null }`                    clears the whole namespace
 *   - `{ dataTables: { [id]: null } }`          deletes just that table's entry
 *   - `{ notifications: null }`                 clears the whole namespace
 *   - `{ notifications: { email: null } }`      clears one channel
 *   - `{ notifications: { email: { k: null } }}` deletes ONE event key, restoring
 *                                               the registry default for it
 * Omitting a key leaves the stored value untouched. Server-owned fields
 * (`updatedAt`, `version`) are not patchable and so are absent here.
 */
export interface UserSettingsUpdate {
  theme?: UserSettings['theme'];
  profile?: Partial<UserSettings['profile']>;
  navigation?: NavigationSettingsPatch | null;
  dataTables?: DataTablesPatch | null;
  /**
   * Notification preferences (#126). The channel object is DEEP-merged per
   * event key server-side, which is what allows the preferences page to send
   * exactly the one key it changed and leave every other preference absent.
   */
  notifications?: NotificationPreferencesPatch | null;
  /** AI preferences (#430). `defaultModel: null` clears the saved default. */
  ai?: UserAiSettings;
}

/**
 * Deployment-wide browser-notification policy (#225, epic #215).
 *
 * A MODELLED block on the settings document, mirroring the API's
 * `systemNotificationsSchema`: a typed, validated namespace rather than a
 * shapeless map of flags.
 *
 * NOTHING READS THESE VALUES YET, on either side. Issue #225 adds the setting,
 * its persistence and the admin page at `/admin/settings/notifications`; the
 * enforcement (the browser channel consulting them, and the non-admin read
 * endpoint that lets this app skip asking for OS permission when the capability
 * is off) is issue #226. An editable control with no observable effect is the
 * expected state until then, not a bug.
 */
export interface SystemNotificationSettings {
  /** The whole browser channel, for everyone. */
  browserEnabled: boolean;
  /**
   * `NotificationEventDef` keys whose OS notification is suppressed for
   * everyone, independently of any user's own preference.
   *
   * A plain `string[]` and not a union: the registry is served by the API, so a
   * key this build has never heard of is a key an operator may still legitimately
   * have suppressed — the admin page renders what the registry returns and
   * leaves unknown stored keys alone.
   */
  disabledEvents: string[];
}

export interface SystemSettings {
  notifications: SystemNotificationSettings;
  updatedAt: string;
  updatedBy: { id: string; email: string } | null;
  version: number;
}

// Email settings (issue #124): the types moved with the page into
// `@marinoscar/platform-web/email/headless` (#737).

// =============================================================================
// Maintenance mode — issue #258, epic #254
// =============================================================================
//
// The web mirror of `GET`/`PUT /api/admin/maintenance`
// (`apps/api/src/common/maintenance/dto/update-maintenance.dto.ts`). Mirrored
// rather than shared because there is no cross-package type surface between
// `apps/api` and `apps/web` — `packages/shared` is deliberately plain
// JavaScript constants (see its header) — so this is the same arrangement
// `EmailSettings` and `SystemSettings` above already live under.
//
// The one thing NOT restated here is the marker string and the retry delay:
// those are the wire CONTRACT rather than a shape, and they live beside the
// code that recognises them, in `services/maintenance.ts`.

/** Which of the three layers decided `enabled`. Reported, never inferred. */
export type MaintenanceSource = 'env' | 'memory' | 'persisted';

/**
 * An override held in the API process only (the database restore's swap
 * window). `message` and `allowAdmins` are optional on it because the caller
 * that installs one usually has nothing to say about them.
 */
export interface MaintenanceOverride {
  enabled: boolean;
  message?: string;
  allowAdmins?: boolean;
}

/** The stored `maintenance` namespace of the system settings document. */
export interface MaintenancePolicy {
  enabled: boolean;
  message: string;
  allowAdmins: boolean;
  startedAt: string | null;
  startedById: string | null;
}

/**
 * The effective state, plus every contributing layer, separately.
 *
 * `layers` is the reason the admin page exists as more than a switch: an
 * operator asking "I turned it off and it is still on" needs to be shown that
 * `MAINTENANCE_MODE=true` is in the environment and outranks the row they just
 * wrote. Rendering only `enabled` would make that invisible from the UI in
 * exactly the way it would have been invisible from the API without this block.
 */
export interface MaintenanceStatus extends MaintenancePolicy {
  source: MaintenanceSource;
  layers: {
    /** `enabled: null` means the variable is unset, or set to something that is neither `'true'` nor `'false'`. */
    env: { present: boolean; enabled: boolean | null };
    memory: { present: boolean; override: MaintenanceOverride | null };
    /** `readable: false` means the row could not be read and `value` is the last known state. */
    persisted: { readable: boolean; value: MaintenancePolicy };
  };
}

/**
 * The `PUT` body. `enabled` is the only required field, exactly as in
 * `updateMaintenanceSchema`.
 *
 * `startedAt` / `startedById` are ABSENT on purpose and must stay absent: the
 * API stamps them itself and refuses to take them from a caller, because an
 * audit trail the audited party can dictate is not one.
 */
export interface UpdateMaintenanceInput {
  enabled: boolean;
  message?: string;
  allowAdmins?: boolean;
}

// =============================================================================
// About — what is actually deployed here (issue #401, epic #397)
// =============================================================================
//
// Mirrors `apps/api/src/about/dto/about-response.dto.ts` field for field. Read
// that file's header before changing anything here: the shape is deliberately
// built to carry PARTIAL TRUTH, and the nullability below is the contract
// rather than defensive typing.
//
// ⚠ `GET /api/admin/about` ALWAYS ANSWERS 200. A missing deploy document, a
// malformed one and an unreachable database are all fields, never statuses. So
// nothing in this block should ever be reached through an error path — a `null`
// here is a FACT the page renders, not a failure it hides.

/** The API process's own version. Always known; never read from disk. */
export interface AboutApi {
  version: string;
  /**
   * `DEPLOYMENT_MODE` as the API parsed it at startup (#685). `saas` means
   * in-app database restore is disabled. Optional: an older API omits it.
   */
  deploymentMode?: 'self-hosted' | 'saas';
}

export interface AboutApp {
  name: string | null;
  version: string | null;
  /** The commit actually deployed — the single most useful field on the page. */
  commitSha: string | null;
  /** The branch or tag the deploy was taken from. */
  ref: string | null;
}

export interface AboutDeployedBy {
  /** Which client wrote the document, e.g. `appctl`. */
  cli: string | null;
  version: string | null;
}

/**
 * How far behind the remote this deployment was AT `checkedAt`.
 *
 * ⚠ COPIED FROM THE DOCUMENT, NEVER REFRESHED — the API performs no network
 * I/O for this endpoint at all. The number is as old as `checkedAt` says it is,
 * which is why the page must never render one without the other.
 */
export interface AboutRemote {
  commitsBehind: number | null;
  checkedAt: string | null;
}

/**
 * The deploy run that wrote the document.
 *
 * `outcome: 'failure'` beside a COMPLETE document is the third render state —
 * see `pages/Admin/AboutPage.tsx`. `failedStep` names where it stopped, and
 * `completed` still lists every step that really ran.
 */
export interface AboutRun {
  completed: string[];
  failedStep: string | null;
  outcome: 'success' | 'failure' | null;
}

/** A liveness fact from the same indicator `GET /api/health/ready` uses. */
export interface AboutDatabase {
  status: string;
  responseTime: string;
}

/** Which `appctl deploy` subcommand wrote a record (issue #392). */
export type DeployCommand = 'install' | 'update';

/**
 * The reverse proxy in front of this deployment, as the deploy recorded it
 * (issue #392). Every field may be `null` — an older record, or a value the
 * CLI could not determine.
 */
export interface AboutProxy {
  mode: 'container' | 'host' | null;
  container: string | null;
  /** ISO-8601. When the TLS certificate the proxy serves expires. */
  certificateExpiresAt: string | null;
}

/**
 * The host the deploy ran on, captured AT DEPLOY TIME (issue #392) — not live.
 * `capturedAt` says how old it is.
 */
export interface AboutHost {
  hostname: string | null;
  os: string | null;
  kernel: string | null;
  arch: string | null;
  cpus: number | null;
  memoryBytes: number | null;
  dockerVersion: string | null;
  composeVersion: string | null;
  capturedAt: string | null;
}

/** One successful deploy, newest first, capped at 20 by the writer (issue #392). */
export interface AboutHistoryEntry {
  /** ISO-8601 finish time. */
  at: string;
  command: DeployCommand;
  commitSha: string | null;
  previousCommitSha: string | null;
  ref: string | null;
  durationMs: number | null;
  cliVersion: string | null;
  outcome: 'success';
}

/** Live facts about the API process itself — never read from disk (issue #392). */
export interface AboutRuntime {
  processStartedAt: string | null;
  nodeVersion: string | null;
  environment: string | null;
}

/** `ok` — a document was read. `absent` — nothing there. `invalid` — unusable. */
export type DeployInfoStatus = 'ok' | 'absent' | 'invalid';

export interface AboutResponse {
  api: AboutApi;
  deployInfoStatus: DeployInfoStatus;
  /**
   * The exact path the API read.
   *
   * Always present, INCLUDING on `ok`. On `absent` it is the only actionable
   * fact the response carries, and the reason the copy around it can stay
   * truthful — see the page.
   */
  deployInfoPath: string;
  /** Why the document is `invalid`. `null` for `ok` and for `absent`. */
  deployInfoError: string | null;

  app: AboutApp | null;
  installedAt: string | null;
  updatedAt: string | null;
  deployedBy: AboutDeployedBy | null;
  domain: string | null;
  remote: AboutRemote | null;
  run: AboutRun | null;

  // Issue #392 — additive fields. OPTIONAL as well as nullable: an API or a
  // deploy record older than #392 simply does not carry them, and the page
  // must render exactly as it did before when they are missing.
  lastCommand?: DeployCommand | null;
  bindPort?: number | null;
  proxy?: AboutProxy | null;
  host?: AboutHost | null;
  history?: AboutHistoryEntry[] | null;
  runtime?: AboutRuntime | null;

  /** `null` PLUS `databaseError`, never a 503. A fact to display, not a page error. */
  database: AboutDatabase | null;
  databaseError: string | null;
}

/** `GET /api/storage/status`: whether object storage is configured. Never provider details. */
export interface StorageStatus {
  configured: boolean;
}
