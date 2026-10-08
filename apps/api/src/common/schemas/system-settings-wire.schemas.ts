// =============================================================================
// System settings request-body branches, one per namespace (issue #677)
// =============================================================================
//
// A LEAF FILE: it imports only zod and the per-namespace constants and
// schemas of `common/schemas/settings.schema.ts`, never a composed object.
// Each namespace's declaration file (`<module>.system-settings.ts`) names its
// PUT branch (`putSchema`) and PATCH branch (`wirePatchSchema`) from here,
// and `update-system-settings.dto.ts` composes the request bodies from the
// settings namespace registry (`settings/registry/`). Importing a composed
// object here would close an import cycle through the registry's manifest.
//
// The branches were the private consts of `update-system-settings.dto.ts`,
// moved verbatim (the PATCH branches were inline in its `z.object`).
// =============================================================================

import { z } from 'zod';
import {
  BACKUP_TIME_OF_DAY_PATTERN,
  TELEMETRY_INSTANCE_ID_PATTERN,
  RETENTION_MAX_DAYS,
} from './settings.schema';

// The request-body schemas deliberately RESTATE `common/schemas/settings.schema.ts`
// rather than importing it: these are the OpenAPI-visible DTOs (`createZodDto`
// reads them to build the documented request schema) and the service validates
// against the shared schema again on the way in. Both copies must move together
// — `notifications` (#225) is the block that most recently did.

// `notificationsSettingsSchema` (the PUT branch) and its PATCH form are the
// notifications slice's wire contract since #738; re-exported below.

// =============================================================================
// Operations namespaces on the wire (#256, epic #254)
// =============================================================================
//
// THIS FILE IS THE TRAP THE PARITY GUARD EXISTS FOR. A namespace that reaches
// `systemSettingsSchema` but not the two schemas below is not a validation
// error — it is a SILENT one. The global `ZodValidationPipe` parses the body
// against these schemas first and strips every key they do not declare, so the
// service is handed a body with the caller's change already deleted and
// cheerfully writes the unchanged value back. `common/schemas/settings-parity.spec.ts`
// fails the build when that happens; read its header before editing anything
// here.
//
// WHY THESE FOUR ARE OPTIONAL IN THE PUT BODY WHILE `notifications` IS REQUIRED.
// The rule `notifications` (#225) established is right and unchanged: a PUT
// that omits a modelled block must not silently reset it. The two cases differ
// in who is sending the body. `notifications` shipped together with the admin
// UI that sends it, so requiring it broke nothing and caught real omissions.
// These four ship AHEAD of every consumer, so requiring them would 400 every
// PUT from every client that exists today — including this repo's own settings
// page — the moment this issue merges. That is exactly the "changes behaviour
// for a deployment that has never saved these keys" outcome the issue rules
// out.
//
// SO WHAT STOPS THE SILENT RESET? `replaceSettings` carries an omitted block
// forward from the stored value instead of letting it fall back to the
// defaults — the same rule that file already applies to keys it does not model
// at all, and it is derived from THIS schema (the keys that accept
// `undefined`), not from a second hand-written list. A PUT can therefore change
// these namespaces, but cannot erase them by not mentioning them. When a UI for
// one of them lands and every client is sending it, promoting that block to
// required here is a one-line change with a test that already covers it.

export const jobsSettingsSchema = z.object({
  history: z.object({
    retentionDays: z.number().int().min(1).max(3650),
    purgeEnabled: z.boolean(),
  }),
  stuckThresholdMinutes: z.number().int().min(1).max(10080),
});

export const nodesSettingsSchema = z.object({
  staleHeartbeatSeconds: z.number().int().min(5).max(86400),
  offlineStaleMultiplier: z.number().int().min(1).max(100),
  offlineRetentionDays: z.number().int().min(1).max(3650),
  jobSecretBrokerEnabled: z.boolean(),
});

// The `databaseBackup` branches live in `@marinoscar/platform-contract/db-backup`
// since #740, re-exported unchanged.
export { databaseBackupSettingsPatchSchema, databaseBackupSettingsSchema } from '@marinoscar/platform-contract/db-backup';

export const maintenanceSettingsSchema = z.object({
  enabled: z.boolean(),
  message: z.string().min(1).max(1000),
  allowAdmins: z.boolean(),
  startedAt: z.iso.datetime().nullable(),
  startedById: z.string().uuid().nullable(),
});

// Storage provider configuration on the wire (#373): `storageSettingsSchema`
// and `storageSettingsPatchSchema` live in `@marinoscar/platform-contract/storage`
// since #736, re-exported here unchanged.
export { storageSettingsPatchSchema, storageSettingsSchema } from '@marinoscar/platform-contract/storage';

// AI platform policy on the wire (#423; in `@marinoscar/platform-contract/ai`
// since #739): the PUT and PATCH branches and the shared `limits` block.
export {
  aiLimitValueSchema,
  aiLimitsSettingsSchema,
  aiSettingsPatchSchema,
  aiSettingsSchema,
} from '@marinoscar/platform-contract/ai';


// =============================================================================
// Telemetry policy on the wire (epic #528, story #533)
// =============================================================================
//
// Restated here rather than imported, for the reason at the top of this file.
// Optional in the PUT body like every other namespace that ships ahead of its
// own client, and for the identical reason.
//
// NO CREDENTIAL FIELD, ON EITHER SCHEMA, EVER. The AI assistant's provider key
// is resolved the same way every other AI call resolves one — through
// `AiKeyResolver` — never through this document. See
// `common/schemas/settings.schema.ts`, which carries the argument and a
// compile-time proof of the absence.
//
// Bounds mirror `systemTelemetrySchema` exactly.

