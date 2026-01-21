import { z } from 'zod';

// =============================================================================
// User Settings Schema
// =============================================================================

export const userSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  profile: z.object({
    displayName: z.string().max(100).optional(),
    useProviderImage: z.boolean(),
    customImageUrl: z.string().url().nullable().optional(),
  }),
});

export type UserSettingsDto = z.infer<typeof userSettingsSchema>;

// Partial schema for PATCH operations
export const userSettingsPatchSchema = userSettingsSchema.deepPartial();

// =============================================================================
// System Settings Schema
// =============================================================================

export const systemSettingsSchema = z.object({
  ui: z.object({
    allowUserThemeOverride: z.boolean(),
  }),
  security: z.object({
    jwtAccessTtlMinutes: z.number().int().min(1).max(60),
    refreshTtlDays: z.number().int().min(1).max(90),
  }),
  features: z.record(z.string(), z.boolean()),
});

export type SystemSettingsDto = z.infer<typeof systemSettingsSchema>;

// Partial schema for PATCH operations
export const systemSettingsPatchSchema = systemSettingsSchema.deepPartial();
