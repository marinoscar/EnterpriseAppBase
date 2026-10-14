// The identity shapes (the signed-in user, the admin lists, device
// activation, personal access tokens, organizations) are defined once, in
// `@marinoscar/platform-web/identity/headless` (#727, PP-6.6); import them
// from there.

import type { AiDefaultModel } from '@marinoscar/platform-web/ai/headless';
import type { DataTableDensity, DataTableStoredLayout } from '@marinoscar/platform-web/datatable/headless';

export type { DataTableDensity };
export type { AiDefaultModel };

export type ProfileImageSource = 'none' | 'provider' | 'upload';

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
export type DataTableSettings = DataTableStoredLayout;

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

// Maintenance mode (#258) and About (#401): the wire shapes moved to
// `@marinoscar/platform-web/host/headless` (#891) and are re-exported here.
export type {
  AboutApi,
  AboutApp,
  AboutDatabase,
  AboutDeployedBy,
  AboutHistoryEntry,
  AboutHost,
  AboutProxy,
  AboutRemote,
  AboutResponse,
  AboutRun,
  AboutRuntime,
  DeployCommand,
  DeployInfoStatus,
  MaintenanceOverride,
  MaintenancePolicy,
  MaintenanceSource,
  MaintenanceStatus,
  UpdateMaintenanceInput,
} from '@marinoscar/platform-web/host/headless';

/** `GET /api/storage/status`: whether object storage is configured. Never provider details. */
export interface StorageStatus {
  configured: boolean;
}
