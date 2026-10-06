import type {
  DataTablesValue,
  NavigationValue,
  NotificationsValue,
} from '../schemas/user-settings-namespaces.schema';
import type {
  UserProfileSettingsValue,
  UserAiSettingsValue,
} from '../schemas/settings.schema';

// =============================================================================
// Settings Type Definitions
// =============================================================================

/**
 * User settings schema - stored in user_settings.value JSONB
 */
export interface UserSettingsValue {
  theme: 'light' | 'dark' | 'system';
  /**
   * Profile preferences (#367). `imageSource` chooses which picture represents
   * the user: none, the OAuth provider's picture, or one they uploaded.
   * `imageObjectId` is the uploaded avatar's `storage_objects` id and is kept
   * when the source is switched away from `upload`, so switching back does not
   * need a second upload. Derived from the zod schema so the two cannot drift.
   *
   * Rows written before #367 carry `useProviderImage`/`customImageUrl` instead;
   * they are normalised on read by `normalizeProfileSettings`
   * (common/profile-image/profile-image.ts), never migrated.
   */
  profile: UserProfileSettingsValue;
  /**
   * Per-table view preferences, keyed by table id.
   *
   * Optional on purpose, and derived from the zod schema so the two can never
   * drift. Absent means "the user has expressed no table preferences yet" —
   * NOT "empty preferences". See user-settings-namespaces.schema.ts.
   */
  dataTables?: DataTablesValue;
  /**
   * Navigation chrome preferences. Absent means "use built-in defaults".
   */
  navigation?: NavigationValue;
  /**
   * Per-channel, per-event notification preferences (#126), channel-outer:
   * `{ email: { 'user.welcome': false } }`.
   *
   * SPARSE AND OPTIONAL AT EVERY LEVEL. Absent namespace, absent channel and
   * absent event key all mean the same thing — "use the event's
   * `defaultEnabled` from the registry" — which is what lets this feature ship
   * with no migration and no backfill, and is why an untouched account is not
   * muted. The dispatcher resolves it; see
   * notifications/notification-preferences.ts.
   */
  notifications?: NotificationsValue;
  /**
   * AI preferences (#423, epic #419, umbrella #418): which (provider, model)
   * an AI surface should pre-select. Absent means "no default model chosen"
   * — the same sparse-optional contract every namespace above follows, so an
   * untouched account is not materialised with a preference nobody set.
   *
   * NON-SECRET ONLY: a user's own provider key is `UserAiKey.secret`, in its
   * own table, never here. See `userAiSettingsSchema` for the full argument.
   */
  ai?: UserAiSettingsValue;
}

/**
 * Default user settings
 */
// NOTE: `dataTables`, `navigation` and `notifications` are intentionally NOT
// listed here.
// Seeding them would turn "absent" into "explicitly empty", which is exactly
// the failure mode the namespaces are designed to avoid (a frozen column set
// that silently hides every column added later, or a notification preference
// map that freezes a user at the defaults of the day they first saved).
export const DEFAULT_USER_SETTINGS: UserSettingsValue = {
  theme: 'system',
  profile: {
    imageSource: 'provider',
    imageObjectId: null,
  },
};

/**
 * System settings - stored in system_settings.value JSONB (the 'global' row).
 *
 * COMPOSED FROM THE SYSTEM SETTINGS NAMESPACE REGISTRY (#677). One property per
 * registered namespace, each REQUIRED: every read of the column goes through
 * `readKnownSettings`, which fills a missing block from that namespace's
 * defaults, so no consumer writes `?? DEFAULT`. Each namespace documents its
 * value where it is declared (`<module>.system-settings.ts`, augmenting
 * `SystemSettingsNamespaces`); `settings/registry/README.md` has the recipe.
 */
export type { SystemSettingsValue } from '../../settings/registry/system-settings-namespace';

/**
 * Default system settings: every namespace's `defaults`, in registration
 * order. The only place defaults live is each namespace's declaration file;
 * the zod schemas never carry `.default()`.
 */
export { DEFAULT_SYSTEM_SETTINGS } from '../../settings/registry/composed';
