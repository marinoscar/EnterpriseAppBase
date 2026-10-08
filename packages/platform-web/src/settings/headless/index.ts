// `@marinoscar/platform-web/settings/headless`: the settings slice's hooks and
// its open feature registry (issue #733, PP-8.1). Documented in ../README.md.

export {
  isFeatureEnabled,
  registerSettingsFeature,
  registeredSettingsFeatures,
  useSettingsFeatures,
} from './features.js';
export type { SettingsFeatureKey, SettingsFeatureRegistry, SettingsFeatureResolver, SettingsFeatures } from './features.js';
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
