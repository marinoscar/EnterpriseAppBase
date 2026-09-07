import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DatabaseBackupRun,
  DatabaseBackupTrigger,
  Prisma,
} from '@prisma/client';

import { resolveApiVersion } from '../openapi/version';
import { PrismaService } from '../prisma/prisma.service';
import { SystemSettingsService } from '../settings/system-settings/system-settings.service';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../storage/providers/storage-provider.interface';
import type { SystemDatabaseBackupValue } from '../common/schemas/settings.schema';
import {
  ACTIVE_STORAGE_PROVIDER_ID,
  assertUsableStorageProvider,
  BACKUP_ARCHIVE_FORMAT,
  BACKUP_CONTENT_TYPE,
  buildBackupStorageKey,
} from './db-backup-storage';
import { PERMISSIONS } from '../common/constants/roles.constants';
import type { BackupFailedEmailData } from '../email';
import { NotificationsService } from '../notifications/notifications.service';
import { DatabaseBackupRetentionService } from './db-backup-retention.service';
import {
  DatabaseBackupAlreadyRunningError,
  DatabaseBackupCancelledError,
  DatabaseBackupClientVersionError,
  DatabaseBackupVerificationError,
} from './db-backup.errors';
import { readLatestAppliedMigration } from './migration-state.util';
import { spawnPgDump, type PgProcess } from './pg-dump.util';
import { readTocEntryCount } from './pg-restore.util';
import {
  checkPgClientVersion,
  readServerVersionNumWithPgClient,
  type PgVersionCheck,
} from './pg-version.util';

// =============================================================================
// The streaming pg_dump engine (issue #281, epic #254)
// =============================================================================
//
// One backup = one `database_backup_runs` row + one `pg_dump` process whose
// stdout goes STRAIGHT INTO OBJECT STORAGE. This file is the only place either
// is created. Everything in it exists to hold five properties, and each of the
// five is a failure this template has to not have.
//
// -----------------------------------------------------------------------------
// 1. THE CLAIM IS AWAITED; THE DUMP IS DETACHED
// -----------------------------------------------------------------------------
//
// `startBackup` awaits the INSERT — so its caller gets a real run id or a
// clean `DatabaseBackupAlreadyRunningError` (#283's 409) — and then returns
// while the dump is still running. It has to: a multi-gigabyte dump takes
// tens of minutes, and every reverse proxy between the browser and this
// process has a response timeout measured in seconds. A synchronous
// `POST /backups` would 504 on exactly the databases worth backing up, and the
// operator would retry, and the retry would be refused by the single-active
// index while the first dump — which nobody is now watching — carried on.
//
// ⚠ THE DETACHED PROMISE CARRIES A TERMINAL `.catch()`. Without one, an
// EXPECTED failure (the dump exits non-zero; the bucket refuses the write)
// becomes an unhandled promise rejection, and an unhandled rejection
// TERMINATES the Node process by default. A failed backup must not be able to
// take the API down with it.
//
// -----------------------------------------------------------------------------
// 2. THE VERSION CHECK RUNS BEFORE A SINGLE BYTE IS DUMPED
// -----------------------------------------------------------------------------
//
// `pg_dump` refuses to dump a server newer than itself. Checked first (see
// `pg-version.util.ts`), that becomes a run whose `lastError` says "rebuild the
// image with postgresql<N>-client"; checked never, it becomes an opaque
// non-zero exit after a partial object has already been written.
//
// It runs INSIDE the detached body rather than before the claim, deliberately:
// the check opens a connection of its own, and a blocked deployment deserves a
// VISIBLE failed run in the admin list every night rather than an exception
// swallowed by a cron with no row to point at.
//
// -----------------------------------------------------------------------------
// 3. THE ARCHIVE IS NEVER MATERIALISED — ONE PASS, ONE COPY, NO HEAP
// -----------------------------------------------------------------------------
//
//     dump.done.catch(err => meter.destroy(err));
//     dump.stdout.pipe(meter);
//     await Promise.all([provider.upload(key, meter, opts), dump.done]);
//
// The metering `Transform` hashes and counts each chunk AS IT PASSES and
// forwards it unchanged. There is no buffer, no temp file, no second read:
// checksum and byte count are produced by the same single pass the upload is
// already making. Buffering "just to hash it first" would put an entire
// production database in this process's heap — the memory profile this whole
// design exists to avoid, and one that fails on the deployment that needs the
// backup most.
//
// ⚠ `Promise.all` ON **BOTH** HALVES IS LOAD-BEARING, NOT BELT-AND-BRACES.
// The two failure modes are genuinely independent and each is invisible to the
// other side:
//
//   - A DUMP THAT DIES MID-STREAM simply ENDS its stdout. The upload sees a
//     clean EOF and reports a perfectly successful upload OF A TRUNCATED
//     ARCHIVE. Only `dump.done`'s exit code distinguishes that from a complete
//     dump — which is why `pg-dump.util.ts` calls it "the authority on
//     success".
//   - A DUMP CAN EXIT NON-ZERO AFTER ITS LAST BYTE LANDED (a failure during
//     cleanup), and an upload can fail after the dump finished cleanly.
//
// So both are awaited, and either one rejecting fails the run. The two
// cross-teardowns beside them close the remaining leaks: a dead dump destroys
// the metering stream (or the upload would hang forever waiting on bytes that
// will never come), and a dead upload SIGKILLs the dump (or `pg_dump` would
// keep reading a database for an archive nobody is storing).
//
// -----------------------------------------------------------------------------
// 4. VERIFICATION READS THE STORED OBJECT BACK, NOT THE STREAM WE SENT
// -----------------------------------------------------------------------------
//
// Before a run is `completed`, the UPLOADED OBJECT is streamed back out of
// storage and through `pg_restore --list`; an empty table of contents fails the
// run. The checksum proves the bytes we SENT are the bytes we hashed. This
// proves the bytes that ARRIVED are a readable archive — which catches a
// truncated upload, a zero-byte object, and a dump that ran against the wrong
// (empty) database, none of which any exit code or byte count can see.
//
// The cost is one extra read of the object. That is the correct price for the
// property that makes the whole feature worth having: a backup marked
// `completed` in this table is a backup that has been proven restorable-shaped
// at least once.
//
// -----------------------------------------------------------------------------
// 5. FAILURE DELETES THE OBJECT FIRST, THEN MARKS THE ROW
// -----------------------------------------------------------------------------
//
// In that order, always. The row is the only index of what exists in the
// bucket: a run marked `failed` while its partial object is still there is an
// orphan nothing will ever look for, billed forever. Deleting first means the
// worst case is the opposite — an object already gone when the row says
// `running`, which #282's stale sweep resolves.
//
// The delete is BEST-EFFORT and never masks the original error. The reason the
// backup failed is what the operator needs; "and also the delete failed" is a
// log line, not a replacement diagnosis.
//
// THERE IS NO AUTOMATIC RETRY. Re-running a failed multi-gigabyte dump burns
// hours of I/O on a database that is probably already unwell; the retry for a
// backup is the next scheduled run. See the `### Why this is not a queue job`
// block in `schema.prisma`.
// =============================================================================

