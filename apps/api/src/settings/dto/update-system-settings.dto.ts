import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Full replacement (PUT)
export const updateSystemSettingsSchema = z.object({
  ui: z.object({
    allowUserThemeOverride: z.boolean(),
  }),
  security: z.object({
    jwtAccessTtlMinutes: z.number().int().min(1).max(60),
    refreshTtlDays: z.number().int().min(1).max(90),
  }),
  features: z.record(z.string(), z.boolean()),
});

export class UpdateSystemSettingsDto extends createZodDto(
  updateSystemSettingsSchema,
) {}

// Partial update (PATCH)
export const patchSystemSettingsSchema = z.object({
  ui: z
    .object({
      allowUserThemeOverride: z.boolean().optional(),
    })
    .optional(),
  security: z
    .object({
      jwtAccessTtlMinutes: z.number().int().min(1).max(60).optional(),
      refreshTtlDays: z.number().int().min(1).max(90).optional(),
    })
    .optional(),
  features: z.record(z.string(), z.boolean()).optional(),
});

export class PatchSystemSettingsDto extends createZodDto(
  patchSystemSettingsSchema,
) {}
