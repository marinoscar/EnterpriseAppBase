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
 * Lower bound on any `retention.*.days`: one day.
 *
 * @stability experimental
 */
export const RETENTION_MIN_DAYS = 1;

/**
 * The platform's own `retention` keys, one per governed table, in the order
 * the stored JSON, the composed schemas and the scheduler's enqueues use. An
 * app adds policies of its own with `registerRetentionPolicy`
 * (`@marinoscar/platform-api/jobs`); they follow these four.
 *
 * @stability stable
 */
export const BUILTIN_RETENTION_POLICY_KEYS = ['notifications', 'notificationDeliveries', 'auditEvents', 'aiRuns'] as const;

/**
 * The platform's four `retention` keys, under their original name.
 *
 * @deprecated Use {@link BUILTIN_RETENTION_POLICY_KEYS}; the namespace is open and an app's registered policies are not listed here.
 * @stability stable
 */
export const RETENTION_POLICY_KEYS = BUILTIN_RETENTION_POLICY_KEYS;

/**
 * What a retention policy key must look like: lower-case letter first, then
 * letters and digits, 2 to 48 characters (the shape of a settings namespace
 * field, so it is also a safe JSON key and a safe log token).
 *
 * @stability experimental
 */
export const RETENTION_POLICY_KEY_PATTERN = /^[a-z][A-Za-z0-9]{1,47}$/;

/**
 * A retention policy key: a built-in or an app's registered one.
 *
 * @stability experimental
 */
export const retentionPolicyKeySchema = z
  .string()
  .regex(RETENTION_POLICY_KEY_PATTERN, 'A retention policy key is 2 to 48 letters and digits, starting with a lower-case letter');

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
 * One of the platform's four `retention` keys.
 *
 * @stability stable
 */
export type BuiltinRetentionPolicyKey = keyof SystemRetentionValue;

/**
 * The keys of `retention`: a built-in (autocompleted) or an app's registered
 * policy.
 *
 * @stability experimental
 */
export type RetentionPolicyKey = BuiltinRetentionPolicyKey | (string & {});

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

/**
 * One policy's bounds, as {@link buildRetentionSchemas} needs them.
 *
 * @stability experimental
 */
export interface RetentionSchemaPolicy {
  /** The `retention` key. */
  key: string;
  /** Smallest `days`. Defaults to {@link RETENTION_MIN_DAYS}. */
  minDays?: number | undefined;
  /** Largest `days`. Defaults to {@link RETENTION_MAX_DAYS}. */
  maxDays?: number | undefined;
}

/**
 * The five `retention` branches {@link buildRetentionSchemas} composes.
 *
 * @stability experimental
 */
export interface RetentionSchemas {
  /** The namespace as stored (every policy, each `{ enabled, days }`). */
  stored: z.ZodObject<z.ZodRawShape>;
  /** The stored partial: every policy optional and leaf-optional. */
  patch: z.ZodObject<z.ZodRawShape>;
  /** The PUT branch (same shape as `stored`). */
  put: z.ZodObject<z.ZodRawShape>;
  /** The PATCH branch (same shape as `patch`). */
  wirePatch: z.ZodObject<z.ZodRawShape>;
  /** The GET response branch: `days` carries no bounds. */
  response: z.ZodObject<z.ZodRawShape>;
}

/**
 * Composes the `retention` namespace's five schemas from a list of policies,
 * in list order. Called with the four built-ins it yields schemas equal to
 * {@link systemRetentionSchema} and its siblings (a contract test pins the
 * JSON Schema), so the OpenAPI document is unchanged until an app registers a
 * policy. No `.default()`: the defaults live in the declaration.
 *
 * Unknown keys in a body are stripped, never stored: a policy that is not
 * registered cannot be written.
 *
 * @param policies - the policies, in the order the stored JSON uses.
 * @returns the five branches.
 * @throws Error when a key repeats or is not a valid policy key, or when a policy's bounds are not 1 <= min <= max <= {@link RETENTION_MAX_DAYS}.
 *
 * @stability experimental
 */
export function buildRetentionSchemas(policies: readonly RetentionSchemaPolicy[]): RetentionSchemas {
  const stored: Record<string, z.ZodType> = {};
  const patch: Record<string, z.ZodType> = {};
  const response: Record<string, z.ZodType> = {};

  for (const policy of policies) {
    const min = policy.minDays ?? RETENTION_MIN_DAYS;
    const max = policy.maxDays ?? RETENTION_MAX_DAYS;
    if (!RETENTION_POLICY_KEY_PATTERN.test(policy.key)) {
      throw new Error(`"${policy.key}" is not a valid retention policy key.`);
    }
    if (policy.key in stored) throw new Error(`Retention policy "${policy.key}" appears twice.`);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < RETENTION_MIN_DAYS || max > RETENTION_MAX_DAYS || min > max) {
      throw new Error(
        `Retention policy "${policy.key}" needs whole-day bounds with ${RETENTION_MIN_DAYS} <= minDays <= maxDays <= ${RETENTION_MAX_DAYS}.`,
      );
    }

    const days = z.number().int().min(min).max(max);
    stored[policy.key] = z.object({ enabled: z.boolean(), days });
    patch[policy.key] = z.object({ enabled: z.boolean().optional(), days: days.optional() }).optional();
    response[policy.key] = z.object({ enabled: z.boolean(), days: z.number().int() });
  }

  return {
    stored: z.object(stored),
    patch: z.object(patch),
    put: z.object(stored),
    wirePatch: z.object(patch),
    response: z.object(response),
  };
}