/**
 * How often the heartbeat writes `lastHeartbeatAt` and the live
 * `bytesWritten`.
 *
 * TWENTY SECONDS, and the number is bounded on both sides by things that
 * already exist. `databaseBackup.runStaleMinutes` starts at 120 and its
 * minimum is 1, so the interval must be comfortably under a minute or a
 * legitimately short run could be swept as stale between two beats. At the
 * other end each beat is one indexed UPDATE by primary key, so a tighter
 * interval would be affordable but pointless: the progress bar it feeds is
 * read by a human.
 *
 * A CONSTANT, not an environment variable. Nothing an operator could set here
 * would be a better answer than "well inside the smallest stale window", and a
 * knob whose only wrong settings are silent (too slow → false stale sweeps)
 * is a knob worth not having.
 */
export const BACKUP_HEARTBEAT_INTERVAL_MS = 20_000;

/**
 * How many times the claim will re-attempt its INSERT when the run holding the
 * active slot settles out from under the re-read.
 *
 * BOUNDED, for the reason `ENQUEUE_MAX_ATTEMPTS` is (see `jobs.service.ts`):
 * an unbounded loop is correct in theory and a spin in practice. Three covers
 * the real race — a run finishing inside the few milliseconds between the
 * failed insert and the lookup — and turns a pathological one into an honest
 * "already running" rather than a hang.
 */
const CLAIM_MAX_ATTEMPTS = 3;

/**
 * The name of the partial unique index that enforces one active run.
 *
 * Declared in
 * `prisma/migrations/20260907120000_add_database_backup_runs/migration.sql`;
 * repeated here because a P2002 has to be attributed to *this* constraint and
 * not to some other unique constraint a fork may add to the table.
 */
export const ACTIVE_RUN_INDEX_NAME = 'database_backup_runs_active_uniq_idx';

/** The physical column and the Prisma field the index is built over. */
const ACTIVE_RUN_COLUMN_NAME = 'status';

/** The statuses the index's predicate covers — "an active run". */
export const ACTIVE_RUN_STATUSES = ['pending', 'running'] as const;

/** What a caller may say about the backup it wants taken. */
export interface StartBackupInput {
  /** Why this run exists. No default: an unattributable run is a run nobody can explain. */
  trigger: DatabaseBackupTrigger;

  /**
   * The administrator who asked, when a person did.
   *
   * `null`/omitted for a `scheduled` run — a timer has no user, and inventing
   * one (the last admin to log in, the seeded admin) would put a name on an
   * action nobody took.
   */
  createdById?: string | null;
}

/**
 * What `cancel` actually managed to do.
 *
 * A DISCRIMINATED RESULT RATHER THAN A `boolean` OR A THROW, because the
 * honest answer has three cases and two of them are not errors. Cancellation
 * works through a PROCESS-LOCAL handle — only the process that spawned the
 * child can signal it — so a run started on another replica cannot be
 * cancelled from here, and reporting that as `true` would tell an operator
 * their dump had stopped when it is still streaming.
 */
