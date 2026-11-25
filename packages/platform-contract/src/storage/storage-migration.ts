import { z } from 'zod';

import {
  STORAGE_DRIVER_ID_PATTERN,
  STORAGE_MIGRATION_RUN_STATUSES,
  type StorageEnum,
} from './constants.js';

// =============================================================================
// /api/admin/storage/migrations — copy-only provider migration (issue #1093)
// =============================================================================
//
// An administrator copies every `ready` object recorded on one storage driver
// to another. Each object is copied (streamed, never buffered), verified (its
// size and the sha256 of the bytes read BACK from the target), and only then
// is its row repointed; the source object is left where it was, as a fallback.
// One run at a time: a start while one is pending or running is a 409 naming
// it at `details.activeRunId`.
// =============================================================================

/**
 * The `POST /api/admin/storage/migrations` body: the driver to copy from and
 * the driver to copy to (registered driver ids, `s3`, `r2`, ...). They differ.
 *
 * @stability experimental
 */
export const startStorageMigrationSchema = z
  .object({
    /** The driver whose objects are copied (`storage_objects.storage_provider`). */
    sourceProvider: z.string().regex(STORAGE_DRIVER_ID_PATTERN),
    /** The driver they are copied to; it must be configured. */
    targetProvider: z.string().regex(STORAGE_DRIVER_ID_PATTERN),
  })
  .strict()
  .refine((body) => body.sourceProvider !== body.targetProvider, {
    message: 'sourceProvider and targetProvider must differ',
    path: ['targetProvider'],
  });

/**
 * The start body, parsed.
 *
 * @stability experimental
 */
export type StartStorageMigrationInput = z.infer<typeof startStorageMigrationSchema>;

/**
 * One migration run as the admin routes return it. The counts are recomputed
 * from the run's items on every read; `pendingCount` is what is still queued
 * or being copied.
 *
 * @stability experimental
 */
export const storageMigrationRunSchema = z.object({
  /** The run id (UUID). */
  id: z.string().uuid(),
  /** The driver copied from. */
  sourceProvider: z.string(),
  /** The driver copied to. */
  targetProvider: z.string(),
  /** Where the run is in its lifecycle. */
  status: z.enum(STORAGE_MIGRATION_RUN_STATUSES) as z.ZodEnum<StorageEnum<typeof STORAGE_MIGRATION_RUN_STATUSES>>,
  /** Objects the run took on (0 until the planner has listed them). */
  totalCount: z.number().int().nonnegative(),
  /** Copied, verified and repointed. */
  migratedCount: z.number().int().nonnegative(),
  /** Gave up. */
  failedCount: z.number().int().nonnegative(),
  /** Nothing to do (deleted, moved, already on the target, or the run was cancelled). */
  skippedCount: z.number().int().nonnegative(),
  /** Still queued or being copied. */
  pendingCount: z.number().int().nonnegative(),
  /** The administrator who started it, or `null` once that user was deleted. */
  startedById: z.string().uuid().nullable(),
  /** When the planner began (ISO 8601), or `null` while pending. */
  startedAt: z.string().nullable(),
  /** When the planner had queued every object, or `null`. */
  plannedAt: z.string().nullable(),
  /** When it finished (ISO 8601), or `null`. */
  finishedAt: z.string().nullable(),
  /** When it was cancelled (ISO 8601), or `null`. */
  cancelledAt: z.string().nullable(),
  /** The last error an item or the planner recorded, or `null`. */
  lastError: z.string().nullable(),
  /** Creation (ISO 8601). */
  createdAt: z.string(),
});

/**
 * One migration run.
 *
 * @stability experimental
 */
export type StorageMigrationRun = z.infer<typeof storageMigrationRunSchema>;

/**
 * The `GET /api/admin/storage/migrations` query: page and page size, newest first.
 *
 * @stability experimental
 */
export const storageMigrationListQuerySchema = z.object({
  /** The page, 1-based. */
  page: z.coerce.number().int().positive().default(1),
  /** Runs per page (at most 100). */
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

/**
 * The list query, parsed (defaults applied).
 *
 * @stability experimental
 */
export type StorageMigrationListQuery = z.infer<typeof storageMigrationListQuerySchema>;

/**
 * The `GET /api/admin/storage/migrations` payload: one page of runs, newest first.
 *
 * @stability experimental
 */
export const storageMigrationRunListSchema = z.object({
  /** The page's runs. */
  items: z.array(storageMigrationRunSchema),
  /** The page's position in the list. */
  meta: z.object({
    /** The page, 1-based. */
    page: z.number().int().positive(),
    /** Runs per page. */
    pageSize: z.number().int().positive(),
    /** Runs across pages. */
    totalItems: z.number().int().nonnegative(),
    /** How many pages there are. */
    totalPages: z.number().int().nonnegative(),
  }),
});

/**
 * One page of runs.
 *
 * @stability experimental
 */
export type StorageMigrationRunList = z.infer<typeof storageMigrationRunListSchema>;
