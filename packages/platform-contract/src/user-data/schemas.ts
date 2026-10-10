// =============================================================================
// The user-data slice's wire shapes (issue #743, PP-9.1)
// =============================================================================
//
// The routes of the per-user deletion (`/api/user-data/*`), the admin factory
// reset (`/api/admin/factory-reset/*`) and organization offboarding
// (`/api/admin/orgs/:orgId/offboarding/*`). Shared by
// `@marinoscar/platform-api/user-data` (which wraps them as DTOs, so the
// OpenAPI document is generated from them) and
// `@marinoscar/platform-web/user-data`.
//
// Categories and scopes are REGISTRIES, so their ids are strings here, never
// enums: an app adds its own. Count maps are keyed by category id (or model
// name) for the same reason.
//
// The deletion body's `confirmation` is a plain string on the wire: the API
// re-checks it against the scope's exact phrase with a zod literal built from
// the scope registry (a wrong phrase is a 400), because the phrase depends on
// the scope chosen. The factory reset's phrase is fixed, so it IS a literal
// here.
// =============================================================================

import { z } from 'zod';

import {
  FACTORY_RESET_CONFIRMATION,
  OFFBOARDING_USER_DISPOSITIONS,
  USER_DATA_JOB_STATUSES,
  USER_DATA_SCOPE_LAYERS,
} from './constants.js';

/**
 * The entries of the scope-layer enum.
 *
 * @stability experimental
 */
export type UserDataScopeLayerEnum = { [K in (typeof USER_DATA_SCOPE_LAYERS)[number]]: K };
/**
 * The entries of the job-status enum.
 *
 * @stability experimental
 */
export type UserDataJobStatusEnum = { [K in (typeof USER_DATA_JOB_STATUSES)[number]]: K };
/**
 * The entries of the user-disposition enum.
 *
 * @stability experimental
 */
export type OffboardingUserDispositionEnum = { [K in (typeof OFFBOARDING_USER_DISPOSITIONS)[number]]: K };

const count = z.number().int().nonnegative();
const counts = z.record(z.string(), count);

/**
 * A scope layer (`specific` or `danger`).
 *
 * @stability experimental
 */
export const userDataScopeLayerSchema: z.ZodEnum<UserDataScopeLayerEnum> = z.enum(USER_DATA_SCOPE_LAYERS);

/**
 * A job status as the status routes report it.
 *
 * @stability experimental
 */
export const userDataJobStatusSchema: z.ZodEnum<UserDataJobStatusEnum> = z.enum(USER_DATA_JOB_STATUSES);

/**
 * One category in `GET /api/user-data/summary`: what the caller owns in it.
 *
 * @stability experimental
 */
export const userDataCategorySummarySchema = z.object({
  /** The registered category id (`files`, `notifications`, an app's own). */
  id: z.string(),
  /** Shown in the UI. */
  label: z.string(),
  /** One sentence. */
  description: z.string(),
  /** Whether the built-in `content` scope includes it. */
  content: z.boolean(),
  /** Rows the caller owns in the category's models. */
  count,
  /** Stored bytes, when the category knows them (`files`); `null` otherwise. */
  bytes: count.nullable(),
});

/**
 * One scope in `GET /api/user-data/summary`.
 *
 * @stability experimental
 */
export const userDataScopeSchema = z.object({
  /** The scope id the deletion request names. Permanent once a job carried it. */
  id: z.string(),
  /** Shown in the UI. */
  label: z.string(),
  /** One sentence. */
  description: z.string(),
  /** Which layer of the Danger Zone renders it. */
  layer: userDataScopeLayerSchema,
  /** The exact phrase the request must carry. */
  confirmation: z.string(),
  /** The category ids it deletes, resolved (never `'all'` or `'content'`). */
  categories: z.array(z.string()),
});

/**
 * `GET /api/user-data/summary`.
 *
 * @stability experimental
 */
export const userDataSummarySchema = z.object({
  /** Per category. */
  categories: z.array(userDataCategorySummarySchema),
  /** Every scope the caller may request. */
  scopes: z.array(userDataScopeSchema),
});

/**
 * `POST /api/user-data/deletions` body. The phrase is re-checked against the
 * scope's own (`400` `CONFIRMATION_MISMATCH`); an unknown scope is a `400`
 * `UNKNOWN_SCOPE`.
 *
 * @stability experimental
 */
export const userDataDeletionRequestSchema = z.object({
  /** The scope id. */
  scope: z.string().min(1).max(64),
  /** The exact phrase. */
  confirmation: z.string().max(200),
});