export type CancelBackupResult =
  /** The child was signalled and the upload torn down; the run will settle as `failed`. */
  | { outcome: 'signalled'; runId: string }
  /**
   * No in-process handle exists. Either the run belongs to another replica, or
   * it already settled. Either way THIS process cannot stop it, and #283 must
   * say so rather than reporting success.
   */
  | { outcome: 'not_running_here'; runId: string };

/**
 * The `pg_*` seam.
 *
 * Every child process this service starts goes through it, so the unit suite
 * can drive a dump that dies mid-stream, an archive with an empty table of
 * contents, and a blocked version pair WITH NO PostgreSQL BINARIES INSTALLED.
 * A suite that needs `pg_dump` on the runner is a suite CI skips, and a skipped
 * test guards nothing — the same argument `PgSpawnFn` makes one layer down.
 */
export interface DatabaseBackupEngine {
  /** Starts `pg_dump -Fc` against this deployment's database. */
  startDump(options: { compressionLevel: number; timeoutMs: number }): PgProcess;

  /** Counts the table-of-contents entries in an archive stream. Zero means "restores nothing". */
  readTocEntryCount(source: Readable): Promise<number>;

  /** Compares the installed client against the server it would have to dump. */
  checkClientVersion(): Promise<PgVersionCheck>;
}

/**
 * DI token for {@link DatabaseBackupEngine}.
 *
 * OPTIONAL, and DELIBERATELY NOT PROVIDED in `DbBackupModule` — exactly like
 * `JOB_CLOCK`. The application always gets {@link systemDatabaseBackupEngine};
 * only a test that constructs this service directly can substitute one, so a
 * fork cannot ship a stubbed dump engine by accident.
 */
export const DB_BACKUP_ENGINE = Symbol('DB_BACKUP_ENGINE');

/** The real engine: real binaries, real database. */
export const systemDatabaseBackupEngine: DatabaseBackupEngine = {
  startDump: ({ compressionLevel, timeoutMs }) =>
    spawnPgDump({ compressionLevel, timeoutMs }),
  readTocEntryCount: (source) => readTocEntryCount({ source }),
  checkClientVersion: () =>
    checkPgClientVersion({
      // The `pg` seam rather than a Prisma query, so the check still answers
      // while the application database is mid-swap during a Phase 7 restore.
      readServerVersionNum: () => readServerVersionNumWithPgClient(),
    }),
};

/** The heartbeat's timer seam. */
export interface BackupTimers {
  setInterval(handler: () => void, ms: number): NodeJS.Timeout;
  clearInterval(handle: NodeJS.Timeout): void;
}

/** DI token for {@link BackupTimers}. Optional and unprovided, as {@link DB_BACKUP_ENGINE} is. */
export const DB_BACKUP_TIMERS = Symbol('DB_BACKUP_TIMERS');

/**
 * The real timers, with the interval UNREF'D.
 *
 * A refed 20-second interval would hold a shutting-down process open, turning
 * a graceful deploy into an orchestrator kill for as long as a dump lasts.
 * Unref'd, the heartbeat stops mattering the moment nothing else is keeping
 * the process alive — which is correct, because at that point there is no dump
 * left to report progress for either. (The `typeof` guard is for fake-timer
 * configurations whose handle is a bare number.)
 */
export const systemBackupTimers: BackupTimers = {
  setInterval: (handler, ms) => {
    const timer = setInterval(handler, ms);

    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }

    return timer;
  },
  clearInterval: (handle) => clearInterval(handle),
};

/**
 * A run this process is actually executing, and the one way to stop it.
 *
 * PROCESS-LOCAL BY CONSTRUCTION. The map holds a live child-process handle and
 * a live stream, neither of which can be serialised, shared or reached from
 * another replica — which is precisely why {@link CancelBackupResult} has a
 * `not_running_here` case instead of pretending otherwise.
 */
interface ActiveRunHandle {
  /** Set by `cancel` before `abort` is called, so a cancel that races the spawn still lands. */
  cancelled: boolean;
  /** Tears the run down. A no-op until the child and the metering stream exist. */
  abort(error: Error): void;
}

/**
 * Whether `error` is a unique-constraint violation on the SINGLE-ACTIVE-RUN
 * index specifically — as opposed to any other P2002 this table (or a fork's
 * additions to it) might raise.
 *
 * THIS DISCRIMINATION IS LOAD-BEARING, for the same reason
 * `isActiveDedupConflict` gives in `jobs.service.ts`: treating every P2002 as
 * "already running" would report a genuine constraint bug as an ordinary busy
 * signal, and that is the exact class of error that must stay loud. Anything
 * this function does not positively recognise propagates untouched.
 *
 * Two metadata shapes are inspected because Prisma reports the violation
 * differently depending on how the client is talking to Postgres — the driver
 * adapter (`@prisma/adapter-pg`, which `PrismaService` uses) puts it under
 * `meta.driverAdapterError.cause`, the classic engine under `meta.target`. Both
 * are checked so that switching adapters degrades to "the P2002 propagates",
 * never to "an unrelated conflict is silently swallowed".
 */
