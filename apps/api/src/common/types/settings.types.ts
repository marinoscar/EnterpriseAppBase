import type { UserProfileSettingsValue } from '../schemas/settings.schema';
import type { UserSettingsNamespacesValue } from '../../settings/registry/user-settings-namespace';

// =============================================================================
// Settings Type Definitions
// =============================================================================

/**
 * User settings schema - stored in user_settings.value JSONB
 *
 * `theme` and `profile` are core fields. Every other key is an OPTIONAL
 * namespace from the user settings namespace registry (#677): `dataTables`,
 * `navigation`, `notifications`, `ai`, and any an app registers. Each is typed
 * where it is declared (`*.user-settings.ts`, augmenting
 * `UserSettingsNamespaces`), and absent means "use the built-in defaults" —
 * NOT "empty preferences". See user-settings-namespaces.schema.ts.
 */
export interface UserSettingsValue extends UserSettingsNamespacesValue {
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