/**
 * The `202` of every request route: the job (a new one, or the one already
 * in flight).
 *
 * @stability experimental
 */
export const userDataJobStartedSchema = z.object({
  /** The job. */
  jobId: z.string(),
  /** The job status. */
  status: userDataJobStatusSchema,
});

/**
 * What a finished per-user deletion did. Written by the job on
 * `payload.result`. Every map defaults to `{}`, so an older result still parses.
 *
 * @stability experimental
 */
export const userDataPurgeResultSchema = z.object({
  /** Rows deleted per category id. */
  categories: counts.default({}),
  /** Rows deleted per model name. */
  models: counts.default({}),
  /** Objects whose bytes and row were deleted. */
  storageObjectsDeleted: count.default(0),
  /** Objects the provider refused; their rows were kept (a later deletion retries them). */
  storageObjectsFailed: count.default(0),
  /** Pending jobs whose subject was a deleted row. */
  cancelledJobs: count.default(0),
  /** Jobs enqueued for categories delegated to another purge job. */
  delegatedJobs: count.default(0),
});

/**
 * `GET /api/user-data/deletions/:jobId`.
 *
 * @stability experimental
 */
export const userDataDeletionStatusSchema = z.object({
  /** The job. */
  jobId: z.string(),
  /** The job status. */
  status: userDataJobStatusSchema,
  /** The scope id. */
  scope: z.string(),
  /** The result, once succeeded (`null` otherwise). */
  result: userDataPurgeResultSchema.nullable(),
  /** The failure, once failed (`null` otherwise). */
  error: z.string().nullable(),
});

/**
 * `POST /api/admin/factory-reset` body: the exact phrase or a `400`.
 *
 * @stability experimental
 */
export const factoryResetRequestSchema = z.object({
  /** The exact phrase. */
  confirmation: z.literal(FACTORY_RESET_CONFIRMATION, {
    error: `Type exactly "${FACTORY_RESET_CONFIRMATION}" to confirm`,
  }),
});

/**
 * `GET /api/admin/factory-reset/summary`: deployment-wide counts of what a
 * factory reset deletes, and whether it is available.
 *
 * @stability experimental
 */
export const factoryResetSummarySchema = z.object({
  /** `null` when available; otherwise the error code the request route answers with. */
  disabledReason: z.string().nullable(),
  /** Every user except the caller. */
  otherUsers: count,
  /** Organizations other than the default one (multi-organization mode). */
  organizations: count,
  /** Storage objects that do not survive (outside every `survivesFactoryReset` prefix). */
  storageObjects: count,
  /** Pending and finished job rows that are not linked to a backup. */
  jobs: count,
  /** Rows per user-data category, across every user. */
  categories: z.array(
    z.object({
      /** The category id. */
      id: z.string(),
      /** Its label. */
      label: z.string(),
      /** Rows across every user. */
      count,
    }),
  ),
});

/**
 * What a finished factory reset did, on `payload.result`: flat counts, keyed
 * `users`, `jobs`, `workerNodesReassigned`, `workerNodesRemoved`,
 * `organizations`, `storageObjectsDeleted`, `storageObjectsFailed`,
 * `category.<id>` and `step.<stepId>.<key>`.
 *
 * @stability experimental
 */
export const factoryResetResultSchema = z.object({
  /** Flat counts (see the schema). */
  counts: counts.default({}),
});

/**
 * `GET /api/admin/factory-reset/:jobId`.
 *
 * @stability experimental
 */
export const factoryResetStatusSchema = z.object({
  /** The job. */
  jobId: z.string(),
  /** The job status. */
  status: userDataJobStatusSchema,
  /** The result, once succeeded (`null` otherwise). */
  result: factoryResetResultSchema.nullable(),
  /** The failure, once failed (`null` otherwise). */
  error: z.string().nullable(),
});

/**
 * A user disposition (`keep` or `purge`).
 *
 * @stability experimental
 */
export const offboardingUserDispositionSchema: z.ZodEnum<OffboardingUserDispositionEnum> = z.enum(
  OFFBOARDING_USER_DISPOSITIONS,
);

/**
 * `POST /api/admin/orgs/:orgId/offboarding` body. `confirmation` must be the
 * organization's slug; `skipExport.reason` skips every failing precondition
 * and is recorded in the audit event.
 *
 * @stability experimental
 */
