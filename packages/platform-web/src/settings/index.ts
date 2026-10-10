// The settings slice's entry point for SIBLING SLICES of this package (issue
// #738): the boundary lint lets one slice import another only through the
// other's `index.ts`, and only when packages/platform-slices.json lists the
// dependency (email, notifications, shell -> settings). Not a package subpath:
// apps import `@marinoscar/platform-web/settings/headless` and `/settings/ui`.
// Narrow on purpose: only what a sibling uses.

export { isFeatureEnabled, useSettingsFeatures, useSystemSettings, useUserSettings } from './headless/index.js';
export type {
  SettingsFeatureKey,
  SettingsFeatures,
  UseUserSettingsOptions,
  UseUserSettingsResult,
  UserSettingsDocument,
  UserSettingsUpdateBase,
} from './headless/index.js';
// The shell (#868): the Console rail lists the admin registry, the AppBar
// titles a settings route from it.
export { settingsPageTitle, visibleSettingsSections } from './ui/registry.js';
export type { SettingsSectionDef } from './ui/registry.js';
// The generated pluggable-kind form (#924): the AI admin page renders a
// provider an app registered with it.
export { PluggableConfigForm } from './ui/PluggableConfigForm.js';
export type { PluggableConfigFormProps, PluggableConfigFormSlots } from './ui/PluggableConfigForm.js';
