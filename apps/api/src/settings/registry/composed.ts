// =============================================================================
// The composed settings objects, built once at module load (issue #677)
// =============================================================================
//
// The reference app's COMPOSITION of the settings slice
// (`@marinoscar/platform-api/settings`, #733): the package owns the registries
// and the compose functions; this app owns its manifests (which namespaces,
// in which order) and this import-time snapshot of what they compose to, for
// the app code and tests that import a composed schema by name. The routes'
// DTOs are composed by `SettingsModule.forRoot()` from the same registries
// (`platform/settings/settings.config.ts` imports this file first).
//
// The objects the rest of the code imports — `systemSettingsSchema`,
// `systemSettingsPatchSchema`, the request bodies, the response branches and
// `DEFAULT_SYSTEM_SETTINGS` — folded from the namespace registries after their
// manifests have filled them. They must exist at import time: DTO classes are
// built by `createZodDto` while their module is evaluated, and
// `npm run openapi:dump` reads them in preview mode, where no Nest hook runs.
//
// IMPORT CYCLE RULE. This file imports the manifests, the manifests import the
// declaration files, and the declaration files import the per-namespace leaf
// schemas. A leaf (`common/schemas/settings.schema.ts`, the `system-settings-*.schemas.ts`
// files, a declaration file) must therefore never import this file or anything
// that does (`common/types/settings.types.ts`): under CommonJS
// the cycle would hand it `undefined`. `no-cycles.spec.ts` loads every entry
// point first, in isolation, to prove it.
//
// REQUIRED IN THE STORED SHAPE, OPTIONAL ON THE WIRE. `systemSettingsSchema`
// describes the value as STORED, which is always complete: every write path
// runs the row through `readKnownSettings`, which fills any missing block from
// the namespace's defaults. What a CLIENT may omit is the PUT body's question
// (`requiredOnPut`), answered in `updateSystemSettingsSchema`.
// =============================================================================

import type { z } from 'zod';
import {
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
  type SystemSettingsValue,
} from '@marinoscar/platform-api/settings';
import './system-settings.manifest';
import './user-settings.manifest';

/** The stored system settings document (place 1). */
export const systemSettingsSchema = composeSystemSettingsSchema();

export type SystemSettingsDto = z.infer<typeof systemSettingsSchema>;

/** The canonical partial (place 2). zod v4 has no `deepPartial`; each namespace hand-writes its own. */
export const systemSettingsPatchSchema = composeSystemSettingsPatchSchema();

/** The PUT request body (place 3). */
export const composedUpdateSystemSettingsSchema = composeUpdateSystemSettingsSchema();
export const updateSystemSettingsSchema = composedUpdateSystemSettingsSchema;

/** The PATCH request body (place 4); what `PATCH /api/system-settings`'s pipe parses. */
export const composedPatchSystemSettingsSchema = composePatchSystemSettingsSchema();
export const patchSystemSettingsSchema = composedPatchSystemSettingsSchema;

/** The namespace branches of `systemSettingsResponseSchema`. */
export const composedSystemSettingsResponseValue = composeSystemSettingsResponseValue();

/** The `GET /api/system-settings` payload (the OpenAPI response contract). */
export const systemSettingsResponseSchema = composeSystemSettingsResponseSchema();

/** The defaults (place 5), re-exported by `common/types/settings.types.ts`. */
export const DEFAULT_SYSTEM_SETTINGS: SystemSettingsValue = composeDefaultSystemSettings();

/** The stored user settings document: `theme`, `profile`, then every optional namespace. */
export const userSettingsSchema = composeUserSettingsSchema();

export type UserSettingsDto = z.infer<typeof userSettingsSchema>;

/** The canonical user settings partial. */
export const userSettingsPatchSchema = composeUserSettingsPatchSchema();

/** The namespace shapes of the user-settings request bodies and response. */
export const composedUserSettingsShapes = composeUserSettingsSchemas();

/** The `PUT /api/user-settings` body. */
export const updateUserSettingsSchema = composeUpdateUserSettingsSchema();

/** The `PATCH /api/user-settings` body. */
export const patchUserSettingsSchema = composePatchUserSettingsSchema();

/** The `GET /api/user-settings` payload. */
export const userSettingsResponseSchema = composeUserSettingsResponseSchema();
