// `@marinoscar/platform-web/settings/ui`: the settings hub and the section
// registry's types and helpers (issue #733, PP-8.1). Documented in ../README.md.
// The app keeps its registries (`ADMIN_SECTIONS`, `USER_SETTINGS_SECTIONS`)
// and its routes; this entry is the structure they are drawn with.

export { ImageUpload, PROFILE_IMAGE_MAX_BYTES, PROFILE_IMAGE_TYPES } from './ImageUpload.js';
export type { ImageUploadProps } from './ImageUpload.js';
export { OrgSettingsPage } from './OrgSettingsPage.js';
export { PluggableConfigForm } from './PluggableConfigForm.js';
export type {
  PluggableConfigFormProps,
  PluggableConfigFormSlots,
  PluggableFieldRenderContext,
} from './PluggableConfigForm.js';
export { ProfileSettings } from './ProfileSettings.js';
export type { ProfilePatch, ProfileSettingsProps } from './ProfileSettings.js';
export { ThemeSettings } from './ThemeSettings.js';
export type { ThemeSettingsProps } from './ThemeSettings.js';
export { UserAppearancePage } from './UserAppearancePage.js';
export { UserProfilePage } from './UserProfilePage.js';
export { UserSettingsSection } from './UserSettingsSection.js';
export type {
  UserSettingsSaveMessages,
  UserSettingsSectionProps,
  UserSettingsSectionState,
  UserSettingsUpdate,
} from './UserSettingsSection.js';
export { SettingsHub } from './SettingsHub.js';
export type { SettingsHubProps } from './SettingsHub.js';
export { cardPermissionGranted, settingsPageTitle, visibleSettingsSections } from './registry.js';
export type { SettingsCardDef, SettingsSectionDef } from './registry.js';
export { isFeatureEnabled } from '../headless/features.js';
// `SettingsFeatureRegistry` is augmented and imported from `/settings/headless`,
// where it is declared (#865): a re-export here would be a second, aliased
// augmentation target.
export type { SettingsFeatureKey, SettingsFeatures } from '../headless/features.js';
