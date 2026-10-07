/**
 * Why `platform db baseline` refused or could not continue.
 *
 * - `THROUGH_UNKNOWN`: `--through` names no package migration.
 * - `MAP_INVALID`: the `--map` file is not valid, or names a directory or entry that does not exist or is already matched.
 * - `LEDGER_FAILED_ROW`: `_prisma_migrations` holds a failed or rolled-back row.
 * - `LEDGER_ROW_MISSING`: a mapped directory has no finished row in `_prisma_migrations`.
 * - `LEDGER_CHECKSUM_MISMATCH`: a mapped directory's file differs from the checksum the database recorded.
 * - `DIFF_BLOCKING`: the live database differs from the package history in a statement no deviation declares.
 * - `INDEX_MISSING`, `INDEX_DEFINITION_DIFFERS`: a raw-SQL index is missing or changed in the live database.
 * - `LOCK_NOT_EMPTY`: `platform.lock` already has entries and `--force-remap` was not given.
 * - `PLACEMENT_IMPOSSIBLE`: a migration to resolve cannot be named so that the history keeps package order.
 * - `PACKAGE_FILE_MISMATCH`: a package file does not match its manifest hash.
 * - `RESOLVE_FAILED`: `prisma migrate resolve --applied` failed.
 * - `VERIFY_FAILED`: a check after the apply failed.
 *
 * @stability experimental
 */
export type BaselineErrorCode =
  | 'THROUGH_UNKNOWN'
  | 'MAP_INVALID'
  | 'LEDGER_FAILED_ROW'
  | 'LEDGER_ROW_MISSING'
  | 'LEDGER_CHECKSUM_MISMATCH'
  | 'DIFF_BLOCKING'
  | 'INDEX_MISSING'
  | 'INDEX_DEFINITION_DIFFERS'
  | 'LOCK_NOT_EMPTY'
  | 'PLACEMENT_IMPOSSIBLE'
  | 'PACKAGE_FILE_MISMATCH'
  | 'RESOLVE_FAILED'
  | 'VERIFY_FAILED';

/**
 * A refusal of `platform db baseline`, with a stable code.
 *
 * @stability experimental
 */
export class BaselineError extends Error {
  /** The class of refusal. */
  readonly code: BaselineErrorCode;

  /**
   * @param code - The class of refusal.
   * @param message - What is wrong and how to fix it.
   */
  constructor(code: BaselineErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'BaselineError';
    this.code = code;
  }
}