export function isActiveRunConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }

  const names = new Set([ACTIVE_RUN_INDEX_NAME, ACTIVE_RUN_COLUMN_NAME]);
  const meta = (error.meta ?? {}) as Record<string, unknown>;

  // Shape 1: driver adapter.
  const adapterError = meta.driverAdapterError as { cause?: Record<string, unknown> } | undefined;
  const cause = adapterError?.cause;

  if (cause) {
    const constraint = cause.constraint as { fields?: unknown; index?: unknown } | undefined;

    if (
      Array.isArray(constraint?.fields) &&
      constraint.fields.some((field) => names.has(String(field)))
    ) {
      return true;
    }

    if (typeof constraint?.index === 'string' && constraint.index === ACTIVE_RUN_INDEX_NAME) {
      return true;
    }

    if (
      typeof cause.originalMessage === 'string' &&
      cause.originalMessage.includes(ACTIVE_RUN_INDEX_NAME)
    ) {
      return true;
    }
  }

  // Shape 2: classic query engine.
  const target = meta.target;

  if (typeof target === 'string') {
    return names.has(target);
  }

  if (Array.isArray(target)) {
    return target.some((entry) => names.has(String(entry)));
  }

  return false;
}

/** Anything thrown, as an `Error`. JavaScript lets you throw a string. */
function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

@Injectable()
export class DatabaseBackupRunnerService {
  private readonly logger = new Logger(DatabaseBackupRunnerService.name);

  private readonly engine: DatabaseBackupEngine;
  private readonly timers: BackupTimers;

