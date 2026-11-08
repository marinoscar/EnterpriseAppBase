// =============================================================================
// Copy-only storage provider migration: the permanent strings (issue #1093)
// =============================================================================

import { registerSystemAccessReason, systemAccessReasonRegistry } from '../../core/index';
import { HOUSEKEEPING_PRIORITY } from '../../jobs/index';

/**
 * The job type that lists a run's objects, creates one item per object and
 * queues one {@link STORAGE_MIGRATE_OBJECT_TYPE} job per item. PERMANENT:
 * rows outlive handlers. Server-only (no `nodeResultSchema`).
 *
 * @stability experimental
 */
export const STORAGE_MIGRATE_PLAN_TYPE = 'storage.migrate_plan';

/**
 * The job type that copies ONE object to the run's target driver, verifies it
 * and repoints its row. PERMANENT. Server-only: it needs both drivers' secrets,
 * which are never brokered to a worker node.
 *
 * @stability experimental
 */
export const STORAGE_MIGRATE_OBJECT_TYPE = 'storage.migrate_object';

/**
 * The `subjectType` of a planner job (`subjectId` is the run id).
 *
 * @stability experimental
 */
export const STORAGE_MIGRATION_RUN_SUBJECT_TYPE = 'storage_migration_run';

/**
 * The `subjectType` of a per-object job (`subjectId` is the item id).
 *
 * @stability experimental
 */
export const STORAGE_MIGRATION_ITEM_SUBJECT_TYPE = 'storage_migration_item';

/**
 * The queue priority of both job types: background, the housekeeping value,
 * so a migration never delays an upload's processing.
 *
 * @stability experimental
 */
export const STORAGE_MIGRATION_PRIORITY: number = HOUSEKEEPING_PRIORITY;

/**
 * The raw-SQL partial unique index that allows one pending or running run.
 *
 * @stability experimental
 */
export const STORAGE_MIGRATION_ACTIVE_INDEX = 'storage_migration_runs_active_uniq_idx';

/**
 * The system access reason every migration query names: a run is
 * deployment-wide (its `org_id` is NULL) and spans every organization's objects.
 *
 * @stability experimental
 */
export const STORAGE_MIGRATION_SYSTEM_ACCESS_REASON = 'storage-migration';

/**
 * The audit actions the migration writes.
 *
 * @stability experimental
 */
export const STORAGE_MIGRATION_AUDIT_ACTIONS: {
  /** A run was started. */
  readonly START: 'storage.migration.start';
  /** A run was cancelled. */
  readonly CANCEL: 'storage.migration.cancel';
} = {
  START: 'storage.migration.start',
  CANCEL: 'storage.migration.cancel',
} as const;

/**
 * Registers {@link STORAGE_MIGRATION_SYSTEM_ACCESS_REASON} with core's
 * registry, once. The service and both handlers call it from their
 * constructors (bootstrap, before the registry freezes), so code that builds
 * them by hand (a database test) is covered too.
 *
 * @stability experimental
 */
export function registerStorageMigrationSystemAccessReason(): void {
  if (systemAccessReasonRegistry.has(STORAGE_MIGRATION_SYSTEM_ACCESS_REASON)) return;
  registerSystemAccessReason({
    id: STORAGE_MIGRATION_SYSTEM_ACCESS_REASON,
    description:
      'Copy-only storage provider migration: deployment-wide runs (NULL org_id) and the objects of every organization they copy.',
  });
}
