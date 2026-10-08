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

// The notifications wire types are `@marinoscar/platform-web/notifications/headless` since #738.
export type {
  NotificationChannel,
  NotificationEventDef,
  NotificationChannelPreferences,
  NotificationPreferences,
  NotificationChannelPreferencesPatch,
  NotificationPreferencesPatch,
  AppNotification,
  NotificationListResponse,
  UnreadCountResponse,
  NotificationStreamEvent,
  NotificationConfigResponse,
  PushSubscriptionPayload,
  PushSubscriptionResponse,
} from '@marinoscar/platform-web/notifications/headless';
import type { NotificationPreferences, NotificationPreferencesPatch } from '@marinoscar/platform-web/notifications/headless';
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
// (`packages/platform-api/src/host/maintenance/dto/update-maintenance.dto.ts`). Mirrored
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
