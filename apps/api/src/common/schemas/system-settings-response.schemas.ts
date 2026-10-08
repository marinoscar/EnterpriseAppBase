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

// #225, epic #215. Part of the represented resource, which is what makes a
// PUT that omits it meaningful (and rejected) rather than a client simply not
// knowing the field exists. Nothing enforces these values yet — that is #226.
export const notificationsResponseSchema = z.object({
  browserEnabled: z.boolean(),
  disabledEvents: z.array(z.string()),
});

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

// #423, epic #419, umbrella #418 — the AI platform policy, published for
// the same reason the operations namespaces and `storage` above are: a
// block this response omits is a block no client can echo back in a PUT.
//
// THERE IS NO API KEY FIELD AND THERE MUST NEVER BE ONE. A user's own key
// is `UserAiKey.secret`, in its own table; an org-wide fallback key belongs
// in the encrypted credential store. See
// `common/schemas/settings.schema.ts` for the full argument and its
// compile-time proof.
export const aiResponseSchema = z.object({
  enabled: z.boolean(),
  keyPolicy: z.enum(['byok', 'byok_with_org_fallback']),
  providers: z.object({
    openai: z.object({
      enabled: z.boolean(),
      baseUrl: z.string().optional(),
    }),
    anthropic: z.object({
      enabled: z.boolean(),
      baseUrl: z.string().optional(),
    }),
    gemini: z.object({
      enabled: z.boolean(),
      baseUrl: z.string().optional(),
    }),
    'azure-openai': z.object({
      enabled: z.boolean(),
      baseUrl: z.string().optional(),
      apiVersion: z.string().optional(),
      apiStyle: z.enum(['responses', 'chat_completions']).optional(),
      deployments: z.record(z.string(), z.string()).optional(),
    }),
    'openai-compatible': z.object({
      enabled: z.boolean(),
      baseUrl: z.string().optional(),
      apiStyle: z.enum(['responses', 'chat_completions']).optional(),
      requiresKey: z.boolean().optional(),
    }),
  }),
  defaults: z.object({
    maxOutputTokensCap: z.number().optional(),
    allowBackgroundRuns: z.boolean(),
    allowRealtime: z.boolean(),
  }),
  logPromptContent: z.boolean(),
  usageRetentionDays: z.number().int(),
  hostedTools: z.object({
    web_search: z.boolean(),
    file_search: z.boolean(),
    code_interpreter: z.boolean(),
    image_generation: z.boolean(),
    mcp: z.boolean(),
    mcpAllowedHosts: z.array(z.string()),
  }),
  limits: z.object({
    perUser: z
      .object({ requestsPerMinute: z.number().int().optional(), requestsPerDay: z.number().int().optional() })
      .optional(),
    orgKey: z
      .object({
        requestsPerDayPerUser: z.number().int().optional(),
        tokensPerDayPerUser: z.number().int().optional(),
      })
      .optional(),
    perModel: z
      .record(
        z.string(),
        z.object({
          maxOutputTokens: z.number().int().optional(),
          requestsPerMinutePerUser: z.number().int().optional(),
        }),
      )
      .optional(),
  }),
});

// #681 — the retention policy, one `{ enabled, days }` per governed table.
// Published for the same reason as every block above.
export const retentionResponseSchema = z.object({
  notifications: z.object({ enabled: z.boolean(), days: z.number().int() }),
  notificationDeliveries: z.object({ enabled: z.boolean(), days: z.number().int() }),
  auditEvents: z.object({ enabled: z.boolean(), days: z.number().int() }),
  aiRuns: z.object({ enabled: z.boolean(), days: z.number().int() }),
});
