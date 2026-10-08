// `@marinoscar/platform-api/settings`: the settings slice (issue #733, PP-8.1).
// The system, user and organization settings documents, the namespace
// registries they are composed from, the system -> org -> user resolver and
// the keyed-row store. Documented in ./README.md. Explicit named exports only.

// ---- the module and its options (rung 1) ----------------------------------------------
export { SettingsModule } from './settings.module';
export {
  DEFAULT_SETTINGS_OPTIONS,
  SETTINGS_OPTIONS,
  resolveSettingsModuleOptions,
} from './settings.options';
export type { ResolvedSettingsModuleOptions, SettingsModuleOptions } from './settings.options';

// ---- the host ports (rung 3) ----------------------------------------------------------
export { SETTINGS_DATA, SETTINGS_PROFILE_IMAGES } from './ports';
export type { NormalizedProfileSettings, SettingsDataPort, SettingsProfileImages } from './ports';
export type {
  SettingsDelegate,
  SettingsOrgSettingsRow,
  SettingsOrgTx,
  SettingsPrisma,
  SettingsQueryArgs,
  SettingsSystemSettingsRow,
  SettingsUserSettingsRow,
} from './data/settings-db';

// ---- the namespace registries (rung 2) ---------------------------------------------------
export {
  RESERVED_SYSTEM_SETTINGS_KEYS,
  SETTINGS_NAMESPACE_KEY_PATTERN,
  registerSystemSettingsNamespaces,
  systemSettingsNamespaceRegistry,
} from './registry/system-settings-namespace';
export type {
  SettingsNamespaceOrgLayer,
  SettingsReadHelpers,
  SystemSettingsNamespace,
  SystemSettingsNamespaceDeclarations,
  SystemSettingsNamespaceValue,
  SystemSettingsNamespaces,
  SystemSettingsValue,
} from './registry/system-settings-namespace';
export {
  RESERVED_USER_SETTINGS_KEYS,
  registerUserSettingsNamespaces,
  userSettingsNamespaceRegistry,
} from './registry/user-settings-namespace';
export type {
  UserSettingsNamespace,
  UserSettingsNamespaceDeclarations,
  UserSettingsNamespaces,
  UserSettingsNamespacesValue,
} from './registry/user-settings-namespace';
export { SETTINGS_SECRET_FIELD_NAMES, secretFieldMessage } from './registry/secret-fields';
export type { SettingsSecretFieldName } from './registry/secret-fields';
export { findDefaultPaths, findSecretFieldPaths, isZodSchema, walkSchema } from './registry/schema-walk';
export { mergeOptional } from './registry/merge-helpers';
export {
  extendSystemSettingsNamespace,
  extendUserSettingsNamespace,
  foldSettingsExtensions,
} from './registry/extend';
export type { SystemSettingsNamespaceExtension, UserSettingsNamespaceExtension } from './registry/extend';
export { DATA_TABLES_USER_SETTINGS, NAVIGATION_USER_SETTINGS } from './registry/core-user-namespaces';

// ---- composition: the composed schemas, request bodies and defaults ----------------------
export {
  composeDefaultSystemSettings,
  composePatchSystemSettingsSchema,
  composePatchUserSettingsSchema,
  composeSystemSettingsPatchSchema,
  composeSystemSettingsResponseSchema,
  composeSystemSettingsResponseValue,
  composeSystemSettingsSchema,
  composeUpdateSystemSettingsSchema,
  composeUpdateUserSettingsSchema,
  composeUserSettingsPatchSchema,
  composeUserSettingsResponseSchema,
  composeUserSettingsSchema,
  composeUserSettingsSchemas,
  currentPatchSystemSettingsSchema,
  currentSystemSettingsSchema,
  currentUpdateSystemSettingsSchema,
  currentUserSettingsSchema,
} from './registry/compose';
export type {
  ComposedPatchBody,
  ComposedPatchBody as PatchSystemSettingsDto,
  ComposedPatchSystemSettingsShape,
  ComposedPatchUserBody,
  ComposedPatchUserBody as PatchUserSettingsDto,
  ComposedPatchUserSettingsShape,
  ComposedSystemSettingsPatchShape,
  ComposedSystemSettingsResponseShape,
  ComposedSystemSettingsShape,
  ComposedUpdateBody,
  ComposedUpdateBody as UpdateSystemSettingsDto,
  ComposedUpdateSystemSettingsShape,
  ComposedUpdateUserBody,
  ComposedUpdateUserBody as UpdateUserSettingsDto,
  ComposedUpdateUserSettingsShape,
  ComposedUserSettingsPatchShape,
  ComposedUserSettingsResponseShape,
  ComposedUserSettingsShape,
  ComposedUserSettingsShapes,
  SystemSettingsCoreResponseShape,
  SystemSettingsDto,
  UserSettingsCorePatchShape,
  UserSettingsCoreResponseShape,
  UserSettingsCoreShape,
  UserSettingsDto,
} from './registry/compose';
export { checkSystemSettingsCatalog, renderSystemSettingsCatalog } from './registry/catalog';

// ---- the services ----------------------------------------------------------------------
export { SystemSettingsService } from './system-settings/system-settings.service';
export type { SystemSettingsResponse } from './system-settings/system-settings.service';
export { DEFAULT_USER_SETTINGS, UserSettingsService } from './user-settings/user-settings.service';
export type { UserSettingsResponse, UserSettingsValue } from './user-settings/user-settings.service';
export { ORG_SETTINGS_PATCH_AUDIT_ACTION, OrgSettingsService } from './org-settings/org-settings.service';
export type { OrgSettingsAccess } from './org-settings/org-settings.service';
export { OrgSettingsController, OrgSettingsResponseDto, PatchOrgSettingsDto } from './org-settings/org-settings.controller';
export { SettingsResolver } from './settings-resolver';
export { SystemSettingsRowStore } from './row-store';
export type { SystemSettingsRowSnapshot, SystemSettingsRowWriteOptions } from './row-store';
export { createSystemSettingsController } from './system-settings/system-settings.controller';
export { createUserSettingsController } from './user-settings/user-settings.controller';

// ---- permissions, as data for the app's permission registry -----------------------------
export { ORG_SETTINGS_PERMISSIONS, SETTINGS_PERMISSIONS } from './settings.permissions';
export type { SettingsPermissionDeclaration } from './settings.permissions';

// ---- the slice's models in the app's data registries --------------------------------------
export { SETTINGS_MODEL_OWNERSHIP, SETTINGS_USER_OWNED_MODELS } from './data/settings-ownership';
