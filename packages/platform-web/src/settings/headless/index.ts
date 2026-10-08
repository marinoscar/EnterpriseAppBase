// `@marinoscar/platform-web/settings/headless`: the settings slice's hooks and
// its open feature registry (issue #733, PP-8.1). Documented in ../README.md.

export {
  isFeatureEnabled,
  registerSettingsFeature,
  registeredSettingsFeatures,
  useSettingsFeatures,
} from './features.js';
export type { SettingsFeatureKey, SettingsFeatureResolver, SettingsFeatures } from './features.js';
export { useSystemSettings } from './use-system-settings.js';
export type { SettingsHookOptions, UseSystemSettingsResult, VersionedSettingsDocument } from './use-system-settings.js';
export { useUserSettings } from './use-user-settings.js';
export type {
  UseUserSettingsOptions,
  UseUserSettingsResult,
  UserSettingsDocument,
  UserSettingsUpdateBase,
} from './use-user-settings.js';
export { useOrgSettings } from './use-org-settings.js';
export type { UseOrgSettingsResult } from './use-org-settings.js';

// ---- `SettingsFeatureRegistry`: an augmentation target, declared here, never re-exported (#865) ----

/**
 * The known deployment feature keys, as an augmentation target. The platform
 * declares `ai` and `telemetry`; an app adds a key with module augmentation
 * and registers its resolver with {@link registerSettingsFeature}.
 *
 * @example
 * ```ts
 * declare module '@marinoscar/platform-web/settings/headless' {
 *   interface SettingsFeatureRegistry { orgs: true }
 * }
 * registerSettingsFeature('orgs', useOrgsFeature);
 * ```
 *
 * @stability experimental
 */
export interface SettingsFeatureRegistry {
  /** AI is switched on for this deployment. */
  ai: true;
  /** A telemetry store is deployed and collection is on. */
  telemetry: true;
}
