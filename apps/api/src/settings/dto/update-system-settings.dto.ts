import { createZodDto } from 'nestjs-zod';
import {
  composedPatchSystemSettingsSchema,
  composedUpdateSystemSettingsSchema,
} from '../registry/composed';

// =============================================================================
// System settings request bodies (PUT and PATCH)
// =============================================================================
//
// COMPOSED FROM THE SYSTEM SETTINGS NAMESPACE REGISTRY (#677): one branch per
// registered namespace, in registration order. Each namespace's declaration
// file names its branches (`putSchema`, `wirePatchSchema`); the branches
// themselves, and the argument for why only `notifications` is REQUIRED in a
// PUT body, live in `system-settings-wire.schemas.ts`.
//
// THESE ARE THE TRAP THE PARITY GUARD EXISTS FOR. The global
// `ZodValidationPipe` parses the body against these schemas first and strips
// every key they do not declare, so a namespace missing here would be a SILENT
// no-op. Deriving them from the registry is what makes that impossible;
// `common/schemas/settings-parity.spec.ts` still checks it.
// =============================================================================

// Full replacement (PUT). A namespace with `requiredOnPut: false` may be
// omitted: `SystemSettingsService.replaceSettings` carries it forward from the
// stored value, never resetting it to the defaults.
export const updateSystemSettingsSchema = composedUpdateSystemSettingsSchema;

export class UpdateSystemSettingsDto extends createZodDto(
  updateSystemSettingsSchema,
) {}

// Partial update (PATCH). Optional at the namespace level and field by field
// inside, so `{ "databaseBackup": { "enabled": true } }` is a legal body.
export const patchSystemSettingsSchema = composedPatchSystemSettingsSchema;

export class PatchSystemSettingsDto extends createZodDto(
  patchSystemSettingsSchema,
) {}