export const telemetryInstanceIdSchema = z.string().regex(TELEMETRY_INSTANCE_ID_PATTERN);

export const telemetrySettingsSchema = z.object({
  enabled: z.boolean(),
  retentionDays: z.number().int().min(1).max(3650),
  // #565 — `null` follows `APP_SLUG`; see `systemTelemetrySchema`.
  instanceId: telemetryInstanceIdSchema.nullable(),
  query: z.object({
    maxRows: z.number().int().min(1).max(100000),
    timeoutSeconds: z.number().int().min(1).max(120),
  }),
  assistant: z.object({
    enabled: z.boolean(),
    provider: z.string().nullable(),
    modelId: z.string().nullable(),
    shareResults: z.boolean(),
    maxResultRowsToModel: z.number().int().min(1).max(100),
    maxSteps: z.number().int().min(1).max(20),
  }),
});

// =============================================================================
// Retention policy on the wire (#681)
// =============================================================================
//
// Restated here rather than imported, for the reason at the top of this file.
// Optional in the PUT body like every namespace that ships ahead of its own
// client. Bounds mirror `systemRetentionSchema` exactly.

export const retentionPolicySettingsSchema = z.object({
  enabled: z.boolean(),
  days: z.number().int().min(1).max(RETENTION_MAX_DAYS),
});

export const retentionSettingsSchema = z.object({
  notifications: retentionPolicySettingsSchema,
  notificationDeliveries: retentionPolicySettingsSchema,
  auditEvents: retentionPolicySettingsSchema,
  aiRuns: retentionPolicySettingsSchema,
});

export const retentionPolicyPatchSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  days: z.number().int().min(1).max(RETENTION_MAX_DAYS).optional(),
});

// =============================================================================
// PATCH (partial update) branches
// =============================================================================
//
// Optional at the namespace level (the composed PATCH body adds `.optional()`
// to each) and field by field inside.


// Optional at the namespace level and field by field inside, so that
// `{ "databaseBackup": { "enabled": true } }` is a legal body. If this line
// is missing, that body parses to `{}` and the PATCH is a no-op that returns
// 200 — the defect `settings-parity.spec.ts` and
// `test/settings/system-settings.integration.spec.ts` both pin.
export const jobsSettingsPatchSchema = z.object({
  history: z
    .object({
      retentionDays: z.number().int().min(1).max(3650).optional(),
      purgeEnabled: z.boolean().optional(),
    })
    .optional(),
  stuckThresholdMinutes: z.number().int().min(1).max(10080).optional(),
});

export const nodesSettingsPatchSchema = z.object({
  staleHeartbeatSeconds: z.number().int().min(5).max(86400).optional(),
  offlineStaleMultiplier: z.number().int().min(1).max(100).optional(),
  offlineRetentionDays: z.number().int().min(1).max(3650).optional(),
  jobSecretBrokerEnabled: z.boolean().optional(),
});

// `databaseBackupSettingsPatchSchema`: re-exported above from the contract (#740).

// `startedAt` and `startedById` are `.nullable().optional()`: `null` clears
// the window's provenance, absent leaves it alone. The service's merge
// distinguishes the two with `!== undefined` rather than `??`, which would
// collapse them and make "clear it" impossible to express.
export const maintenanceSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  message: z.string().min(1).max(1000).optional(),
  allowAdmins: z.boolean().optional(),
  startedAt: z.iso.datetime().nullable().optional(),
  startedById: z.string().uuid().nullable().optional(),
});


// Epic #528, story #533. Optional at the namespace level and field by field
// inside, one level into `query` and `assistant`, matching `ai` above —
// `{ "telemetry": { "enabled": true } }` must be a legal body. Absent
// leaves `assistant.provider`/`assistant.modelId` alone; explicit `null`
// clears either back to "not configured" — see `systemTelemetryPatchSchema`.
export const telemetrySettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
  // #565 — absent leaves it alone, `null` returns to the `APP_SLUG` default.
  instanceId: telemetryInstanceIdSchema.nullable().optional(),
  query: z
    .object({
      maxRows: z.number().int().min(1).max(100000).optional(),
      timeoutSeconds: z.number().int().min(1).max(120).optional(),
    })
    .optional(),
  assistant: z
    .object({
      enabled: z.boolean().optional(),
      provider: z.string().nullable().optional(),
      modelId: z.string().nullable().optional(),
      shareResults: z.boolean().optional(),
      maxResultRowsToModel: z.number().int().min(1).max(100).optional(),
      maxSteps: z.number().int().min(1).max(20).optional(),
    })
    .optional(),
});

// #681. Optional at the namespace level and leaf by leaf inside, so
// `{ "retention": { "auditEvents": { "enabled": true } } }` is a legal body
// that changes only that leaf.
export const retentionSettingsPatchSchema = z.object({
  notifications: retentionPolicyPatchSettingsSchema.optional(),
  notificationDeliveries: retentionPolicyPatchSettingsSchema.optional(),
  auditEvents: retentionPolicyPatchSettingsSchema.optional(),
  aiRuns: retentionPolicyPatchSettingsSchema.optional(),
});

// The `notifications` branches of the PUT and PATCH bodies (#225), the wire
// contract of the notifications slice since #738.
export {
  notificationsSettingsPatchSchema,
  notificationsSettingsSchema,
} from '@marinoscar/platform-contract/notifications';
