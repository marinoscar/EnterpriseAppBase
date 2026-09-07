// =============================================================================
// Typed backup failures (issue #281, epic #254)
// =============================================================================
//
// Five ways a backup can be refused or can fail, each of which some caller has
// to be able to tell apart from the others WITHOUT parsing a message string:
//
//   - `DatabaseBackupAlreadyRunningError`  → #283's `POST /backups` returns 409
//     and names the run that is already in flight, so the administrator who
//     just clicked sees "this one" rather than "try again".
//   - `DatabaseBackupStorageProviderError` → a 400 on `PUT` config, and a
//     refusal here, when `databaseBackup.storageProvider` names a provider this
//     deployment does not have.
//   - `DatabaseBackupClientVersionError`   → the `pg_dump` in this image cannot
//     dump this server. The message is a runbook pointer, not an exit code.
//   - `DatabaseBackupVerificationError`    → the bytes reached storage but what
//     came back is not a readable archive.
//   - `DatabaseBackupCancelledError`       → an operator stopped this run. It is
//     an ORDINARY failure, deliberately: cancellation kills the child and
//     destroys the metering stream, and the run then travels the same
//     delete-then-mark-failed path as any other broken dump. See
//     `DatabaseBackupRunnerService.cancel`.
//
// The shape follows `jobs/rate-limit.error.ts`: a plain `Error` subclass, a
// `name`, the discriminating data as readonly fields, and — the part that is
// NOT ceremonial — an explicit `Object.setPrototypeOf`. Extending a built-in
// breaks `instanceof` when the class is downlevelled: the emitted constructor
// calls `Error.call(this)`, which returns a fresh `Error` and leaves `this`'s
// prototype chain pointing at `Error.prototype`. The symptom is the worst
// possible one for this file — `err instanceof DatabaseBackupAlreadyRunningError`
// quietly returns `false`, the 409 becomes a 500, and a perfectly ordinary
// "one is already running" reads to an operator as a broken server.
// =============================================================================

/**
 * The single-active-run index refused this insert: some other run holds
 * `pending`/`running`.
 *
 * ⚠ RAISED FROM A `P2002`, NOT FROM A PRE-CHECK. The database is the arbiter
 * (see `database_backup_runs_active_uniq_idx`), so this error is evidence that
 * a concurrent run genuinely exists at the instant of the insert — which a
 * `findFirst` could never promise.
 */
export class DatabaseBackupAlreadyRunningError extends Error {
  constructor(
    /**
     * The run that won the race.
     *
     * `null` is legitimate and rare: the winning run can SETTLE between the
     * failed insert and the re-read that looks it up, at which point it has
     * dropped out of the partial index's predicate and there is no active run
     * left to name. The caller still gets a truthful "not now"; it simply
     * cannot link to a row. See `startBackup`'s retry loop, which prefers to
     * re-insert rather than report this.
     */
    readonly activeRunId: string | null
  ) {
    super(
      activeRunId === null
        ? 'A database backup is already running.'
        : `A database backup is already running (run ${activeRunId}).`
    );
    this.name = 'DatabaseBackupAlreadyRunningError';
    Object.setPrototypeOf(this, DatabaseBackupAlreadyRunningError.prototype);
  }
}

/**
 * `databaseBackup.storageProvider` names something other than the provider
 * this deployment actually has bound to `STORAGE_PROVIDER`.
 *
 * A 400 on the config write and a refusal at backup time, deliberately BOTH:
 * validating only on write would let a value that predates the check (a seed,
 * a restored settings blob, a provider swap) sit there until the night the
 * backup silently went somewhere nobody expected.
 */
export class DatabaseBackupStorageProviderError extends Error {
  constructor(
    readonly configured: string,
    readonly active: string
  ) {
    super(
      `databaseBackup.storageProvider is "${configured}", but this deployment's ` +
        `active storage provider is "${active}". This template binds exactly one ` +
        'provider at a time, so the setting must be empty (meaning "whatever is ' +
        `active") or exactly "${active}".`
    );
    this.name = 'DatabaseBackupStorageProviderError';
    Object.setPrototypeOf(this, DatabaseBackupStorageProviderError.prototype);
  }
}

/**
 * The client/server version pair is `blocked` — `pg_dump` refuses to dump a
 * server newer than itself, so no backup can succeed until the image is
 * rebuilt.
 *
 * Carries `checkPgClientVersion`'s own message verbatim, because that message
 * already names both majors and points at the runbook. Re-wording it here
 * would make the run's `lastError` and the log line disagree.
 */
export class DatabaseBackupClientVersionError extends Error {
  constructor(
    message: string,
    readonly clientMajor: number | null,
    readonly serverMajor: number | null
  ) {
    super(message);
    this.name = 'DatabaseBackupClientVersionError';
    Object.setPrototypeOf(this, DatabaseBackupClientVersionError.prototype);
  }
}

/**
 * The uploaded object was streamed back and `pg_restore --list` read no table
 * of contents from it.
 *
 * This is the failure that catches everything a byte count and an exit code
 * cannot: a truncated upload, a zero-byte object, a dump that ran against the
 * wrong (empty) database. See `DatabaseBackupRunnerService`'s verification
 * step for why the check reads STORAGE rather than the stream we just sent.
 */
export class DatabaseBackupVerificationError extends Error {
  constructor(
    readonly storageKey: string,
    readonly tocEntries: number
  ) {
    super(
      `The uploaded backup at "${storageKey}" is not a readable archive: ` +
        `pg_restore --list found ${tocEntries} table-of-contents entries. ` +
        'The object has been deleted; nothing was kept that could not be restored.'
    );
    this.name = 'DatabaseBackupVerificationError';
    Object.setPrototypeOf(this, DatabaseBackupVerificationError.prototype);
  }
}

/**
 * An operator cancelled this run.
 *
 * ⚠ IT IS THROWN INTO THE ORDINARY FAILURE PATH, not handled separately.
 * `cancel()` destroys the metering stream with this error, which tears the
 * upload down, which fails the `Promise.all`, which reaches the one `catch`
 * that deletes the partial object and marks the row `failed`. A second
 * teardown mechanism for cancellation would be a second chance to leave a
 * half-written object in the bucket — see the runner's own comments on why
 * cancellation is deliberately not special.
 */
export class DatabaseBackupCancelledError extends Error {
  constructor(readonly runId: string) {
    super(`Database backup run ${runId} was cancelled by an operator.`);
    this.name = 'DatabaseBackupCancelledError';
    Object.setPrototypeOf(this, DatabaseBackupCancelledError.prototype);
  }
}
