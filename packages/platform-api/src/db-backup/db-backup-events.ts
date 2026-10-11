// =============================================================================
// `db_backup.run.completed` and `db_backup.restore.completed` (PP-14.12)
// =============================================================================
//
// A run (or a restore) that SETTLES raises one event on the application's
// event emitter, the mechanism `@OnEvent` listens to and `nodes.node.offline`
// and `job.settled` already use. The slice raises no notification from them
// itself (`db_backup.backup_failed` and `db_backup.restore_completed` stay the
// notifications they were); an app subscribes to feed a metric, post to chat or
// start a copy elsewhere.
//
//   @OnEvent(DB_BACKUP_RUN_COMPLETED_EVENT)
//   onRun(event: DbBackupRunCompletedEvent): void { void this.chat.post(...); }
//
// RULES, each pinned by a test:
//
//   - AFTER THE SETTLING WRITE COMMITS, AND OUTSIDE ANY `$transaction`: the
//     event reports a fact that is already durable, never one a rollback could
//     take back.
//   - NEVER THROWS, NEVER AWAITED BY THE ENGINE'S RESULT. A listener that throws
//     (EventEmitter2 calls listeners synchronously) is caught and logged; the
//     run's outcome does not depend on it. A listener must not do I/O in its
//     body (the `on-event-no-io` conformance suite): enqueue a job or start a
//     detached, contained dispatch.
//   - THE PAYLOAD IS JSON-SAFE AND CARRIES NO SECRET: `{ runId, status,
//     targetId, sizeBytes, durationMs }`, with `sizeBytes` a JSON number.
//   - `db_backup.restore.completed` IS RAISED BEFORE THE PROCESS EXITS on a
//     swap (the exit follows the notification): a synchronous emit is the only
//     shape that survives that exit.
// =============================================================================

import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DB_BACKUP_RESTORE_COMPLETED_EVENT,
  DB_BACKUP_RUN_COMPLETED_EVENT,
  type DbBackupRestoreCompletedEvent,
  type DbBackupRunCompletedEvent,
} from '@marinoscar/platform-contract/db-backup';

export {
  DB_BACKUP_RESTORE_COMPLETED_EVENT,
  DB_BACKUP_RUN_COMPLETED_EVENT,
} from '@marinoscar/platform-contract/db-backup';
/** @stability experimental */
export type { DbBackupRestoreCompletedEvent, DbBackupRunCompletedEvent } from '@marinoscar/platform-contract/db-backup';

/**
 * Raises the slice's two events. Injected (optionally) by the runner, the
 * schedule task and the restore service; with no emitter bound (a graph built
 * from one feature module) it does nothing.
 *
 * @stability experimental
 */
@Injectable()
export class DbBackupEvents {
  private readonly logger = new Logger(DbBackupEvents.name);

  /** @param emitter - the application's event emitter, when `EventEmitterModule` is imported. */
  constructor(@Optional() private readonly emitter?: EventEmitter2) {}

  /**
   * Raises `db_backup.run.completed` for a run that has just settled.
   *
   * @param payload - the run's outcome.
   */
  runCompleted(payload: DbBackupRunCompletedEvent): void {
    this.emit(DB_BACKUP_RUN_COMPLETED_EVENT, payload);
  }

  /**
   * Raises `db_backup.restore.completed` for a restore that has just settled.
   *
   * @param payload - the restore's outcome.
   */
  restoreCompleted(payload: DbBackupRestoreCompletedEvent): void {
    this.emit(DB_BACKUP_RESTORE_COMPLETED_EVENT, payload);
  }

  private emit(name: string, payload: object): void {
    if (this.emitter === undefined) return;
    try {
      this.emitter.emit(name, { ...payload });
    } catch (error) {
      this.logger.error(
        `A '${name}' listener threw; the run's outcome is unaffected: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/**
 * A byte count as the JSON number the events carry (exact up to 2^53, far
 * beyond any archive; larger values clamp to `Number.MAX_SAFE_INTEGER`).
 *
 * @param value - a `bigint`, a number, a numeric string, or nothing.
 * @returns a non-negative safe integer.
 *
 * @stability experimental
 */
export function eventBytes(value: bigint | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  try {
    const big = typeof value === 'bigint' ? value : BigInt(value);
    if (big < 0n) return 0;
    return big > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(big);
  } catch {
    return 0;
  }
}
