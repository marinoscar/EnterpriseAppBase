// =============================================================================
// StorageMigrationSettledListener: what happens when a migration job GIVES UP
// (issue #1093)
// =============================================================================
//
// A listener on `job.settled`, not an "is this my last attempt?" check inside
// `process`: a timeout or a dead executor never returns into `process`. ONE
// listener for both job types (the event has a bounded listener budget), and a
// few bounded writes each, never I/O (`on-event-no-io`):
//
//   * `storage.migrate_plan` failed: the run is failed (its active slot freed,
//     its queued items skipped).
//   * `storage.migrate_object` failed: its still-open item is failed, the error
//     recorded on the run, and the run finalized when that was the last item.
// =============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { JOB_SETTLED_EVENT, type JobSettledEvent } from '../../jobs/index';
import { StorageMigrationItemStatus } from '../data/storage-db';
import {
  STORAGE_MIGRATE_OBJECT_TYPE,
  STORAGE_MIGRATE_PLAN_TYPE,
  STORAGE_MIGRATION_ITEM_SUBJECT_TYPE,
  STORAGE_MIGRATION_RUN_SUBJECT_TYPE,
} from './storage-migration.constants';
import { StorageMigrationService, storageMigrationErrorText } from './storage-migration.service';

/**
 * Fails the run of a planner that gave up, and the item of an object job that gave up.
 *
 * @stability experimental
 */
@Injectable()
export class StorageMigrationSettledListener {
  private readonly logger = new Logger(StorageMigrationSettledListener.name);

  constructor(private readonly migrations: StorageMigrationService) {}

  /** Dispatches a failed migration job; ignores everything else. Never throws. */
  @OnEvent(JOB_SETTLED_EVENT)
  async onJobSettled(event: JobSettledEvent): Promise<void> {
    if (event.succeeded || !event.subjectId) return;
    const message = storageMigrationErrorText(event.lastError ?? 'no error recorded');

    try {
      if (event.type === STORAGE_MIGRATE_PLAN_TYPE && event.subjectType === STORAGE_MIGRATION_RUN_SUBJECT_TYPE) {
        await this.migrations.failRun(event.subjectId, `The planner failed: ${message}`);
        return;
      }
      if (event.type !== STORAGE_MIGRATE_OBJECT_TYPE || event.subjectType !== STORAGE_MIGRATION_ITEM_SUBJECT_TYPE) return;

      await this.migrations.db().storageMigrationItem.updateMany({
        where: {
          id: event.subjectId,
          status: { in: [StorageMigrationItemStatus.pending, StorageMigrationItemStatus.copying] },
        },
        data: { status: StorageMigrationItemStatus.failed, lastError: message },
      });
      const runId = (event.job.payload as { runId?: unknown } | null)?.runId;
      if (typeof runId === 'string') {
        await this.migrations.recordRunError(runId, message);
        await this.migrations.finalizeIfDone(runId);
      }
    } catch (error) {
      this.logger.error(
        `Could not record the failure of ${event.type} job ${event.jobId}: ${storageMigrationErrorText(error)}`,
      );
    }
  }
}
