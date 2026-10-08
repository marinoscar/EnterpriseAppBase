// =============================================================================
// The `maintenance` system settings namespace's schemas (#256, epic #254)
// =============================================================================
//
// Moved verbatim from the reference app's `common/schemas/settings.schema.ts`,
// `system-settings-wire.schemas.ts` and `system-settings-response.schemas.ts`
// by #867, with the namespace declaration next door
// (`maintenance.system-settings.ts`). The app re-exports them under the same
// names. Zod only: a leaf file the settings registry can import at load time.
//
// `startedAt`/`startedById` are NULLABLE rather than absent when no window is
// open, so the key set of this namespace is the same whether maintenance is on
// or off. In the PATCH forms they are `.nullable().optional()`: `null` clears
// the window's provenance, absent leaves it alone, and the merge tells the two
// apart with `!== undefined`, never `??`.
// =============================================================================

import { z } from 'zod';

/**
 * The maintenance banner's default text. Names no product, so a fork renaming
 * itself has nothing to find here.
 *
 * @stability experimental
 */
export const DEFAULT_MAINTENANCE_MESSAGE =
  'This service is temporarily unavailable for scheduled maintenance. Please try again shortly.';

/**
 * The stored `maintenance` namespace: `enabled`, `message` and `allowAdmins`
 * are what an operator sets; `startedAt` and `startedById` are what opening a
 * window records. `allowAdmins` defaults to true because the person most
 * likely to need the application during maintenance is the person who turned
 * it on.
 *
 * @stability experimental
 */
export const systemMaintenanceSchema = z.object({
  enabled: z.boolean(),
  message: z.string().min(1).max(1000),
  allowAdmins: z.boolean(),
  startedAt: z.iso.datetime().nullable(),
  startedById: z.string().uuid().nullable(),
});

/**
 * The stored `maintenance` value.
 *
 * @stability experimental
 */
export type SystemMaintenanceValue = z.infer<typeof systemMaintenanceSchema>;

/**
 * The service-side PATCH (one level deep) of the `maintenance` namespace.
 *
 * @stability experimental
 */
export const systemMaintenancePatchSchema = z.object({
  enabled: z.boolean().optional(),
  message: z.string().min(1).max(1000).optional(),
  allowAdmins: z.boolean().optional(),
  startedAt: z.iso.datetime().nullable().optional(),
  startedById: z.string().uuid().nullable().optional(),
});

/**
 * The `maintenance` branch of the system settings PUT body.
 *
 * @stability experimental
 */
export const maintenanceSettingsSchema = z.object({
  enabled: z.boolean(),
  message: z.string().min(1).max(1000),
  allowAdmins: z.boolean(),
  startedAt: z.iso.datetime().nullable(),
  startedById: z.string().uuid().nullable(),
});

/**
 * The `maintenance` branch of the system settings PATCH body.
 *
 * @stability experimental
 */
export const maintenanceSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  message: z.string().min(1).max(1000).optional(),
  allowAdmins: z.boolean().optional(),
  startedAt: z.iso.datetime().nullable().optional(),
  startedById: z.string().uuid().nullable().optional(),
});

/**
 * The `maintenance` branch of the system settings response (the
 * OpenAPI-visible contract).
 *
 * @stability experimental
 */
export const maintenanceResponseSchema = z.object({
  enabled: z.boolean(),
  message: z.string(),
  allowAdmins: z.boolean(),
  startedAt: z.string().nullable(),
  startedById: z.string().nullable(),
});
