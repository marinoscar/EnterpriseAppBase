import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { profileImageSourceSchema } from '../../common/schemas/settings.schema';
import { composedUserSettingsShapes } from '../registry/composed';

export const userSettingsResponseSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  profile: z.object({
    displayName: z.string().nullable().optional(),
    imageSource: profileImageSourceSchema,
    // Always present in responses; `null` when no avatar has been uploaded.
    imageObjectId: z.string().uuid().nullable(),
  }),
  // The optional namespaces, composed from the user settings namespace
  // registry (#677). Emitted only when the user has stored something for the
  // namespace: absent here is INFORMATION, not an omission — it tells the
  // client to apply its built-in defaults (for `notifications`, each event's
  // registry default, #126).
  ...composedUserSettingsShapes.response,
  updatedAt: z.iso.datetime(),
  version: z.number(),
});

export class UserSettingsResponseDto extends createZodDto(
  userSettingsResponseSchema,
) {}
