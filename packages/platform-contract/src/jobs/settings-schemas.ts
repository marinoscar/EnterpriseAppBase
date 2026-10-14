// =============================================================================
// Jobs: the `jobs` system-settings namespace's schemas (issue #865)
// =============================================================================
//
// The five schemas the namespace declaration of `@marinoscar/platform-api/jobs`
// (`JOBS_SYSTEM_SETTINGS`) is built from: the stored value and its partial,
// the PUT and PATCH wire branches, and the GET response branch. Moved verbatim
// from the reference app's `common/schemas/settings.schema.ts`,
// `system-settings-wire.schemas.ts` and `system-settings-response.schemas.ts`,
// which re-export them. Every bound is unchanged, so the OpenAPI document of
// `/api/system-settings` is too.
//
// The stored and the wire schemas RESTATE each other on purpose: the wire ones
// are the OpenAPI-visible request bodies, the stored ones what the service
// validates on the way in. NO `.default()` anywhere: the defaults live in the
// declaration (`DEFAULT_JOBS_POLICY` of the jobs slice), never in a parse.
// =============================================================================

import { z } from 'zod';

/**
 * Job-queue policy (`jobs`), as stored.
 *
 * `history` is nested rather than flattened because retention and the purge
 * switch are one decision. `stuckThresholdMinutes` is how long a claimed job
 * may go without progress before the queue treats it as abandoned; bounded at
 * a week, since a longer threshold is indistinguishable from "never reap".
 *
 * @stability stable
 */
export const systemJobsSchema = z.object({
  /** Finished-job history. */
  history: z.object({
    /** Days a finished job is kept before the purge removes it. */
    retentionDays: z.number().int().min(1).max(3650),
    /** Whether the nightly purge runs at all. */
    purgeEnabled: z.boolean(),
  }),
  /** Minutes a claimed job may go without progress before the reaper treats it as abandoned. */
  stuckThresholdMinutes: z.number().int().min(1).max(10080),
});

/**
 * The stored `jobs` value.
 *
 * @stability stable
 */
export type SystemJobsValue = z.infer<typeof systemJobsSchema>;

/**
 * The stored partial of `jobs`: one level deep, every field optional, every
 * bound the stored schema's.
 *
 * @stability stable
 */
export const systemJobsPatchSchema = z.object({
  /** Finished-job history. */
  history: z
    .object({
      /** Days a finished job is kept. */
      retentionDays: z.number().int().min(1).max(3650).optional(),
      /** Whether the nightly purge runs. */
      purgeEnabled: z.boolean().optional(),
    })
    .optional(),
  /** Minutes before a claimed job counts as stuck. */
  stuckThresholdMinutes: z.number().int().min(1).max(10080).optional(),
});

/**
 * The `jobs` branch of the `PUT /api/system-settings` body. Optional in the
 * body: a PUT that omits it keeps the stored value.
 *
 * @stability stable
 */
export const jobsSettingsSchema = z.object({
  /** Finished-job history. */
  history: z.object({
    /** Days a finished job is kept. */
    retentionDays: z.number().int().min(1).max(3650),
    /** Whether the nightly purge runs. */
    purgeEnabled: z.boolean(),
  }),
  /** Minutes before a claimed job counts as stuck. */
  stuckThresholdMinutes: z.number().int().min(1).max(10080),
});

/**
 * The `jobs` branch of the `PATCH /api/system-settings` body: optional at the
 * namespace level and field by field inside, so
 * `{ "jobs": { "history": { "purgeEnabled": false } } }` is a legal body.
 *
 * @stability stable
 */
export const jobsSettingsPatchSchema = z.object({
  /** Finished-job history. */
  history: z
    .object({
      /** Days a finished job is kept. */
      retentionDays: z.number().int().min(1).max(3650).optional(),
      /** Whether the nightly purge runs. */
      purgeEnabled: z.boolean().optional(),
    })
    .optional(),
  /** Minutes before a claimed job counts as stuck. */
  stuckThresholdMinutes: z.number().int().min(1).max(10080).optional(),
});

/**
 * The parsed `jobs` branch of a PATCH body, as the namespace's merge receives it.
 *
 * @stability stable
 */
export type JobsSettingsPatchInput = z.infer<typeof jobsSettingsPatchSchema>;

/**
 * The `jobs` branch of the `GET /api/system-settings` response (the OpenAPI
 * contract).
 *
 * @stability stable
 */
export const jobsResponseSchema = z.object({
  /** Finished-job history. */
  history: z.object({
    /** Days a finished job is kept. */
    retentionDays: z.number(),
    /** Whether the nightly purge runs. */
    purgeEnabled: z.boolean(),
  }),
  /** Minutes before a claimed job counts as stuck. */
  stuckThresholdMinutes: z.number(),
});
