import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const systemSettingsResponseSchema = z.object({
  ui: z.object({
    allowUserThemeOverride: z.boolean(),
  }),
  security: z.object({
    jwtAccessTtlMinutes: z.number(),
    refreshTtlDays: z.number(),
  }),
  features: z.record(z.string(), z.boolean()),
  // #225, epic #215. Part of the represented resource, which is what makes a
  // PUT that omits it meaningful (and rejected) rather than a client simply not
  // knowing the field exists. Nothing enforces these values yet — that is #226.
  notifications: z.object({
    browserEnabled: z.boolean(),
    disabledEvents: z.array(z.string()),
  }),
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
