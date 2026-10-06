// The settings namespace registries (issue #677). Recipe: ./README.md.
//
// Importing this barrel fills the registries (through `composed.ts`, which
// imports the manifests). Declaration files must NOT import it: they import
// the type they need from `./system-settings-namespace` directly, so they stay
// leaves (see the import-cycle rule in `composed.ts`).

export * from './composed';
export * from './compose';
export {
  RESERVED_SYSTEM_SETTINGS_KEYS,
  SETTINGS_NAMESPACE_KEY_PATTERN,
  registerSystemSettingsNamespaces,
  systemSettingsNamespaceRegistry,
} from './system-settings-namespace';
export type {
  SettingsReadHelpers,
  SystemSettingsNamespace,
  SystemSettingsNamespaceDeclarations,
  SystemSettingsNamespaces,
  SystemSettingsValue,
} from './system-settings-namespace';
export { mergeOptional } from './merge-helpers';
export {
  RESERVED_USER_SETTINGS_KEYS,
  registerUserSettingsNamespaces,
  userSettingsNamespaceRegistry,
} from './user-settings-namespace';
export type {
  UserSettingsNamespace,
  UserSettingsNamespaceDeclarations,
  UserSettingsNamespaces,
  UserSettingsNamespacesValue,
} from './user-settings-namespace';
export {
  extendSystemSettingsNamespace,
  extendUserSettingsNamespace,
  foldSettingsExtensions,
} from './extend';
export type { SystemSettingsNamespaceExtension, UserSettingsNamespaceExtension } from './extend';
