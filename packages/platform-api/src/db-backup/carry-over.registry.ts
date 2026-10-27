// =============================================================================
// The restore carry-over registry (issue #740, PP-8.7)
// =============================================================================
//
// A restore replaces the live database with an archive, so every row written
// after that archive was taken is gone, by design. A few tables must survive
// it anyway: the backup catalog itself (or the deployment forgets every backup
// newer than the archive), the restore's own job row and its completion audit
// row. Those four are BUILT IN (`database-restore.service.ts`, "Catalog
// carry-over") and stay there: their SQL is typed, ordered and argued
// statement by statement.
//
// An app with a table of the same kind (a record of something that happened
// OUTSIDE the database, such as an uploaded release artefact) registers a
// `RestoreCarryOver` here instead of editing the restore service:
//
//   - `exportSql` runs on the LIVE database before the swap, in a session with
//     `app.rls_bypass` set transaction-locally (so an org-owned table is read
//     in full); every row it returns is carried;
//   - `reinsertSql` runs on the PROMOTED database after the swap, once per
//     carried row, with that row as JSON in `$1` (`$1::jsonb`), in the same
//     kind of session. Write it as an upsert (`ON CONFLICT (id) DO UPDATE`):
//     the archive usually holds an older copy of the same row.
//
// Carries run after the built-in four, in ascending `order` (ties keep
// registration order). Like the built-in carry, a failing extra carry is
// logged as CRITICAL and never throws: the swap has already happened.
//
// FROZEN AFTER BOOTSTRAP (the #675 primitive): register from a module-level
// file the app imports before `NestFactory.create`, or through
// `DbBackupModule.forRoot({ extraCarryOver })`.
// =============================================================================

import { defineRegistry, type Registry } from '../core/index';

/**
 * One table whose rows must survive a restore.
 *
 * @example
 * ```ts
 * registerRestoreCarryOver({
 *   id: 'android_app_releases',
 *   order: 10,
 *   exportSql: 'SELECT * FROM android_app_releases',
 *   reinsertSql:
 *     'INSERT INTO android_app_releases SELECT * FROM jsonb_populate_record(NULL::android_app_releases, $1::jsonb) ' +
 *     'ON CONFLICT (id) DO UPDATE SET is_current = EXCLUDED.is_current',
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export interface RestoreCarryOver {
  /** Stable id, e.g. the table name (`android_app_releases`). */
  readonly id: string;
  /** Read from the live database before the swap; every row it returns is carried. */
  readonly exportSql: string;
  /** Run on the promoted database after the swap, once per row, with the row as JSON in `$1`. */
  readonly reinsertSql: string;
  /** Foreign-key order among the extra carries: lower runs first. */
  readonly order: number;
}

function assertCarry(entry: RestoreCarryOver): void {
  if (typeof entry.exportSql !== 'string' || entry.exportSql.trim() === '') {
    throw new Error(`restore carry-over "${entry.id}" needs a non-empty exportSql`);
  }
  if (typeof entry.reinsertSql !== 'string' || !entry.reinsertSql.includes('$1')) {
    throw new Error(`restore carry-over "${entry.id}" needs a reinsertSql that binds the row as $1`);
  }
  if (!Number.isFinite(entry.order)) {
    throw new Error(`restore carry-over "${entry.id}" needs a finite order`);
  }
}

/**
 * The registry of {@link RestoreCarryOver} entries, listed in ascending
 * `order`. A duplicate id is refused; frozen after bootstrap.
 *
 * @stability experimental
 */
export const restoreCarryOverRegistry: Registry<RestoreCarryOver> = defineRegistry<RestoreCarryOver>({
  name: 'db-backup-restore-carry-over',
  idOf: (entry) => entry.id,
  validate: (entry) => assertCarry(entry),
  order: (a, b) => a.order - b.order,
});

/**
 * Registers one {@link RestoreCarryOver}.
 *
 * @param entry - the carry.
 * @throws RegistryError on a duplicate id, an invalid entry or a frozen registry.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerRestoreCarryOver(entry: RestoreCarryOver): void {
  restoreCarryOverRegistry.register(entry);
}

/**
 * Registers each entry not already registered with the identical definition
 * (so `forRoot({ extraCarryOver })` and an app's own file may name the same
 * carry). A different definition under a registered id is still refused.
 *
 * @param entries - the carries.
 * @throws RegistryError as {@link registerRestoreCarryOver} does.
 *
 * @stability experimental
 */
export function registerRestoreCarryOvers(entries: readonly RestoreCarryOver[]): void {
  for (const entry of entries) {
    const existing = restoreCarryOverRegistry.has(entry.id) ? restoreCarryOverRegistry.get(entry.id) : undefined;
    if (
      existing !== undefined &&
      existing.exportSql === entry.exportSql &&
      existing.reinsertSql === entry.reinsertSql &&
      existing.order === entry.order
    ) {
      continue;
    }
    restoreCarryOverRegistry.register(entry);
  }
}
