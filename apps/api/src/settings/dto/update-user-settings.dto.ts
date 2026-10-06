import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  userProfileSettingsSchema,
  userProfileSettingsPatchSchema,
} from '../../common/schemas/settings.schema';
import { composedUserSettingsShapes } from '../registry/composed';

// The optional namespaces (`dataTables`, `navigation`, `notifications`, `ai`,
// and any an app registers) are COMPOSED from the user settings namespace
// registry (#677), in registration order, after the core fields. Each
// namespace's declaration file documents its PUT and PATCH semantics.

// Full replacement (PUT)
export const updateUserSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  // `imageSource: 'upload'` requires `imageObjectId` to name an avatar the
  // caller uploaded (checked by the service — 400 otherwise). Omitting
  // `imageObjectId` keeps the stored one; `null` clears it.
  profile: userProfileSettingsSchema,
  // Optional namespaces. A PUT states the settings in full, so `null` has no
  // "delete" meaning here — omit the namespace to store nothing for it.
  ...composedUserSettingsShapes.put,
});

export class UpdateUserSettingsDto extends createZodDto(
  updateUserSettingsSchema,
) {}

// Partial update (PATCH) - JSON Merge Patch style
export const patchUserSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  // Field-wise merge. Switching `imageSource` away from `upload` keeps
  // `imageObjectId`, so switching back needs no second upload.
  profile: userProfileSettingsPatchSchema.optional(),
  // Optional namespaces, each `.nullable().optional()`: `dataTables: null`
  // clears the namespace; `dataTables: { jobs: null }` deletes just that entry.
  // `notifications` deletes at three levels (#126): the namespace, one
  // channel, one event key — see `notifications/notifications.user-settings.ts`.
  ...composedUserSettingsShapes.wirePatch,
});

export class PatchUserSettingsDto extends createZodDto(
  patchUserSettingsSchema,
) {}
