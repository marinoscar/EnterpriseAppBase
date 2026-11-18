// =============================================================================
// Example: a settings contribution written the way a package would (PP-14.21)
// =============================================================================
//
// A package `@example/quota-settings` ships this as its entry module. Importing
// it FOR ITS SIDE EFFECT is all the app does:
//
//   // apps/api/src/app-registrations/settings-contributions.ts
//   import '@example/quota-settings';
//
// It contributes, with `registerSettingsContribution`:
//
//   - a system namespace `quotaPolicy` (an organization may only LOWER the
//     daily limit),
//   - an optional user namespace `quotaView`,
//   - an extension: `telemetry.assistant.citations`, a field INSIDE a nested
//     object of a platform namespace.
//
// The manifests assemble it between the platform's namespaces and the app's own
// (see `app-registrations/settings-contributions.ts`). The reference app does not
// import this file in production, so its settings document is unchanged;
// `test/examples/settings/contribution.spec.ts` imports it into the real
// application.
// =============================================================================

import { registerSettingsContribution } from '@marinoscar/platform-api/settings';
import type { SystemSettingsNamespace, UserSettingsNamespace } from '@marinoscar/platform-api/settings';
import { z } from 'zod';

const quotaPolicySchema = z.object({
  dailyLimit: z.number().int().min(1).max(10_000),
  warnAtPercent: z.number().int().min(1).max(100),
});

/** The stored `quotaPolicy` value. */
export type QuotaPolicyValue = z.infer<typeof quotaPolicySchema>;

/** The system namespace `quotaPolicy`: an organization may lower `dailyLimit`, never raise it. */
export const QUOTA_SYSTEM_SETTINGS = {
  key: 'quotaPolicy',
  description: 'How many operations one organization may run per day, and when to warn about it.',
  storedSchema: quotaPolicySchema,
  patchSchema: quotaPolicySchema.partial(),
  putSchema: quotaPolicySchema,
  wirePatchSchema: quotaPolicySchema.partial(),
  responseSchema: quotaPolicySchema,
  defaults: { dailyLimit: 1000, warnAtPercent: 80 },
  requiredOnPut: false,
  merge: (current, patch) => ({ ...current, ...(patch ?? {}) }),
  org: {
    schema: quotaPolicySchema.pick({ dailyLimit: true }).partial(),
    merge: (system, org) => ({ ...system, dailyLimit: Math.min(system.dailyLimit, org.dailyLimit ?? system.dailyLimit) }),
    readPermission: 'org_settings:read',
    writePermission: 'org_settings:write',
  },
} satisfies SystemSettingsNamespace<'quotaPolicy', QuotaPolicyValue, Partial<QuotaPolicyValue>>;

const quotaViewSchema = z.object({ unit: z.enum(['count', 'percent']) });

/** The stored `quotaView` value. */
export type QuotaViewValue = z.infer<typeof quotaViewSchema>;

/** The optional user namespace `quotaView`: how the user prefers quota figures. */
export const QUOTA_VIEW_USER_SETTINGS = {
  key: 'quotaView',
  description: 'How a user prefers quota figures shown.',
  schema: quotaViewSchema,
  patchSchema: quotaViewSchema.partial(),
  merge: (current: QuotaViewValue | undefined, patch: Partial<QuotaViewValue> | null | undefined) => {
    if (patch === undefined) return current;
    if (patch === null) return undefined;
    const merged = { ...(current ?? {}), ...patch } as Partial<QuotaViewValue>;
    return merged.unit ? (merged as QuotaViewValue) : undefined;
  },
} satisfies UserSettingsNamespace<'quotaView', QuotaViewValue, Partial<QuotaViewValue>>;

/** The id the contribution registers under (the package name). */
export const QUOTA_CONTRIBUTION_ID = '@example/quota-settings';

registerSettingsContribution({
  id: QUOTA_CONTRIBUTION_ID,
  system: [QUOTA_SYSTEM_SETTINGS as SystemSettingsNamespace],
  user: [QUOTA_VIEW_USER_SETTINGS as UserSettingsNamespace],
  extensions: {
    system: [
      {
        key: 'telemetry',
        path: 'assistant',
        storedSchema: z.object({ citations: z.boolean() }),
        defaults: { citations: true },
      },
    ],
  },
});
