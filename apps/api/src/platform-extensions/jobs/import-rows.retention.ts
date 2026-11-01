import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  JobHandlerRegistry,
  runRetentionPolicyPurge,
  type Job,
  type JobExecutionProfile,
  type JobHandler,
  type RetentionPolicyDefinition,
} from '@marinoscar/platform-api/jobs';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

// =============================================================================
// EXAMPLE, NOT WIRED: an app table joins the nightly retention (PP-14.19)
// =============================================================================
//
// Three pieces, none of them a platform edit:
//
//   1. THE POLICY (`IMPORT_ROWS_RETENTION`), listed in `APP_RETENTION_POLICIES`
//      (app-registrations/jobs.ts). The `retention` settings namespace gains an
//      `importRows` key (schema, default and merge), bounded 7 to 365 days and
//      OFF until an operator turns it on: deleting rows is their decision.
//
//   2. THE PURGE HANDLER (`ImportRowsPurgeHandler`), a normal server-only job
//      handler in the app's own module. It reads its own policy per run and
//      deletes in bounded batches with the platform's `runRetentionPolicyPurge`.
//      It does NOT need `RetentionPurgeRegistry.register`: the nightly task
//      enqueues a policy whose `purge.type` has a mounted handler.
//
//   3. THE TABLE, behind a port (`ImportRowsStore`). A real app binds this to
//      its Prisma model (`select id ... where created_at < cutoff order by
//      created_at limit take`, `deleteMany where id in ids`); the test uses an
//      in-memory one.
//
// The job type is PERMANENT once rows of it exist, and a server-only type
// carries neither `nodeResultSchema` nor `persistNodeResult`.
// Proved by test/examples/jobs/import-rows-retention.example.spec.ts.
// =============================================================================

/** The purge's job type. PERMANENT once rows of it exist. */
export const IMPORT_ROWS_PURGE_TYPE = 'app.import-rows.purge';

/** The policy: thirty days by default, 7 to 365 allowed, off until an operator decides. */
export const IMPORT_ROWS_RETENTION: RetentionPolicyDefinition = {
  key: 'importRows',
  label: 'Import rows',
  defaultDays: 30,
  minDays: 7,
  maxDays: 365,
  purge: { type: IMPORT_ROWS_PURGE_TYPE, what: 'import row purge' },
};

/** The app table, as the purge sees it. */
export interface ImportRowsStore {
  /** At most `take` ids of rows created before `cutoff`, oldest first. */
  selectIdsOlderThan(cutoff: Date, take: number): Promise<string[]>;
  /** Deletes exactly these ids; returns how many went. */
  deleteByIds(ids: string[]): Promise<number>;
}

/** The injection token for the app's table. */
export const IMPORT_ROWS_STORE = Symbol('IMPORT_ROWS_STORE');

/** Deletes import rows past `retention.importRows.days`; a logged no-op while the policy is off. */
@Injectable()
export class ImportRowsPurgeHandler implements JobHandler, OnModuleInit {
  private readonly logger = new Logger(ImportRowsPurgeHandler.name);

  readonly type = IMPORT_ROWS_PURGE_TYPE;
  readonly label = 'Import row purge';
  /** Deletes only; retried like any housekeeping job. */
  readonly profile: JobExecutionProfile = { maxRuntimeMs: 30 * 60_000, maxAttempts: 3 };

  constructor(
    private readonly registry: JobHandlerRegistry,
    @Inject(IMPORT_ROWS_STORE) private readonly rows: ImportRowsStore,
    private readonly systemSettings: SystemSettingsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /** Throws to fail (a database error), so the queue's retry applies. */
  async process(job: Job): Promise<void> {
    const policy = (await this.systemSettings.getRetentionPolicy())[IMPORT_ROWS_RETENTION.key];
    // Registered on every process that runs this handler; absent only if it was not.
    if (policy === undefined) throw new Error('retention.importRows is not registered; add IMPORT_ROWS_RETENTION to APP_RETENTION_POLICIES');

    await runRetentionPolicyPurge({
      job,
      logger: this.logger,
      policy,
      setting: 'retention.importRows',
      what: 'import row purge',
      rows: 'import row(s)',
      selectIds: (cutoff, take) => this.rows.selectIdsOlderThan(cutoff, take),
      deleteIds: (ids) => this.rows.deleteByIds(ids),
    });
  }
}
