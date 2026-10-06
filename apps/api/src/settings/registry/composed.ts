// =============================================================================
// The composed settings objects, built once at module load (issue #677)
// =============================================================================
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
// schemas. A leaf (`common/schemas/settings.schema.ts`, the `dto/*.schemas.ts`
// files, a declaration file) must therefore never import this file or anything
// that does (`common/types/settings.types.ts`, the DTO files): under CommonJS
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
import './system-settings.manifest';
import {
  composeDefaultSystemSettings,
  composePatchSystemSettingsSchema,
  composeSystemSettingsPatchSchema,
  composeSystemSettingsResponseValue,
  composeSystemSettingsSchema,
  composeUpdateSystemSettingsSchema,
} from './compose';
import type { SystemSettingsValue } from './system-settings-namespace';

/** The stored system settings document (place 1). */
export const systemSettingsSchema = composeSystemSettingsSchema();

export type SystemSettingsDto = z.infer<typeof systemSettingsSchema>;

/** The canonical partial (place 2). zod v4 has no `deepPartial`; each namespace hand-writes its own. */
export const systemSettingsPatchSchema = composeSystemSettingsPatchSchema();

/** The PUT request body (place 3), re-exported by `update-system-settings.dto.ts`. */
export const composedUpdateSystemSettingsSchema = composeUpdateSystemSettingsSchema();

/** The PATCH request body (place 4), re-exported by `update-system-settings.dto.ts`. */
export const composedPatchSystemSettingsSchema = composePatchSystemSettingsSchema();

/** The namespace branches of `systemSettingsResponseSchema`. */
export const composedSystemSettingsResponseValue = composeSystemSettingsResponseValue();

/** The defaults (place 5), re-exported by `common/types/settings.types.ts`. */
export const DEFAULT_SYSTEM_SETTINGS: SystemSettingsValue = composeDefaultSystemSettings();
