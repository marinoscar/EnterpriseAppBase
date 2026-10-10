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
  SettingsBatchResult,
  SettingsDelegate,
  SettingsIdRow,
  SettingsUserRow,
  SettingsOrgSettingsRow,
  SettingsOrgTx,
  SettingsPrisma,
  SettingsQueryArgs,
  SettingsSystemSettingsRow,
  SettingsUserSettingsRow,
} from './data/settings-db';

// ---- the augmentable namespace maps (rung 2) ---------------------------------------------
//
// DECLARED HERE, IN THE MODULE `@marinoscar/platform-api/settings` RESOLVES TO,
// AND NEVER RE-EXPORTED (#865). An app augments these four from outside the
// package (`declare module '@marinoscar/platform-api/settings' { ... }`). When
// the augmented interface is only a re-export of a declaration in another
// file, TypeScript merges the app's augmentation through the alias, and a
// second augmentation of the DECLARING file (every packaged slice's own
// `declare module`) that the checker happens to process later replaces the
// merged symbol: which keys survive then depends on file order, and an
// installed app's `getNamespace('notes')` loses its key. Declaring them in the
// entry module makes every augmentation, the slices' and the app's, target the
// same file directly; slices augment `'../settings/index'`, never a deeper path.
// `packages/platform-api/test/augmentation-targets.spec.ts` proves it
// against the built declarations, in both file orders.

/**
 * Key → stored value type of every registered system namespace. Each slice's
 * declaration file adds its key by module augmentation of this module; an app
 * adds its own the same way, and `SystemSettingsService.getNamespace(key)`
 * returns that type.
 *
 * @example
 * ```ts
 * declare module '@marinoscar/platform-api/settings' {
 *   interface SystemSettingsNamespaces { coach: CoachSettings }
 * }
 * ```
 *
 * @stability experimental
 */
export interface SystemSettingsNamespaces {}

/**
 * Key → `typeof` the declaration, for the precise static types of the composed
 * schemas (`updateSystemSettingsSchema.parse(...)` returning typed branches).
 * Optional for an app: a namespace augmented only in
 * {@link SystemSettingsNamespaces} is still validated, stored and returned;
 * its request-body branch is just not statically typed.
 *
 * @stability experimental
 */
export interface SystemSettingsNamespaceDeclarations {}

/**
 * Key → stored value type of every registered user namespace. Slices add their
 * keys by module augmentation of this module; an app adds its own the same
 * way. Every key is OPTIONAL in `UserSettingsValue`.
 *
 * @example
 * ```ts
 * declare module '@marinoscar/platform-api/settings' {
 *   interface UserSettingsNamespaces { coachPrefs: CoachPrefs }
 * }
 * ```
 *
 * @stability experimental
 */
export interface UserSettingsNamespaces {}

/**
 * Key → `typeof` the declaration, for the precise static types of the composed
 * schemas. Optional for an app (see {@link SystemSettingsNamespaceDeclarations}).
 *
 * @stability experimental
 */
export interface UserSettingsNamespaceDeclarations {}

// ---- the namespace registries (rung 2) ---------------------------------------------------
export {
  RESERVED_SYSTEM_SETTINGS_KEYS,
  SETTINGS_NAMESPACE_KEY_PATTERN,
  ensureSystemSettingsNamespaces,
  registerSystemSettingsNamespaces,
  systemSettingsNamespaceRegistry,
} from './registry/system-settings-namespace';
export type {
  SettingsNamespaceOrgLayer,
  SettingsReadHelpers,
  SystemSettingsNamespace,
  SystemSettingsNamespaceOf,
  SystemSettingsNamespaceValue,
  SystemSettingsValue,
} from './registry/system-settings-namespace';
export {
  RESERVED_USER_SETTINGS_KEYS,
  registerUserSettingsNamespaces,
  userSettingsNamespaceRegistry,
} from './registry/user-settings-namespace';
export type {
  UserSettingsNamespace,
  UserSettingsNamespacesValue,
} from './registry/user-settings-namespace';
export { SETTINGS_SECRET_FIELD_NAMES, secretFieldMessage } from './registry/secret-fields';
export type { SettingsSecretFieldName } from './registry/secret-fields';
export { findDefaultPaths, findSecretFieldPaths, isZodSchema } from './registry/schema-walk';
export { mergeOptional } from './registry/merge-helpers';
export {
  extendSystemSettingsNamespace,
  extendUserSettingsNamespace,
  foldSettingsExtensions,
} from './registry/extend';
export type {
  AnyObject,
  KeyedNamespace,
  NamespaceLists,
  SystemSettingsNamespaceExtension,
  UserSettingsNamespaceExtension,
} from './registry/extend';
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
  RequiredOnPutDeclaration,
  SecurityPolicyShape,
  SysDecls,
  SysField,
  SystemSettingsCoreResponseShape,
  SystemSettingsDto,
  UpdatedByShape,
  UserDecls,
  UserField,
  UserFieldOr,
  UserProfileResponseShape,
  UserSettingsCorePatchShape,
  UserSettingsCoreResponseShape,
  UserSettingsCoreShape,
  UserSettingsDto,
} from './registry/compose';
export { checkSystemSettingsCatalog, renderSystemSettingsCatalog } from './registry/catalog';

// ---- the services ----------------------------------------------------------------------
export { SystemSettingsService } from './system-settings/system-settings.service';
export type { SystemSettingsResponse, SystemSettingsResponseCore } from './system-settings/system-settings.service';
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
