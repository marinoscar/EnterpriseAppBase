
// =============================================================================
// Settings Type Definitions
// =============================================================================

/**
 * User settings schema - stored in user_settings.value JSONB, and its
 * defaults. The settings slice's (`@marinoscar/platform-api/settings`, #733):
 * `theme` and `profile` are core fields; every other key is an OPTIONAL
 * namespace from the user settings namespace registry, typed where it is
 * declared (`*.user-settings.ts`, augmenting `UserSettingsNamespaces`).
 * Absent means "use the built-in defaults" — NOT "empty preferences".
 * `DEFAULT_USER_SETTINGS` deliberately lists no namespace.
 */
export { DEFAULT_USER_SETTINGS } from '@marinoscar/platform-api/settings';
export type { UserSettingsValue } from '@marinoscar/platform-api/settings';

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
export type { SystemSettingsValue } from '@marinoscar/platform-api/settings';

/**
 * Default system settings: every namespace's `defaults`, in registration
 * order. The only place defaults live is each namespace's declaration file;
 * the zod schemas never carry `.default()`.
 */
export { DEFAULT_SYSTEM_SETTINGS } from '../../settings/registry/composed';