export const orgOffboardingRequestSchema = z.object({
  /** The exact phrase. */
  confirmation: z.string().max(200),
  /** What happens to members left without an organization. */
  userDisposition: offboardingUserDispositionSchema.default('keep'),
  /** Skip every failing precondition, with a reason. */
  skipExport: z
    .object({
      /** Why, recorded in the audit event. */
      reason: z.string().trim().min(3).max(500),
    })
    .optional(),
});

/**
 * One precondition's verdict in the offboarding summary (and in a `409`).
 *
 * @stability experimental
 */
export const offboardingPreconditionResultSchema = z.object({
  /** The id. */
  id: z.string(),
  /** Shown in the UI. */
  label: z.string(),
  /** Whether it passed. */
  passed: z.boolean(),
  /** Why not, or `null`. */
  message: z.string().nullable(),
});

/**
 * `GET /api/admin/orgs/:orgId/offboarding/summary`.
 *
 * @stability experimental
 */
export const orgOffboardingSummarySchema = z.object({
  /** The organization. */
  org: z.object({
    /** Its id. */
    id: z.string(),
    /** Its name. */
    name: z.string(),
    /** Its slug: the confirmation phrase. */
    slug: z.string(),
    /** Whether it is the default organization (never offboarded). */
    isDefault: z.boolean(),
  }),
  /** `null` when offboarding is possible; otherwise the error code the request answers with. */
  blockedReason: z.string().nullable(),
  /** Org-owned rows per model. */
  models: counts,
  /** Its memberships. */
  members: count,
  /** Its invitations. */
  invites: count,
  /** Stored files that go. */
  storageObjects: count,
  /** Members with no other membership: the users `userDisposition` decides about. */
  usersLeftWithoutOrg: count,
  /** Every registered precondition with its verdict. */
  preconditions: z.array(offboardingPreconditionResultSchema),
});

/**
 * What a finished offboarding did, on `payload.result`: flat counts keyed by
 * model name plus `jobs`, `memberships`, `invites`, `storageObjectsDeleted`,
 * `storageObjectsFailed`, `usersKept`, `usersPurged` and `organizations`.
 *
 * @stability experimental
 */
export const orgOffboardingResultSchema = z.object({
  /** Flat counts (see the schema). */
  counts: counts.default({}),
});

/**
 * `GET /api/admin/orgs/:orgId/offboarding/:jobId`.
 *
 * @stability experimental
 */
export const orgOffboardingStatusSchema = z.object({
  /** The job. */
  jobId: z.string(),
  /** The job status. */
  status: userDataJobStatusSchema,
  /** The result, once succeeded (`null` otherwise). */
  result: orgOffboardingResultSchema.nullable(),
  /** The failure, once failed (`null` otherwise). */
  error: z.string().nullable(),
});

/** @stability experimental */
export type UserDataCategorySummary = z.infer<typeof userDataCategorySummarySchema>;
/** @stability experimental */
export type UserDataScope = z.infer<typeof userDataScopeSchema>;
/** @stability experimental */
export type UserDataSummary = z.infer<typeof userDataSummarySchema>;
/** @stability experimental */
export type UserDataDeletionRequest = z.infer<typeof userDataDeletionRequestSchema>;
/** @stability experimental */
export type UserDataJobStarted = z.infer<typeof userDataJobStartedSchema>;
/** @stability experimental */
export type UserDataPurgeResult = z.infer<typeof userDataPurgeResultSchema>;
/** @stability experimental */
export type UserDataDeletionStatus = z.infer<typeof userDataDeletionStatusSchema>;
/** @stability experimental */
export type FactoryResetRequest = z.infer<typeof factoryResetRequestSchema>;
/** @stability experimental */
export type FactoryResetSummary = z.infer<typeof factoryResetSummarySchema>;
/** @stability experimental */
export type FactoryResetResult = z.infer<typeof factoryResetResultSchema>;
/** @stability experimental */
export type FactoryResetStatus = z.infer<typeof factoryResetStatusSchema>;
/** @stability experimental */
export type OrgOffboardingRequest = z.input<typeof orgOffboardingRequestSchema>;
/** @stability experimental */
export type OffboardingPreconditionResult = z.infer<typeof offboardingPreconditionResultSchema>;
/** @stability experimental */
export type OrgOffboardingSummary = z.infer<typeof orgOffboardingSummarySchema>;
/** @stability experimental */
export type OrgOffboardingResult = z.infer<typeof orgOffboardingResultSchema>;
/** @stability experimental */
export type OrgOffboardingStatus = z.infer<typeof orgOffboardingStatusSchema>;
