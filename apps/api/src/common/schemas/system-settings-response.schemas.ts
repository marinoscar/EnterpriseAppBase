// =============================================================================
// System settings response branches, one per namespace (issue #677)
// =============================================================================
//
// A LEAF FILE: zod only, never a composed object. Each namespace's declaration
// file names its branch here (`responseSchema`), and
// `system-settings-response.dto.ts` composes the response from the settings
// namespace registry, after the `security` core field. Moved verbatim from
// that DTO's `z.object`.
//
// These branches are the OpenAPI-visible contract only: `SystemSettingsService
// .toResponse` projects every registered namespace, documented here or not.
// =============================================================================

import { z } from 'zod';

// #225, epic #215: the `notifications` response branch, the notifications
// slice's wire contract since #738.
export { notificationsResponseSchema } from '@marinoscar/platform-contract/notifications';

// #256, epic #254 — the operations namespaces. Published from the day they
// exist rather than the day something reads them: a block the response omits
// is a block no client can echo back in a PUT, which would leave
// `replaceSettings` carrying it forward blind forever. Restated here rather
// than imported for the same reason the request bodies are — this is the
// OpenAPI-visible contract — and kept in step by
// `common/schemas/settings-parity.spec.ts`.
export const jobsResponseSchema = z.object({
  history: z.object({
    retentionDays: z.number(),
    purgeEnabled: z.boolean(),
  }),
  stuckThresholdMinutes: z.number(),
});

export const nodesResponseSchema = z.object({
  staleHeartbeatSeconds: z.number(),
  offlineStaleMultiplier: z.number(),
  offlineRetentionDays: z.number(),
  jobSecretBrokerEnabled: z.boolean(),
});

export const databaseBackupResponseSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  dayOfWeek: z.number(),
  dayOfMonth: z.number(),
  timeOfDay: z.string(),
  timezone: z.string(),
  retentionCount: z.number(),
  storageProvider: z.string(),
  runStaleMinutes: z.number(),
  compressionLevel: z.number(),
  restoreRollbackMode: z.enum(['retain_database', 'drop_database']),
  oldDatabaseRetentionHours: z.number(),
  nodeOffloadEnabled: z.boolean(),
});

export const maintenanceResponseSchema = z.object({
  enabled: z.boolean(),
  message: z.string(),
  allowAdmins: z.boolean(),
  startedAt: z.string().nullable(),
  startedById: z.string().nullable(),
});

// #373: the storage provider configuration's branch lives in
// `@marinoscar/platform-contract/storage` since #736, re-exported unchanged.
export { storageResponseSchema } from '@marinoscar/platform-contract/storage';

// #423 — the AI platform policy's response branch, in
// `@marinoscar/platform-contract/ai` since #739.
export { aiResponseSchema } from '@marinoscar/platform-contract/ai';


// #681 — the retention policy, one `{ enabled, days }` per governed table.
// Published for the same reason as every block above.
export const retentionResponseSchema = z.object({
  notifications: z.object({ enabled: z.boolean(), days: z.number().int() }),
  notificationDeliveries: z.object({ enabled: z.boolean(), days: z.number().int() }),
  auditEvents: z.object({ enabled: z.boolean(), days: z.number().int() }),
  aiRuns: z.object({ enabled: z.boolean(), days: z.number().int() }),
});