  /** See {@link ActiveRunHandle}: process-local, never shared, never persisted. */
  private readonly active = new Map<string, ActiveRunHandle>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SystemSettingsService,
    // The ACTIVE provider, injected directly rather than through
    // `ObjectsService`. A backup is not a `storage_objects` row: it has its own
    // table, its own key space and its own lifecycle, and routing it through
    // the interactive object API would give every backup a user-facing object
    // record that an administrator could delete by hand.
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    // Retention is a REQUIRED collaborator, not an optional seam like the two
    // below it. A runner that could be constructed without one is a runner a
    // fork can wire up so that nothing ever deletes an archive — and that
    // failure is invisible until the bucket is full.
    private readonly retention: DatabaseBackupRetentionService,
    // #288 (epic #254). REQUIRED, not an optional seam: a runner that could be
    // constructed without a notifier is a runner a fork can wire so that a
    // failed backup is silent, which is the failure this event exists for.
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    @Optional() @Inject(DB_BACKUP_ENGINE) engine?: DatabaseBackupEngine,
    @Optional() @Inject(DB_BACKUP_TIMERS) timers?: BackupTimers
  ) {
    this.engine = engine ?? systemDatabaseBackupEngine;
    this.timers = timers ?? systemBackupTimers;
  }

  /**
   * Validates a `databaseBackup.storageProvider` value against the provider
   * this deployment actually has.
   *
   * Exposed on the service so #283's `PUT` config handler can call it without
   * importing storage internals, and so there is exactly ONE rule shared by
   * the write path and the run path. The rule itself is pure and lives in
   * `db-backup-storage.ts`.
   *
   * @throws {DatabaseBackupStorageProviderError} → a 400.
   */
  assertStorageProviderUsable(configured: string | null | undefined): void {
    assertUsableStorageProvider(configured, ACTIVE_STORAGE_PROVIDER_ID);
  }

  /**
   * Takes a backup: claims the single active slot, then streams the dump into
   * storage in the background.
   *
   * @returns the freshly claimed run, ALREADY `running` and with its
   * server-chosen `storageKey` set. The dump has not finished — see property 1
   * in this file's header for why it must not have.
   *
   * @throws {DatabaseBackupAlreadyRunningError} when the index refused the
   * claim, carrying the id of the run that won.
   * @throws {DatabaseBackupStorageProviderError} when the configured provider
   * is not the active one.
   */
  async startBackup(input: StartBackupInput): Promise<DatabaseBackupRun> {
    const policy = await this.settings.getDatabaseBackupPolicy();

    // BEFORE the claim, so a misconfigured provider produces a clean 400 and
    // no row at all — there is nothing to record about a backup that was never
    // allowed to start, and a `failed` row per attempt would bury the real
    // history under configuration noise.
    this.assertStorageProviderUsable(policy.storageProvider);

    const run = await this.claimRun(input);

    // ⚠ DETACHED, WITH A TERMINAL `.catch()`. `executeRun` is written not to
    // reject — every failure it anticipates is recorded on the row — so this
    // handler is the guard for the ones it does not: a Prisma outage while
    // writing the failure itself, a bug in this file. Without it such a
    // rejection is unhandled, and an unhandled rejection terminates the
    // process. `void` marks the promise as deliberately not awaited.
    void this.executeRun(run, policy).catch((error: unknown) => {
      this.logger.error(
        `Database backup run ${run.id} failed outside its own failure handling: ` +
          `${toError(error).message}`
      );
    });

    return run;
  }

  /**
   * Stops a run THIS PROCESS is executing.
   *
   * Cancellation is not a second teardown mechanism: it destroys the metering
   * stream with a {@link DatabaseBackupCancelledError}, which tears the upload
   * down, which fails the `Promise.all`, which reaches the ORDINARY failure
   * path — partial object deleted, row marked `failed`, heartbeat cleared. A
   * bespoke "cancelled" cleanup would be a second chance to leave a
   * half-written object in the bucket.
   *
   * Reports honestly when it holds no handle; see {@link CancelBackupResult}.
   */
  cancel(runId: string): CancelBackupResult {
    const handle = this.active.get(runId);

    if (handle === undefined) {
      return { outcome: 'not_running_here', runId };
    }

    // Set BEFORE calling `abort`, because `abort` is a no-op in the window
    // between the run being registered and the child existing. `executeRun`
    // re-reads this flag right after the spawn so a cancel that landed in that
    // window still kills the process it just started.
    handle.cancelled = true;
    handle.abort(new DatabaseBackupCancelledError(runId));

    return { outcome: 'signalled', runId };
  }

  /**
   * INSERTs the run, letting the partial unique index decide the race.
   *
   * There is deliberately no `findFirst({ where: { status: 'running' } })`
   * anywhere in this path. That is a check-then-act race and it is racy
   * exactly when it matters — a scheduled tick on one replica and an admin's
   * click on another, in the same second. Only the database can make "is one
   * already active" atomic with the insert that would violate it.
   */
  private async claimRun(input: StartBackupInput): Promise<DatabaseBackupRun> {
    const bucket = this.storage.getBucket();

    for (let attempt = 1; attempt <= CLAIM_MAX_ATTEMPTS; attempt += 1) {
      // The id is generated HERE rather than left to the column default,
      // because the storage key contains it (see `buildBackupStorageKey`) and
      // the key has to be on the row the insert creates — a second UPDATE to
      // fill it in would leave a window in which a crashed process had claimed
      // the active slot with no key to clean up.
      const id = randomUUID();
      const startedAt = new Date();

      // ⚠ `Unchecked` INPUT, DELIBERATELY. `createdById` is a real relation
      // (`createdBy`), and Prisma's *Checked* create input stops accepting the
      // raw scalar the moment a scalar FK is promoted to one — it wants
      // `createdBy: { connect: { id } }` instead, which cannot express "and
      // also null". The unchecked variant takes the column as written, which is
      // what a nullable audit FK wants.
      const data: Prisma.DatabaseBackupRunUncheckedCreateInput = {
        id,
        // Claimed directly as `running`, never as `pending`: the claim and the
        // start are one act, so a separate `pending` phase would be a state
        // nothing ever observes and a second write to leave behind on a crash.
        // See the schema's note on exactly what the index admits.
        status: 'running',
        trigger: input.trigger,
        startedAt,
        // Seeded at the claim so the stale sweep has a baseline from the first
        // moment: a run whose heartbeat is NULL is indistinguishable from one
        // that never started.
        lastHeartbeatAt: startedAt,
        storageProvider: ACTIVE_STORAGE_PROVIDER_ID,
        storageKey: buildBackupStorageKey(startedAt, id),
        bucket,
        format: BACKUP_ARCHIVE_FORMAT,
        createdById: input.createdById ?? null,
      };

      try {
        return await this.prisma.databaseBackupRun.create({ data });
      } catch (error) {
        // Any conflict that is NOT this index's is somebody else's problem and
        // must stay loud.
        if (!isActiveRunConflict(error)) {
          throw error;
        }

        const activeRunId = await this.findActiveRunId();

        if (activeRunId !== null) {
          throw new DatabaseBackupAlreadyRunningError(activeRunId);
        }

        // The winner SETTLED between the failed insert and this lookup, so it
        // dropped out of the index's predicate and the slot is free again.
        // Reporting "already running" now would be false. Loop and insert
        // again — with a fresh id and key, because the old ones were never
        // stored.
        this.logger.debug(
          `The active backup slot was released between a conflicting insert and the ` +
            `lookup (attempt ${attempt}/${CLAIM_MAX_ATTEMPTS}); retrying the claim.`
        );
      }
    }

    // Every attempt collided and every lookup came back empty: something is
    // churning runs faster than this loop can insert between them. An honest
    // "not now" with no id beats a spin.
    throw new DatabaseBackupAlreadyRunningError(null);
  }

  /** The id of whichever run currently occupies the active slot, or `null`. */
  private async findActiveRunId(): Promise<string | null> {
    const row = await this.prisma.databaseBackupRun.findFirst({
      where: { status: { in: [...ACTIVE_RUN_STATUSES] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    return row?.id ?? null;
  }

  /**
   * The dump itself. NEVER REJECTS for a failure it anticipates — it records
   * the failure on the run instead, because there is no caller left to tell.
   */
  private async executeRun(
    run: DatabaseBackupRun,
    policy: SystemDatabaseBackupValue
  ): Promise<void> {
    const { id: runId, storageKey } = run;
    const handle: ActiveRunHandle = { cancelled: false, abort: () => undefined };
    this.active.set(runId, handle);

    // A holder rather than a plain `let`, so the heartbeat closure and the
    // metering transform see the same counter without either capturing a stale
    // copy.
    const progress = { bytes: 0n };

    // Best-effort provenance, gathered once and written onto whichever terminal
    // update happens — so a FAILED run carries it too. Which server, which
    // build and (most importantly) which schema produced this archive is
    // exactly what someone reading a failure at 3am needs.
    const audit = {
      dbVersion: null as string | null,
      appVersion: resolveApiVersion(),
      migrationName: null as string | null,
    };

    let heartbeat: NodeJS.Timeout | undefined;

    try {
      const version = await this.engine.checkClientVersion();

      if (version.status === 'blocked') {
        throw new DatabaseBackupClientVersionError(
          version.message,
          version.clientMajor,
          version.serverMajor
        );
      }

      // `unknown` is WARN AND PROCEED by design — an unreadable version string
      // must never be the reason a backup did not happen. See
      // `pg-version.util.ts`'s header.
      if (version.status === 'unknown') this.logger.warn(version.message);
      if (version.warning !== undefined) this.logger.warn(version.warning);

      audit.dbVersion = await this.readServerVersion();
      audit.migrationName = await this.readLatestMigrationName();

      const dump = this.engine.startDump({
        compressionLevel: policy.compressionLevel,
        // The operator's own stale window IS the dump's budget. Letting the
        // dump outlive the window that declares it stale would produce a run
        // marked `stale` by #282's sweep while `pg_dump` was still writing to
        // the very key the sweep is about to consider abandoned.
        timeoutMs: policy.runStaleMinutes * 60_000,
      });

      const hash = createHash('sha256');
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          progress.bytes += BigInt(chunk.length);
          // The chunk is forwarded UNCHANGED and NOT retained: this transform
          // is a tap, not a buffer. That is the whole streaming contract.
          callback(null, chunk);
        },
      });

      // ⚠ NO-OP `error` LISTENERS, AND THEY ARE NOT DECORATION. A Node stream
      // that emits `error` with nothing listening throws the error as an
      // UNCAUGHT EXCEPTION and takes the process down. Both of these streams
      // are destroyed on purpose in this file's failure paths — the meter by a
      // dead dump or by `cancel`, stdout when the child is SIGKILLed — and at
      // that moment the upload may already have stopped reading, so there is
      // genuinely no other listener. The error itself is not lost: it is
      // already travelling to the `catch` below through `Promise.all`, which is
      // where the run's `lastError` comes from.
      meter.on('error', () => undefined);
      dump.stdout.on('error', () => undefined);

      handle.abort = (error: Error) => {
        dump.kill('SIGKILL');
        meter.destroy(error);
      };

      // A cancel that arrived while the version check was still running found a
      // no-op `abort`. Re-read the flag now that there is something to kill.
      if (handle.cancelled) {
        handle.abort(new DatabaseBackupCancelledError(runId));
      }

      heartbeat = this.timers.setInterval(() => {
        void this.writeHeartbeat(runId, progress.bytes);
      }, BACKUP_HEARTBEAT_INTERVAL_MS);

      // A DEAD DUMP MUST TEAR THE UPLOAD DOWN. Without this the provider sits
      // waiting on a stream that will never end or error, and the run hangs
      // until something else kills the process. `.catch()` returns a NEW
      // promise, so `dump.done` still rejects into the `Promise.all` below.
      dump.done.catch((error: unknown) => {
        meter.destroy(toError(error));
      });

      const upload = this.storage.upload(storageKey, meter, {
        mimeType: BACKUP_CONTENT_TYPE,
        // Deliberately no `contentLength`: a streamed dump's size is unknown
        // until the last byte, which is exactly why it is streamed.

        // Provenance ON THE OBJECT as well as on the row: an operator staring
        // at a bucket with `aws s3api head-object` can find the run this file
        // came from without a database, which is the situation a restore is
        // most likely to be happening in.
        metadata: { runId, trigger: run.trigger },
      });

      // ...AND A DEAD UPLOAD MUST TEAR THE DUMP DOWN, or `pg_dump` keeps
      // reading a whole database to produce an archive nobody is storing.
      // Same `.catch()` trick: `upload` itself still rejects below.
      upload.catch(() => {
        dump.kill('SIGKILL');
      });

      dump.stdout.pipe(meter);

      // BOTH HALVES. See property 3 in this file's header for why neither one
      // alone is evidence of success.
      await Promise.all([upload, dump.done]);

      // VERIFY WHAT ARRIVED, not what we sent.
      const stored = await this.storage.download(storageKey);
      const tocEntries = await this.engine.readTocEntryCount(stored);

      if (tocEntries <= 0) {
        throw new DatabaseBackupVerificationError(storageKey, tocEntries);
      }

      const finishedAt = new Date();

      await this.prisma.databaseBackupRun.update({
        where: { id: runId },
        data: {
          status: 'completed',
          finishedAt,
          lastHeartbeatAt: finishedAt,
          // They converge here and only here: `bytesWritten` was live progress,
          // `sizeBytes` is the final answer.
          bytesWritten: progress.bytes,
          sizeBytes: progress.bytes,
          checksumSha256: hash.digest('hex'),
          verifiedAt: finishedAt,
          lastError: null,
          ...audit,
        },
      });

      this.logger.log(
        `Database backup run ${runId} completed: ${progress.bytes} bytes at "${storageKey}" ` +
          `(${tocEntries} archive entries verified).`
      );

      // -----------------------------------------------------------------------
      // PRUNE HERE, AND NOWHERE ELSE ON THIS PATH.
      // -----------------------------------------------------------------------
      //
      // AFTER VERIFICATION, because retention deletes older archives and this
      // one is only a replacement for them once it has been proven to be a
      // readable archive. Pruning before the `pg_restore --list` check would
      // let a run that is about to fail verification delete the last known-good
      // backup on its way out — the single worst thing this subsystem could do.
      //
      // AFTER THE `completed` UPDATE, not before it, and the reason is an
      // off-by-one that is easy to ship: the count rule keeps the newest N
      // `completed` runs, so a prune that ran while this row still said
      // `running` would not count it, and would evict one MORE old backup than
      // retention asked for — a deployment set to keep 7 would drift to 6.
      //
      // ONLY ON SUCCESS. There is no prune in the `catch` below and none in
      // the `finally`. A failed backup is exactly when the old archives matter
      // most; deleting one because the night's dump died would be the failure
      // mode of a backup system that makes things worse under stress.
      //
      // ⚠ WRAPPED IN ITS OWN `try`, AND THAT IS NOT BELT-AND-BRACES. `prune`
      // swallows its own failures by contract, but this call sits INSIDE the
      // `try` whose `catch` deletes the object and marks the run `failed`. If
      // that contract were ever broken — one refactor, one `throw` added to a
      // helper — an exception here would travel to that handler and DELETE THE
      // ARCHIVE THIS RUN HAD JUST PROVEN GOOD, then record the run as a
      // failure. Storage housekeeping must not be able to reach the failure
      // path of the backup it is housekeeping for.
      try {
        const pruned = await this.retention.prune();

        if (pruned.prunedByCount > 0 || pruned.prunedByAge > 0) {
          this.logger.log(
            `Retention removed ${pruned.prunedByCount} expired backup(s) and ` +
              `${pruned.prunedByAge} expired pre-restore backup(s).`
          );
        }
      } catch (error) {
        this.logger.warn(
          `Retention failed after database backup run ${runId} completed (the backup ` +
            `itself is fine; storage was not reclaimed): ${toError(error).message}`
        );
      }
    } catch (error) {
      // ORDER MATTERS. Delete first — see property 5 in the header.
      await this.deletePartialObject(storageKey);
      await this.markFailed(runId, toError(error), progress.bytes, audit);
    } finally {
      // ALWAYS. A heartbeat that outlives its run would keep writing
      // `lastHeartbeatAt` to a settled row forever, which is precisely the
      // signal #282's stale sweep uses to decide a run is still alive.
      if (heartbeat !== undefined) this.timers.clearInterval(heartbeat);
      this.active.delete(runId);
    }
  }

  /**
   * One heartbeat: liveness plus live progress, in one indexed UPDATE.
   *
   * SWALLOWS ITS OWN FAILURES. A transient write failure — a connection
   * recycled, a brief failover, a lock wait — is not evidence that a dump
   * streaming perfectly well should be abandoned. Aborting a two-hour backup
   * because one progress UPDATE failed would be the definition of a
   * self-inflicted outage. A sustained failure is not silent either: the
   * heartbeat stops advancing, and #282's stale sweep is exactly the mechanism
   * that notices.
   */
  private async writeHeartbeat(runId: string, bytes: bigint): Promise<void> {
    try {
      await this.prisma.databaseBackupRun.update({
        where: { id: runId },
        data: { lastHeartbeatAt: new Date(), bytesWritten: bytes },
      });
    } catch (error) {
      this.logger.warn(
        `Heartbeat for database backup run ${runId} could not be written ` +
          `(the dump continues): ${toError(error).message}`
      );
    }
  }

  /**
   * Removes the object a failed run may have partially written.
   *
   * BEST-EFFORT, AND IT NEVER MASKS THE ORIGINAL ERROR. Whatever broke the
   * backup is what the operator needs on the row; "and the cleanup also failed"
   * is a log line. Deleting a key that was never created is a no-op on every
   * provider this interface targets, so there is no need to check first.
   */
  private async deletePartialObject(storageKey: string): Promise<void> {
    try {
      await this.storage.delete(storageKey);
    } catch (error) {
      this.logger.warn(
        `Could not delete the partial backup object "${storageKey}"; it may need ` +
          `removing by hand: ${toError(error).message}`
      );
    }
  }

  /** Writes the terminal `failed` row. Never throws — it is the last thing in a failure path. */
  private async markFailed(
    runId: string,
    error: Error,
    bytes: bigint,
    audit: { dbVersion: string | null; appVersion: string; migrationName: string | null }
  ): Promise<void> {
    this.logger.error(`Database backup run ${runId} failed: ${error.message}`);

    let failed: DatabaseBackupRun;

    try {
      failed = await this.prisma.databaseBackupRun.update({
        where: { id: runId },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          // NOT reset to zero: how far a failed dump got is the difference
          // between "the database refused the connection" and "it died at 40 GB".
          bytesWritten: bytes,
          lastError: error.message,
          ...audit,
        },
      });
    } catch (writeError) {
      // The row is now stuck in `running` with a stopped heartbeat, which is
      // exactly the shape #282's stale sweep exists to resolve. Nothing better
      // is available from here, and throwing would only reach the detached
      // `.catch()` in `startBackup`.
      this.logger.error(
        `Could not record the failure of database backup run ${runId}; the stale ` +
          `sweep will settle it: ${toError(writeError).message}`
      );

      // ⚠ NO NOTIFICATION ON THIS BRANCH, DELIBERATELY. Nothing has been
      // recorded, so the run is still `running` from the table's point of view,
      // and the stale sweep will settle it and raise the event with a `stale`
      // outcome. Raising it here as well would mail two failure notices for one
      // failure, and the second one would contradict the row.
      return;
    }

    // ⚠ AFTER THE COMMIT, AND OUTSIDE ANY TRANSACTION. The `failed` row above
    // is the fact; this is the report of it, and the report must not be able to
    // change or delay the fact. `notifyPermissionHolders` is detached and never
    // rejects, and the `void` is what says so at the call site.
    this.announceFailure(failed, 'failed');
  }

  /**
   * Raise `db_backup.backup_failed` for a settled run. Never throws.
   *
   * SHARED WITH THE STALE SWEEP in shape but not in code — the sweep
   * (`tasks/db-backup-schedule.task.ts`) writes its own rows and raises its own
   * event, because it is a different process settling a run this one never saw.
   * What IS shared is the event key, the permission and the template; the two
   * differ only in `outcome`, which is exactly the field that exists to record
   * that difference.
   */
  private announceFailure(
    run: DatabaseBackupRun,
    outcome: BackupFailedEmailData['outcome']
  ): void {
    try {
      // ANNOTATED WITH THE TEMPLATE'S TYPE: `notifyPermissionHolders` takes
      // `data: unknown`, so this is the only place the shape is checked.
      const payload: BackupFailedEmailData = {
        runId: run.id,
        outcome,
        error: run.lastError,
        startedAt: run.startedAt,
        failedAt: run.finishedAt ?? new Date(),
        trigger: run.trigger,
        appUrl: this.appUrl(),
      };

      // `db_backup:read` — the exact string `db-backup.controller.ts` enforces.
      //
      // ⚠ `.catch()` DESPITE THE DISPATCHER CONTRACTING NEVER TO REJECT: that
      // contract is `NotificationsService`'s, not this file's, and an unhandled
      // rejection on a detached backup-failure path has nobody to report it to.
      // The `try/catch` around this block cannot see a rejected promise.
      void this.notifications
        .notifyPermissionHolders(
          'db_backup.backup_failed',
          PERMISSIONS.DB_BACKUP_READ,
          payload
        )
        .catch((error: unknown) => {
          this.logger.error(
            `Dispatching 'db_backup.backup_failed' for run ${run.id} rejected, ` +
              `which the dispatcher contracts never to do: ${toError(error).message}`
          );
        });
    } catch (error) {
      this.logger.error(
        `Could not raise 'db_backup.backup_failed' for run ${run.id}; the run's ` +
          `${outcome} row is unaffected: ${toError(error).message}`
      );
    }
  }

  /**
   * The application root, trailing slashes trimmed, or `undefined`.
   *
   * Same shape as `UsersService.appUrl()`; `undefined` makes the template omit
   * its CTA rather than render a button that goes nowhere.
   */
  private appUrl(): string | undefined {
    const appUrl = this.config.get<string>('appUrl');
    return appUrl ? appUrl.replace(/\/+$/, '') : undefined;
  }

  /**
   * The PostgreSQL server version, for the run's audit trio.
   *
   * `current_setting('server_version')` rather than `version()`, which returns
   * a whole banner including the compiler and platform — provenance we neither
   * need nor want to store per run.
   *
   * BEST-EFFORT: a failure here is `null`, never a failed backup. A run that
   * could not read the server version is still a perfectly valid archive.
   */
  private async readServerVersion(): Promise<string | null> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ server_version: unknown }>>`
        SELECT current_setting('server_version') AS server_version
      `;
      const value = rows[0]?.server_version;

      return typeof value === 'string' && value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }

  /**
   * The newest applied migration, for the run's audit trio.
   *
   * THE MOST IMPORTANT OF THE THREE: it says which SCHEMA the archive
   * contains, so an operator can tell — before replaying it — whether the code
   * that is running will understand what comes back.
   *
   * ⚠ THE QUERY LIVES IN `migration-state.util.ts` AND IS SHARED WITH #284's
   * RESTORE PRE-FLIGHT, which compares the value recorded here against the one
   * live at restore time. Two copies of "the newest applied migration" — one
   * that excludes rolled-back rows and one that does not, say — would make that
   * comparison meaningless: the gate would block restores of compatible
   * archives, or pass an incompatible one. Best-effort, like the version above.
   */
  private async readLatestMigrationName(): Promise<string | null> {
    return readLatestAppliedMigration(this.prisma);
  }
}
