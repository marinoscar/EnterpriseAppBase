import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { composedSystemSettingsResponseValue } from '../registry/composed';

export const systemSettingsResponseSchema = z.object({
  security: z.object({
    jwtAccessTtlMinutes: z.number(),
    refreshTtlDays: z.number(),
  }),
  // One branch per registered system settings namespace (#677), in
  // registration order; branches live in `system-settings-response.schemas.ts`.
  ...composedSystemSettingsResponseValue,
  updatedAt: z.iso.datetime(),
  updatedBy: z
    .object({
      id: z.string().uuid(),
      email: z.string().email(),
    })
    .nullable(),
  version: z.number(),
});

export class SystemSettingsResponseDto extends createZodDto(
  systemSettingsResponseSchema,
) {}
