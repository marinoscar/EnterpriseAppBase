/**
 * Why `platform db sync` or `platform db promote` refused to proceed.
 *
 * - `NOT_IN_PACKAGE`: the lock names a migration the package no longer has.
 * - `LOCK_GAP`: the lock does not hold a prefix of the package history.
 * - `REQUIRES_VIOLATION`: an entry requires a slice no earlier entry provides.
 * - `PACKAGE_FILE_MISMATCH`: a package `migration.sql` differs from its manifest sha256.
 * - `LOCAL_DIR_EXISTS`: the directory sync would create already exists.
 * - `PROMOTE_INVALID`: the arguments of `promote` are not valid.
 * - `PROMOTE_CONFLICT`: the slug or directory is already recorded with different bytes or origin.
 * - `PROMOTE_NOT_SYNCED`: the app lock does not yet hold every package migration.
 * - `PROMOTE_ORDER`: the directory sorts before the last installed platform migration.
 *
 * @stability experimental
 */
export type SyncErrorCode =
  | 'NOT_IN_PACKAGE'
  | 'LOCK_GAP'
  | 'REQUIRES_VIOLATION'
  | 'PACKAGE_FILE_MISMATCH'
  | 'LOCAL_DIR_EXISTS'
  | 'PROMOTE_INVALID'
  | 'PROMOTE_CONFLICT'
  | 'PROMOTE_NOT_SYNCED'
  | 'PROMOTE_ORDER';

/**
 * A refusal of `platform db sync` or `platform db promote`, with a stable code.
 *
 * @stability experimental
 */
export class SyncError extends Error {
  /** The class of refusal. */
  readonly code: SyncErrorCode;

  /**
   * @param code - The class of refusal.
   * @param message - What is wrong and how to fix it.
   */
  constructor(code: SyncErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'SyncError';
    this.code = code;
  }
}
