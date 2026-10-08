// `@marinoscar/platform-web/settings/ui`: the settings hub and the section
// registry's types and helpers (issue #733, PP-8.1). Documented in ../README.md.
// The app keeps its registries (`ADMIN_SECTIONS`, `USER_SETTINGS_SECTIONS`)
// and its routes; this entry is the structure they are drawn with.

export { SettingsHub } from './SettingsHub.js';
export type { SettingsHubProps } from './SettingsHub.js';
export { settingsPageTitle, visibleSettingsSections } from './registry.js';
export type { SettingsCardDef, SettingsSectionDef } from './registry.js';
export { isFeatureEnabled } from '../headless/features.js';
export type { SettingsFeatureKey, SettingsFeatureRegistry, SettingsFeatures } from '../headless/features.js';
