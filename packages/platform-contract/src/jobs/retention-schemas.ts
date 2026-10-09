// =============================================================================
// Jobs: the `retention` system-settings namespace's schemas (issue #898)
// =============================================================================
//
// One `{ enabled, days }` policy per platform table that grows with every user
// action and had no retention at all: the in-app inbox (`notifications`), the
// delivery log (`notification_deliveries`), the admin audit trail
// (`audit_events`) and background AI runs (`ai_runs`, whose `request` column
// holds the user's full prompt, a privacy concern as much as a size one).
//
// The namespace declaration (`RETENTION_SYSTEM_SETTINGS`) and the nightly,
// enqueue-only scheduler are the jobs slice's (`@marinoscar/platform-api/jobs`);
// each purge handler is its table owner's. These are the schemas the
// declaration is built from, moved verbatim from the reference app's
// `common/schemas/` files, which re-export them. Every bound is unchanged, so
// the OpenAPI document of `/api/system-settings` is too.
//
// The stored, the wire and the response shapes RESTATE each other on purpose,
// as the `jobs` namespace's do (see `settings-schemas.ts`). NO `.default()`
// anywhere: the defaults live in the declaration, never in a parse.
// =============================================================================

import { z } from 'zod';

/**
 * Upper bound on any `retention.*.days`: ten years, as for every retention
 * field.
 *
 * @stability stable
 */
export const RETENTION_MAX_DAYS = 3650;

/**
 * The keys of the `retention` namespace, one per governed table, in the order
 * the stored JSON, the composed schemas and the scheduler's enqueues use.
 *
 * @stability stable
 */
export const RETENTION_POLICY_KEYS = ['notifications', 'notificationDeliveries', 'auditEvents', 'aiRuns'] as const;

/**
 * One table's retention policy, as stored: whether the purge runs and how many
 * days of rows it keeps.
 *
 * @stability stable
 */
export const retentionPolicySchema = z.object({
  /** Whether the purge runs for this table. */
  enabled: z.boolean(),
  /** Days of rows kept; older rows are purged. */
  days: z.number().int().min(1).max(RETENTION_MAX_DAYS),
});

/**
 * {@link retentionPolicySchema}'s value.
 *
 * @stability stable
 */
export type RetentionPolicyValue = z.infer<typeof retentionPolicySchema>;

/**
 * The `retention` namespace, as stored.
 *
 * @stability stable
 */
export const systemRetentionSchema = z.object({
  /** The in-app inbox (`notifications`). */
  notifications: retentionPolicySchema,
  /** The delivery log (`notification_deliveries`). */
  notificationDeliveries: retentionPolicySchema,
  /** The admin audit trail (`audit_events`); ships off. */
  auditEvents: retentionPolicySchema,
  /** Background AI runs (`ai_runs`). */
  aiRuns: retentionPolicySchema,
});

/**
 * {@link systemRetentionSchema}'s value.
 *
 * @stability stable
 */
export type SystemRetentionValue = z.infer<typeof systemRetentionSchema>;

/**
 * The keys of `retention`, one per governed table.
 *
 * @stability stable
 */
export type RetentionPolicyKey = keyof SystemRetentionValue;

const retentionPolicyPatchSchema = z.object({
  /** Whether the purge runs for this table. */
  enabled: z.boolean().optional(),
  /** Days of rows kept. */
  days: z.number().int().min(1).max(RETENTION_MAX_DAYS).optional(),
});

/**
 * `retention`, one level deep and field by field, as stored:
 * `{ "retention": { "auditEvents": { "enabled": true } } }` changes that one
 * leaf.
 *
 * @stability stable
 */
export const systemRetentionPatchSchema = z.object({
  /** The in-app inbox (`notifications`). */
  notifications: retentionPolicyPatchSchema.optional(),
  /** The delivery log (`notification_deliveries`). */
  notificationDeliveries: retentionPolicyPatchSchema.optional(),
  /** The admin audit trail (`audit_events`); ships off. */
  auditEvents: retentionPolicyPatchSchema.optional(),
  /** Background AI runs (`ai_runs`). */
  aiRuns: retentionPolicyPatchSchema.optional(),
});

/**
 * The `retention` branch of the PUT body.
 *
 * @stability stable
 */
export const retentionSettingsSchema = z.object({
  /** The in-app inbox (`notifications`). */
  notifications: retentionPolicySchema,
  /** The delivery log (`notification_deliveries`). */
  notificationDeliveries: retentionPolicySchema,
  /** The admin audit trail (`audit_events`); ships off. */
  auditEvents: retentionPolicySchema,
  /** Background AI runs (`ai_runs`). */
  aiRuns: retentionPolicySchema,
});

/**
 * The `retention` branch of the PATCH body: optional at the namespace level
 * and leaf by leaf inside.
 *
 * @stability stable
 */
export const retentionSettingsPatchSchema = z.object({
  /** The in-app inbox (`notifications`). */
  notifications: retentionPolicyPatchSchema.optional(),
  /** The delivery log (`notification_deliveries`). */
  notificationDeliveries: retentionPolicyPatchSchema.optional(),
  /** The admin audit trail (`audit_events`); ships off. */
  auditEvents: retentionPolicyPatchSchema.optional(),
  /** Background AI runs (`ai_runs`). */
  aiRuns: retentionPolicyPatchSchema.optional(),
});

/**
 * {@link retentionSettingsPatchSchema}'s value.
 *
 * @stability stable
 */
export type RetentionSettingsPatchInput = z.infer<typeof retentionSettingsPatchSchema>;

/**
 * The `retention` branch of the GET response: the OpenAPI-visible contract
 * only, so `days` carries no bounds.
 *
 * @stability stable
 */
export const retentionResponseSchema = z.object({
  /** The in-app inbox (`notifications`). */
  notifications: z.object({
    /** Whether the purge runs. */
    enabled: z.boolean(),
    /** Days of rows kept. */
    days: z.number().int(),
  }),
  /** The delivery log (`notification_deliveries`). */
  notificationDeliveries: z.object({
    /** Whether the purge runs. */
    enabled: z.boolean(),
    /** Days of rows kept. */
    days: z.number().int(),
  }),
  /** The admin audit trail (`audit_events`); ships off. */
  auditEvents: z.object({
    /** Whether the purge runs. */
    enabled: z.boolean(),
    /** Days of rows kept. */
    days: z.number().int(),
  }),
  /** Background AI runs (`ai_runs`). */
  aiRuns: z.object({
    /** Whether the purge runs. */
    enabled: z.boolean(),
    /** Days of rows kept. */
    days: z.number().int(),
  }),
});
