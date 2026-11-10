import { sha256Hex } from '../lock/index.js';

/**
 * A row of Prisma's `_prisma_migrations` ledger, as far as the check needs it.
 *
 * @stability experimental
 */
export interface LedgerRow {
  /** The applied directory name. */
  migrationName: string;
  /** The checksum Prisma recorded (SHA-256 of the file's raw bytes). */
  checksum: string;
  /** When the migration finished, `null` while it is running or failed. */
  finishedAt: Date | null;
  /** When the migration was marked rolled back, otherwise `null`. */
  rolledBackAt: Date | null;
}

/**
 * The class of a ledger failure.
 *
 * - `LEDGER_CHECKSUM_MISMATCH`: the file on disk no longer matches what the database applied.
 * - `LEDGER_UNFINISHED`: a row has no `finished_at` (a failed or running migration).
 *
 * @stability experimental
 */
export type LedgerProblemCode = 'LEDGER_CHECKSUM_MISMATCH' | 'LEDGER_UNFINISHED';

/**
 * One offending ledger row.
 *
 * @stability experimental
 */
export interface LedgerProblem {
  /** The class of failure. */
  code: LedgerProblemCode;
  /** The directory name. */
  localDir: string;
  /** A one-line explanation. */
  message: string;
}

/**
 * The outcome of {@link checkLedger}.
 *
 * @stability experimental
 */
export interface LedgerResult {
  /** True when `problems` is empty. Pending directories do not fail the check. */
  ok: boolean;
  /** Every offending row. */
  problems: LedgerProblem[];
  /** Local directories with no ledger row yet (a `prisma migrate deploy` is pending). */
  pending: string[];
}

/**
 * `platform db check --database`: compares `_prisma_migrations` with the
 * local files. Not redundant with Prisma: `migrate deploy` and `migrate status`
 * do not complain about an edited, already-applied migration file.
 *
 * Covers every local directory, installed or app-authored.
 *
 * @param localDirs - Every migration directory name in the app's history.
 * @param readLocal - Reads `migration.sql` of a directory; `undefined` when missing.
 * @param rows - The ledger rows.
 * @returns Problems and the pending (not yet applied) directories.
 * @stability experimental
 */
export function checkLedger(
  localDirs: readonly string[],
  readLocal: (localDir: string) => Uint8Array | undefined,
  rows: readonly LedgerRow[],
): LedgerResult {
  // A rolled-back row is history: Prisma applies the directory again and writes a new row.
  const byName = new Map<string, LedgerRow>();
  for (const row of rows) if (!row.rolledBackAt) byName.set(row.migrationName, row);
  const problems: LedgerProblem[] = [];
  const pending: string[] = [];
  for (const dir of localDirs) {
    const row = byName.get(dir);
    const bytes = readLocal(dir);
    if (!bytes) continue; // not a migration directory
    if (!row) {
      pending.push(dir);
      continue;
    }
    if (!row.finishedAt) {
      problems.push({ code: 'LEDGER_UNFINISHED', localDir: dir, message: `${dir}: _prisma_migrations has no finished_at (a failed migration; resolve it)` });
    }
    const actual = sha256Hex(bytes);
    if (actual !== row.checksum) {
      problems.push({
        code: 'LEDGER_CHECKSUM_MISMATCH',
        localDir: dir,
        message: `${dir}: the file hashes to ${actual.slice(0, 12)} but the database applied ${row.checksum.slice(0, 12)}; an applied migration was edited`,
      });
    }
  }
  return { ok: problems.length === 0, problems, pending };
}
