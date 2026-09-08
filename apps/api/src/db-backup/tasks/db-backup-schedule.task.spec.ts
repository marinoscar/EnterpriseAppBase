import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemSettingsService } from '../../settings/system-settings/system-settings.service';
import type { StorageProvider } from '../../storage/providers/storage-provider.interface';
import type { SystemDatabaseBackupValue } from '../../common/schemas/settings.schema';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { DatabaseRestoreService } from '../database-restore.service';
import type { DatabaseBackupRunnerService } from '../db-backup-runner.service';
import { DatabaseBackupAlreadyRunningError } from '../db-backup.errors';
import { DatabaseBackupScheduleTask } from './db-backup-schedule.task';

// =============================================================================
// The scheduler's and the sweep's acceptance criteria (issue #282, epic #254)
// =============================================================================
//
// NO WALL CLOCK ANYWHERE IN THIS FILE, and no fake timers either. `now` is a
// parameter of `releaseStaleRuns` and `fireDueBackup`, which is exactly why
// those two are public methods: the interesting criteria are about specific
// instants — 07:00 UTC on the morning American clocks jump forward, a tick
// that arrives forty minutes late, the second pass of an autumn 01:30 — and
// a test that had to move the machine's clock to reach them would be testing
// the harness. `handleCron` is driven only for the properties that belong to
// the cron wrapper itself: the kill switch, the overlap guard and "it never
// rejects".
//
// The scheduler holds NO PERSISTED STATE by design, so "across a restart" is
// literally a second `new DatabaseBackupScheduleTask(...)` over the same
// table — see the restart test, which is the whole argument against a
// `lastRunAt` column expressed as an assertion.
// =============================================================================

const POLICY: SystemDatabaseBackupValue = {
  enabled: true,
  frequency: 'daily',
  dayOfWeek: 0,
  dayOfMonth: 1,
  timeOfDay: '02:00',
  timezone: 'UTC',
  retentionCount: 7,
  storageProvider: 's3',
  runStaleMinutes: 120,
  compressionLevel: 6,
  restoreRollbackMode: 'retain_database',
  oldDatabaseRetentionHours: 48,
  nodeOffloadEnabled: false,
};

interface RunRow {
  id: string;
  status: string;
  storageKey: string;
  startedAt: Date | null;
  lastHeartbeatAt: Date | null;
  /**
   * #351: the age a `pending` row is swept by. A queued run has neither a
   * start nor a heartbeat — that is what `pending` MEANS — so `createdAt` is
   * the only column that can say how long it has held the active slot.
   */
  createdAt?: Date | null;
  finishedAt?: Date;
  lastError?: string;
  /** #288: projected by the sweep's read and rendered by the notification. */
  trigger?: string;
  /**
   * #352: the queue job that is executing this run, if one is.
   *
   * The sweep asks the JOB whether an executor still holds it, because a
   * backup taken on a worker node cannot write a heartbeat to this database
   * at all. A row with no `jobId` (every `pre_restore` dump, and everything
   * older than #351) is swept on its heartbeat exactly as it always was.
   */
  jobId?: string | null;
}

interface HarnessOptions {
  policy?: Partial<SystemDatabaseBackupValue>;
  /**
   * #352: job ids the queue reports as `running` with a lease that has NOT
   * expired. The sweep must leave their runs alone whatever the heartbeat
   * says — that is how a node-executed dump survives a stale window it has no
   * way to write to.
   */
  liveJobs?: string[];
  config?: Record<string, unknown>;
  rows?: RunRow[];
  /** Replaces the default `queueBackup`, e.g. to make it reject. */
  queueBackupImpl?: () => Promise<{ run: { id: string }; job: { id: string } }>;
  deleteImpl?: (key: string) => Promise<void>;
  /** Rows this table pretends were mutated by somebody else between read and write. */
  settleDuringSweep?: string[];
  /** Replaces #285's retained-database sweep, e.g. to make it reject. */
  dropExpiredImpl?: (policy: SystemDatabaseBackupValue, now: Date) => Promise<number>;
  /** #288: a notifier that misbehaves, for the containment assertions. */
  notifyImpl?: () => Promise<void>;
}

function makeHarness(options: HarnessOptions = {}) {
  const policy = { ...POLICY, ...options.policy };
  /** Every side effect in the order it happened, for the ordering assertions. */
  const calls: string[] = [];
  const table = new Map((options.rows ?? []).map((row) => [row.id, { ...row }]));
  const settleDuring = new Set(options.settleDuringSweep ?? []);

  /**
   * The sweep's predicate, evaluated arm by arm.
   *
   * ⚠ `status` MOVED INSIDE THE ARMS in #351 — the sweep no longer asks for
   * one status with three age tests, it asks for two statuses each with its
   * own age column (`lastHeartbeatAt`/`startedAt` for `running`, `createdAt`
   * for `pending`). This double follows that shape literally rather than
   * approximating it, so a predicate that stopped matching pending rows would
   * fail here rather than pass by accident.
   */
  const findMany = jest.fn(async (args: any) => {
    const { where } = args;

    return [...table.values()]
      .filter((row) =>
        where.OR.some((arm: any) => {
          if (row.status !== arm.status) return false;

          // The queued-but-never-claimed arm: aged by `createdAt`, because a
          // pending row has neither a heartbeat nor a start.
          if (arm.createdAt !== undefined) {
            return row.createdAt != null && row.createdAt < arm.createdAt.lt;
          }

          if (arm.lastHeartbeatAt === null) {
            return row.lastHeartbeatAt === null && row.startedAt !== null
              ? row.startedAt < arm.startedAt.lt
              : false;
          }

          return row.lastHeartbeatAt !== null && row.lastHeartbeatAt < arm.lastHeartbeatAt.lt;
        })
      )
      .map((row) => ({ ...row }));
  });

  const updateMany = jest.fn(
    async ({ where, data }: { where: any; data: Record<string, unknown> }) => {
      calls.push(`row:${where.id}`);

      const row = table.get(where.id);

      // The race the conditional `where` exists for: this row finished
      // between the sweep's read and its write.
      if (settleDuring.has(where.id) && row !== undefined) row.status = 'completed';

      if (row === undefined || row.status !== where.status) return { count: 0 };

      Object.assign(row, data);

      return { count: 1 };
    }
  );

  /** The newest `startedAt` in the table — the real query's answer. */
  const findFirst = jest.fn(async ({ where }: any) => {
    const candidates = [...table.values()].filter((row) => row.startedAt !== null);

    if (where?.startedAt?.not !== null) throw new Error('unexpected findFirst filter');
    if (candidates.length === 0) return null;

    candidates.sort(
      (a, b) => (b.startedAt as Date).getTime() - (a.startedAt as Date).getTime()
    );

    return { id: candidates[0].id, startedAt: candidates[0].startedAt };
  });

  /**
   * The queue's side of the sweep (#352): which of these jobs is still held.
   *
   * Deliberately asserts the PREDICATE rather than just returning the set —
   * "held" means `status: 'running'` AND a lease in the future, and a sweep
   * that dropped either half would either leak (never sweeping an abandoned
   * node run) or lose data (sweeping a live one).
   */
  const liveJobs = new Set(options.liveJobs ?? []);
  const jobFindMany = jest.fn(async ({ where }: any) => {
    if (where.status !== 'running') throw new Error('expected the held-lease predicate');
    if (where.leaseExpiresAt?.gt === undefined) throw new Error('expected a lease check');

    return (where.id.in as string[])
      .filter((id) => liveJobs.has(id))
      .map((id) => ({ id }));
  });

  const prisma = {
    databaseBackupRun: { findMany, updateMany, findFirst },
    job: { findMany: jobFindMany },
  } as unknown as PrismaService;

  const settings = {
    getDatabaseBackupPolicy: jest.fn(async () => policy),
  } as unknown as SystemSettingsService;

  /** Set by `fireAt` so a claimed run records the instant the tick believed it was. */
  let tickNow = new Date(0);
  let claimed = 0;

  /**
   * #351: the scheduler ENQUEUES now — `queueBackup`, not `startBackup`.
   *
   * ⚠ THE DOUBLE MODELS A WORKER CLAIMING THE JOB IMMEDIATELY, which is why
   * the row it writes is `running` with a `startedAt`. That is deliberate and
   * it is what keeps every boundary test in this file testing THE BOUNDARY
   * RULE rather than the queue: the anti-double-fire query asks "has a run
   * STARTED since this boundary", and a double that left the row `pending`
   * forever would make each of those tests fail for a reason that has nothing
   * to do with the schedule arithmetic they exist to pin.
   *
   * The genuinely-unclaimed window — a `pending` row that covers no boundary,
   * and the dedup conflict that stops the second fire — is covered
   * separately, by `ignores a row that never started` and by the
   * already-running group below.
   */
  const queueBackup = jest.fn(
    options.queueBackupImpl ??
      (async () => {
        calls.push('queueBackup');
        claimed += 1;
        const id = `run-${claimed}`;
        table.set(id, {
          id,
          status: 'running',
          storageKey: `backups/${id}.dump`,
          createdAt: tickNow,
          startedAt: tickNow,
          lastHeartbeatAt: tickNow,
        });

        return { run: { id }, job: { id: `job-${claimed}` } };
      })
  );

  const runner = { queueBackup } as unknown as DatabaseBackupRunnerService;

  const deleteObject = jest.fn(async (key: string) => {
    calls.push(`object:${key}`);
    if (options.deleteImpl) await options.deleteImpl(key);
  });

  const storage = { delete: deleteObject } as unknown as StorageProvider;

  const configGet = jest.fn((key: string) => (options.config ?? {})[key]);
  const config = { get: configGet } as unknown as ConfigService;

  /**
   * #285's retained-database sweep, stubbed. It has its own suite
   * (`database-restore.service.spec.ts`); what matters HERE is only that the
   * tick calls it, that it goes last, and that its failure does not cost the
   * two duties in front of it.
   */
  const dropExpiredOldDatabases = jest.fn(
    options.dropExpiredImpl ??
      (async (_policy: SystemDatabaseBackupValue, _now: Date) => {
        calls.push('dropExpiredOldDatabases');

        return 0;
      })
  );

  const restore = { dropExpiredOldDatabases } as unknown as DatabaseRestoreService;

  // #288's notifier. A jest mock, so the containment assertions can make it
  // throw and still require the sweep to finish.
  const notifyPermissionHolders: jest.Mock = jest.fn(async (..._args: unknown[]) => {
    if (options.notifyImpl) await options.notifyImpl();
  });
  const notifications = {
    notifyPermissionHolders,
  } as unknown as NotificationsService;

  const build = () =>
    new DatabaseBackupScheduleTask(
      prisma,
      settings,
      runner,
      storage,
      config,
      restore,
      notifications
    );

  const task = build();

  return {
    task,
    notifyPermissionHolders,
    /** A fresh instance over the SAME table — the restart simulation. */
    restart: build,
    policy,
    prisma,
    calls,
    table,
    findMany,
    updateMany,
    findFirst,
    jobFindMany,
    queueBackup,
    deleteObject,
    configGet,
    dropExpiredOldDatabases,
    /** One tick's firing decision at a pinned instant. */
    async fireAt(iso: string) {
      tickNow = new Date(iso);

      return task.fireDueBackup(policy, tickNow);
    },
    /** The same, on a different (restarted) instance. */
    async fireAtWith(instance: DatabaseBackupScheduleTask, iso: string) {
      tickNow = new Date(iso);

      return instance.fireDueBackup(policy, tickNow);
    },
    async sweepAt(iso: string) {
      return task.releaseStaleRuns(policy, new Date(iso));
    },
  };
}

/**
 * The policy the `handleCron` tests use.
 *
 * `handleCron` reads `new Date()` — that is the whole point of it, and the
 * only part of this feature that may. A midnight schedule makes the boundary
 * "today at 00:00 in UTC", which is at or before every instant of every day,
 * so "an empty table means a backup is due" is true whatever hour CI happens
 * to run at. Pinning the wall clock instead would test the harness.
 */
const ALWAYS_DUE: Partial<SystemDatabaseBackupValue> = { timeOfDay: '00:00' };

/** Polls until `condition` holds, for the one test that races two ticks. */
async function waitFor(condition: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }

  throw new Error(`timed out waiting for: ${label}`);
}

function runningRow(id: string, overrides: Partial<RunRow> = {}): RunRow {
  return {
    id,
    status: 'running',
    storageKey: `backups/${id}.dump`,
    createdAt: new Date('2026-09-07T02:00:00.000Z'),
    startedAt: new Date('2026-09-07T02:00:00.000Z'),
    lastHeartbeatAt: new Date('2026-09-07T02:00:20.000Z'),
    trigger: 'scheduled',
    ...overrides,
  };
}

/**
 * #351: a run that was QUEUED and never claimed.
 *
 * `startedAt` and `lastHeartbeatAt` are NULL because that is what `pending`
 * means — nothing has started, so nothing has beaten. `createdAt` is the only
 * column that can say how long this row has been holding the single active
 * slot, which is exactly why the sweep's third arm reads it.
 */
function pendingRow(id: string, overrides: Partial<RunRow> = {}): RunRow {
  return {
    id,
    status: 'pending',
    storageKey: `backups/${id}.dump`,
    createdAt: new Date('2026-09-07T02:00:00.000Z'),
    startedAt: null,
    lastHeartbeatAt: null,
    trigger: 'scheduled',
    ...overrides,
  };
}

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterAll(() => {
  jest.restoreAllMocks();
});

// -----------------------------------------------------------------------------

describe('exactly one run per boundary', () => {
  it('fires when the window has opened and nothing has started since', async () => {
    const h = makeHarness();

    await expect(h.fireAt('2026-09-07T02:03:00.000Z')).resolves.toBe('fired');
    expect(h.queueBackup).toHaveBeenCalledWith({ trigger: 'scheduled' });
  });

  it('does not fire before the window opens', async () => {
    const h = makeHarness();

    // 01:50 — the previous boundary is YESTERDAY's 02:00, and yesterday's run
    // is in the table.
    h.table.set('yesterday', {
      id: 'yesterday',
      status: 'completed',
      storageKey: 'backups/yesterday.dump',
      startedAt: new Date('2026-09-06T02:01:00.000Z'),
      lastHeartbeatAt: new Date('2026-09-06T02:40:00.000Z'),
    });

    await expect(h.fireAt('2026-09-07T01:50:00.000Z')).resolves.toBe('not_due');
    expect(h.queueBackup).not.toHaveBeenCalled();
  });

  it('stands down for the rest of the window: two ticks inside one window fire once', async () => {
    const h = makeHarness();

    await expect(h.fireAt('2026-09-07T02:03:00.000Z')).resolves.toBe('fired');
    await expect(h.fireAt('2026-09-07T02:13:00.000Z')).resolves.toBe('not_due');
    await expect(h.fireAt('2026-09-07T23:59:00.000Z')).resolves.toBe('not_due');

    expect(h.queueBackup).toHaveBeenCalledTimes(1);
  });

  it('STILL FIRES when the tick is late — a missed window is recovered, not lost', async () => {
    // The process was down from 01:55 to 02:40. A timer registered on the
    // operator's own cron expression would simply have skipped the night.
    const h = makeHarness();

    await expect(h.fireAt('2026-09-07T02:40:00.000Z')).resolves.toBe('fired');
  });

  it('fires once the NEXT window opens, having stood down through this one', async () => {
    const h = makeHarness();

    await expect(h.fireAt('2026-09-07T02:03:00.000Z')).resolves.toBe('fired');
    await expect(h.fireAt('2026-09-08T01:00:00.000Z')).resolves.toBe('not_due');
    await expect(h.fireAt('2026-09-08T02:01:00.000Z')).resolves.toBe('fired');

    expect(h.queueBackup).toHaveBeenCalledTimes(2);
  });

  it('survives a restart with no persisted state: a fresh instance reaches the same verdict', async () => {
    // ⚠ THE ARGUMENT AGAINST A `lastRunAt` COLUMN, AS AN ASSERTION. The
    // verdict is recomputed from the settings and the table, so there is
    // nothing a restart could lose and nothing that could drift.
    const h = makeHarness();

    await expect(h.fireAt('2026-09-07T02:03:00.000Z')).resolves.toBe('fired');

    const afterRestart = h.restart();

    await expect(h.fireAtWith(afterRestart, '2026-09-07T02:23:00.000Z')).resolves.toBe(
      'not_due'
    );
    expect(h.queueBackup).toHaveBeenCalledTimes(1);
  });

  it('counts a MANUAL backup as covering the window', async () => {
    // The promise is "a backup exists for this window", not "a backup with the
    // scheduled label exists". Dumping the same database twice in five minutes
    // is I/O for no additional safety.
    const h = makeHarness({
      rows: [
        {
          id: 'manual-1',
          status: 'running',
          storageKey: 'backups/manual-1.dump',
          startedAt: new Date('2026-09-07T02:05:00.000Z'),
          lastHeartbeatAt: new Date('2026-09-07T02:05:00.000Z'),
        },
      ],
    });

    await expect(h.fireAt('2026-09-07T02:15:00.000Z')).resolves.toBe('not_due');
  });

  it('ignores a row that never started — it says nothing about whether a window was covered', async () => {
    const h = makeHarness({
      rows: [
        {
          id: 'never-started',
          status: 'pending',
          storageKey: 'backups/never-started.dump',
          startedAt: null,
          lastHeartbeatAt: null,
        },
      ],
    });

    await expect(h.fireAt('2026-09-07T02:03:00.000Z')).resolves.toBe('fired');
  });
});

describe('the configured timezone, not the server\'s', () => {
  it('evaluates the schedule in the operator\'s zone', async () => {
    // 03:00 UTC on 15 June is 23:00 on 14 June in New York. A scheduler that
    // evaluated "02:00" in the server's zone (UTC in a container) would see
    // the window as open and fire; in New York the last boundary was 02:00 EDT
    // on the 14th, which the run below already covers.
    const h = makeHarness({
      policy: { timezone: 'America/New_York' },
      rows: [
        {
          id: 'ny-1',
          status: 'completed',
          storageKey: 'backups/ny-1.dump',
          // 02:05 EDT on 14 June.
          startedAt: new Date('2026-06-14T06:05:00.000Z'),
          lastHeartbeatAt: new Date('2026-06-14T06:40:00.000Z'),
        },
      ],
    });

    await expect(h.fireAt('2026-06-15T03:00:00.000Z')).resolves.toBe('not_due');
    expect(h.queueBackup).not.toHaveBeenCalled();
  });

  it('fires at the operator\'s 02:00, which is 06:00 UTC in New York in summer', async () => {
    const h = makeHarness({
      policy: { timezone: 'America/New_York' },
      rows: [
        {
          id: 'yesterday',
          status: 'completed',
          storageKey: 'backups/yesterday.dump',
          // 02:05 EDT on 14 June — covers the boundary before this one.
          startedAt: new Date('2026-06-14T06:05:00.000Z'),
          lastHeartbeatAt: new Date('2026-06-14T06:40:00.000Z'),
        },
      ],
    });

    await expect(h.fireAt('2026-06-15T05:59:00.000Z')).resolves.toBe('not_due');
    await expect(h.fireAt('2026-06-15T06:05:00.000Z')).resolves.toBe('fired');
  });
});

describe('daylight saving, in both directions', () => {
  it('spring forward: a 02:00 schedule on the day 02:00 does not exist still runs, once', async () => {
    // 8 March 2026, New York: the clock jumps 02:00 EST -> 03:00 EDT, so
    // 02:00 never happens. `zonedCivilToUtc` returns the instant the clock
    // jumped to (07:00 UTC), which is what makes this a backup that happens an
    // hour late instead of a night that is silently skipped.
    const h = makeHarness({ policy: { timezone: 'America/New_York' } });

    // 06:30 UTC = 01:30 EST, still before the jump: the live boundary is the
    // PREVIOUS day's, which the run below covers.
    h.table.set('the-7th', {
      id: 'the-7th',
      status: 'completed',
      storageKey: 'backups/the-7th.dump',
      startedAt: new Date('2026-03-07T07:02:00.000Z'),
      lastHeartbeatAt: new Date('2026-03-07T07:30:00.000Z'),
    });

    await expect(h.fireAt('2026-03-08T06:30:00.000Z')).resolves.toBe('not_due');

    // 07:05 UTC = 03:05 EDT, just after the jump: the 8th's boundary has
    // arrived.
    await expect(h.fireAt('2026-03-08T07:05:00.000Z')).resolves.toBe('fired');
    // And it does not fire a second time for the same civil day.
    await expect(h.fireAt('2026-03-08T07:45:00.000Z')).resolves.toBe('not_due');

    expect(h.queueBackup).toHaveBeenCalledTimes(1);
  });

  it('spring forward: the interval to the next fire is 23 hours, not a drifted 24', async () => {
    // Adding 86_400_000ms to yesterday's fire would put the 8th's boundary an
    // hour out and leave it there for the rest of the year. Walking civil days
    // and converting each independently is what keeps 02:00 meaning 02:00.
    const h = makeHarness({ policy: { timezone: 'America/New_York' } });

    await expect(h.fireAt('2026-03-07T07:02:00.000Z')).resolves.toBe('fired');
    // 07:00 UTC on the 8th is 23 hours after 08:00... no: 07:00 UTC on the 7th
    // was 02:00 EST, and 07:00 UTC on the 8th is 03:00 EDT — the next fire is
    // 24 hours of wall clock later but the SAME UTC hour, because the day lost
    // an hour. What must not happen is a second fire on the 7th.
    await expect(h.fireAt('2026-03-08T06:00:00.000Z')).resolves.toBe('not_due');
    await expect(h.fireAt('2026-03-08T07:01:00.000Z')).resolves.toBe('fired');

    expect(h.queueBackup).toHaveBeenCalledTimes(2);
  });

  it('fall back: an ambiguous 01:30 fires on the FIRST pass of the clock and not the second', async () => {
    // 1 November 2026, New York: 01:30 happens twice — 05:30 UTC (EDT) and
    // 06:30 UTC (EST). The boundary is the earlier one, so the second pass
    // finds a run that already covers it. Firing twice would mean two full
    // dumps of the same database an hour apart, once a year, for no reason.
    const h = makeHarness({
      policy: { timezone: 'America/New_York', timeOfDay: '01:30' },
    });

    await expect(h.fireAt('2026-11-01T05:35:00.000Z')).resolves.toBe('fired');
    await expect(h.fireAt('2026-11-01T06:35:00.000Z')).resolves.toBe('not_due');
    await expect(h.fireAt('2026-11-01T07:00:00.000Z')).resolves.toBe('not_due');

    expect(h.queueBackup).toHaveBeenCalledTimes(1);
  });

  it('fall back: the next day\'s boundary is still 01:30 local, now an hour later in UTC', async () => {
    const h = makeHarness({
      policy: { timezone: 'America/New_York', timeOfDay: '01:30' },
    });

    await expect(h.fireAt('2026-11-01T05:35:00.000Z')).resolves.toBe('fired');
    // 2 November, 05:35 UTC = 00:35 EST — before the new boundary.
    await expect(h.fireAt('2026-11-02T05:35:00.000Z')).resolves.toBe('not_due');
    // 06:35 UTC = 01:35 EST — after it.
    await expect(h.fireAt('2026-11-02T06:35:00.000Z')).resolves.toBe('fired');
  });
});

describe('an unusable timezone', () => {
  it('stands down instead of firing at the wrong wall-clock time', async () => {
    const h = makeHarness({ policy: { timezone: 'Mars/Olympus_Mons' } });

    await expect(h.fireAt('2026-09-07T02:03:00.000Z')).resolves.toBe('bad_timezone');
    expect(h.queueBackup).not.toHaveBeenCalled();
    // It does not even reach the table: there is no boundary to compare against.
    expect(h.findFirst).not.toHaveBeenCalled();
  });

  it('LOGS ONCE, not once every ten minutes', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const h = makeHarness({ policy: { timezone: 'Mars/Olympus_Mons' } });

    await h.fireAt('2026-09-07T02:03:00.000Z');
    await h.fireAt('2026-09-07T02:13:00.000Z');
    await h.fireAt('2026-09-07T02:23:00.000Z');

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('Mars/Olympus_Mons');
    error.mockRestore();
  });

  it('logs again when the operator swaps one bad zone for another', async () => {
    // A boolean latch would mean the second typo is never reported.
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const h = makeHarness({ policy: { timezone: 'Mars/Olympus_Mons' } });

    await h.fireAt('2026-09-07T02:03:00.000Z');
    h.policy.timezone = 'Pluto/Charon';
    await h.fireAt('2026-09-07T02:13:00.000Z');

    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it('clears the latch once the zone works, so a later regression is loud again', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const h = makeHarness({ policy: { timezone: 'Mars/Olympus_Mons' } });

    await h.fireAt('2026-09-07T02:03:00.000Z');
    h.policy.timezone = 'UTC';
    await h.fireAt('2026-09-07T02:13:00.000Z');
    h.policy.timezone = 'Mars/Olympus_Mons';
    await h.fireAt('2026-09-07T02:23:00.000Z');

    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});

describe('the disabled setting', () => {
  it('does not fire when databaseBackup.enabled is false', async () => {
    const h = makeHarness({ policy: { enabled: false } });

    await expect(h.fireAt('2026-09-07T02:03:00.000Z')).resolves.toBe('disabled');
    expect(h.queueBackup).not.toHaveBeenCalled();
  });

  it('STILL SWEEPS when scheduled backups are disabled', async () => {
    // ⚠ A run orphaned before the setting was flipped still holds the single
    // active slot. Skipping the sweep would make every later MANUAL backup
    // fail with "already running" for a schedule nobody is using.
    const h = makeHarness({
      policy: { enabled: false },
      rows: [runningRow('orphan', { lastHeartbeatAt: new Date('2026-09-07T02:00:00.000Z') })],
    });

    await expect(h.sweepAt('2026-09-07T06:00:00.000Z')).resolves.toBe(1);
    expect(h.table.get('orphan')?.status).toBe('stale');
  });

  it('sweeps before it fires, so a zombie does not cost an extra tick', async () => {
    const h = makeHarness({
      policy: ALWAYS_DUE,
      rows: [
        runningRow('orphan', {
          // Long dead, and long enough ago that it covers no current boundary.
          startedAt: new Date('2020-01-01T00:00:00.000Z'),
          lastHeartbeatAt: new Date('2020-01-01T00:00:00.000Z'),
        }),
      ],
    });

    await h.task.handleCron();

    // The sweep's row transition happened, and the claim happened after it —
    // in ONE tick, not two.
    expect(h.calls).toEqual([
      'row:orphan',
      'object:backups/orphan.dump',
      'queueBackup',
      // #285's retained-database sweep, which always runs last.
      'dropExpiredOldDatabases',
    ]);
  });
});

describe('the stale sweep', () => {
  it('releases a run whose heartbeat stopped, and frees the slot', async () => {
    const h = makeHarness({
      rows: [runningRow('zombie', { lastHeartbeatAt: new Date('2026-09-07T02:00:20.000Z') })],
    });

    // runStaleMinutes is 120, so 05:00 is well past.
    await expect(h.sweepAt('2026-09-07T05:00:00.000Z')).resolves.toBe(1);

    const row = h.table.get('zombie');
    expect(row?.status).toBe('stale');
    expect(row?.finishedAt).toEqual(new Date('2026-09-07T05:00:00.000Z'));
    expect(row?.lastError).toContain('120');
  });

  // ---------------------------------------------------------------------------
  // #351: the arm the original predicate's own ⚠ demanded once `pending` rows
  // became real
  // ---------------------------------------------------------------------------

  it('releases a QUEUED run no worker ever claimed, aging it by createdAt', async () => {
    // The failure this arm exists for: a `pending` row holds the single active
    // slot under the tightened index, and it has no heartbeat that could ever
    // age it out. Without this, one deleted job — or one deployment with
    // JOBS_WORKER_MODE=off — blocks every backup that deployment would ever
    // take again.
    const h = makeHarness({ rows: [pendingRow('never-claimed')] });

    await expect(h.sweepAt('2026-09-07T05:00:00.000Z')).resolves.toBe(1);
    expect(h.table.get('never-claimed')?.status).toBe('stale');
  });

  it('leaves a queued run inside the window alone — an ordinary queue delay is not staleness', async () => {
    const h = makeHarness({
      rows: [pendingRow('just-queued', { createdAt: new Date('2026-09-07T04:59:00.000Z') })],
    });

    await expect(h.sweepAt('2026-09-07T05:00:00.000Z')).resolves.toBe(0);
    expect(h.table.get('just-queued')?.status).toBe('pending');
  });

  it('tells a queued run apart from an abandoned dump in the reason it records', async () => {
    // ⚠ TWO MESSAGES, NOT ONE. An operator fixes these in different places: a
    // `running` row was executing somewhere that went away; a `pending` row
    // was never picked up, which is a statement about the QUEUE and not about
    // any dump. Flattening both into "stopped heartbeating" would send
    // somebody hunting through `pg_dump` logs for a process that never existed.
    const h = makeHarness({
      rows: [pendingRow('never-claimed'), runningRow('zombie')],
    });

    await expect(h.sweepAt('2026-09-07T05:00:00.000Z')).resolves.toBe(2);

    expect(h.table.get('never-claimed')?.lastError).toContain('no worker claimed its job');
    expect(h.table.get('never-claimed')?.lastError).toContain('No dump was ever started');
    expect(h.table.get('zombie')?.lastError).toContain('stopped heartbeating');
  });

  it('guards the pending transition on `pending`, not on the old literal `running`', async () => {
    // The regression this pins is the one that looks exactly like working: a
    // hard-coded `status: 'running'` in the compare-and-swap would make every
    // pending candidate `count === 0`, and the sweep would report freeing
    // nothing while quietly leaving the slot blocked.
    const h = makeHarness({ rows: [pendingRow('never-claimed')] });

    await h.sweepAt('2026-09-07T05:00:00.000Z');

    expect(h.updateMany.mock.calls[0][0].where).toEqual({
      id: 'never-claimed',
      status: 'pending',
    });
  });

  it('leaves a queued run alone if it moved on between the sweep\'s read and its write', async () => {
    // Same race the `running` guard covers, from the other side. A `pending`
    // row can move on in exactly the way that matters here — a worker claims
    // it and the dump runs to completion — and the conditional update must
    // then match nothing, so the sweep cannot stamp `stale` over a backup that
    // succeeded while it was deciding.
    const h = makeHarness({
      rows: [pendingRow('claimed-mid-sweep')],
      settleDuringSweep: ['claimed-mid-sweep'],
    });

    await expect(h.sweepAt('2026-09-07T05:00:00.000Z')).resolves.toBe(0);
  });

  it('leaves a run whose heartbeat is still inside the window alone', async () => {
    const h = makeHarness({
      rows: [runningRow('healthy', { lastHeartbeatAt: new Date('2026-09-07T04:59:00.000Z') })],
    });

    await expect(h.sweepAt('2026-09-07T05:00:00.000Z')).resolves.toBe(0);
    expect(h.table.get('healthy')?.status).toBe('running');
  });

  it('ages a zombie with a NULL heartbeat by startedAt', async () => {
    // A process that died between the claim and its first progress write.
    // `NULL < cutoff` is NULL in SQL, never true, so without the second arm
    // this row holds the active slot forever.
    const h = makeHarness({
      rows: [
        runningRow('never-beat', {
          lastHeartbeatAt: null,
          startedAt: new Date('2026-09-07T02:00:00.000Z'),
        }),
      ],
    });

    await expect(h.sweepAt('2026-09-07T05:00:00.000Z')).resolves.toBe(1);
    expect(h.table.get('never-beat')?.status).toBe('stale');
  });

  it('guards the transition on status: running, so a run that finished in the race is NOT stomped', async () => {
    // The read and the write are not atomic. The interesting case is a dump
    // whose heartbeat was starved by a lock wait and that then completed
    // normally: `count === 0`, and overwriting it would discard a verified
    // backup's record AND delete the archive it points at.
    const h = makeHarness({
      rows: [runningRow('racer', { lastHeartbeatAt: new Date('2026-09-07T02:00:00.000Z') })],
      settleDuringSweep: ['racer'],
    });

    await expect(h.sweepAt('2026-09-07T06:00:00.000Z')).resolves.toBe(0);

    expect(h.table.get('racer')?.status).toBe('completed');
    // And — the part that matters most — its object was never deleted.
    expect(h.deleteObject).not.toHaveBeenCalled();
    expect(h.updateMany.mock.calls[0][0].where).toEqual({ id: 'racer', status: 'running' });
  });

  it('transitions the ROW FIRST and cleans the object SECOND', async () => {
    // The row is the guard. Deleting the object first and then dying would
    // leave a `running` row holding the slot and pointing at nothing.
    const h = makeHarness({
      rows: [runningRow('zombie', { lastHeartbeatAt: new Date('2026-09-07T02:00:00.000Z') })],
    });

    await h.sweepAt('2026-09-07T06:00:00.000Z');

    expect(h.calls).toEqual(['row:zombie', 'object:backups/zombie.dump']);
  });

  it('still counts the release when the object delete fails', async () => {
    // A visible stale row naming an orphaned object beats an invisible
    // billable one — and the slot, which is the part that had to happen, is
    // free either way.
    const h = makeHarness({
      rows: [runningRow('zombie', { lastHeartbeatAt: new Date('2026-09-07T02:00:00.000Z') })],
      deleteImpl: async () => {
        throw new Error('AccessDenied');
      },
    });

    await expect(h.sweepAt('2026-09-07T06:00:00.000Z')).resolves.toBe(1);
    expect(h.table.get('zombie')?.status).toBe('stale');
  });

  it('never re-queues a stale run: the next scheduled backup is the retry', async () => {
    const h = makeHarness({
      rows: [runningRow('zombie', { lastHeartbeatAt: new Date('2026-09-07T02:00:00.000Z') })],
    });

    await h.sweepAt('2026-09-07T06:00:00.000Z');

    expect(h.queueBackup).not.toHaveBeenCalled();
    expect(h.table.get('zombie')?.status).toBe('stale');
    expect(h.updateMany).toHaveBeenCalledTimes(1);
  });

  it('uses runStaleMinutes as the window', async () => {
    const h = makeHarness({
      policy: { runStaleMinutes: 30 },
      rows: [runningRow('zombie', { lastHeartbeatAt: new Date('2026-09-07T02:00:00.000Z') })],
    });

    await expect(h.sweepAt('2026-09-07T02:20:00.000Z')).resolves.toBe(0);
    await expect(h.sweepAt('2026-09-07T02:40:00.000Z')).resolves.toBe(1);
  });

  // ===========================================================================
  // A run whose JOB is still leased is not stale (#352, epic #345)
  // ===========================================================================
  //
  // THE FAILURE THESE PREVENT IS DATA LOSS, not untidiness. A backup taken on
  // a worker node cannot write `lastHeartbeatAt` — a node has no database
  // access at all — so after `runStaleMinutes` the sweep would mark a
  // perfectly healthy run `stale`, DELETE THE ARCHIVE THE NODE IS STILL
  // UPLOADING, and then refuse the result when it arrived. The liveness signal
  // for a remote executor is the one it is already maintaining: the job's
  // lease.

  it('leaves a `running` run alone while its job is still held under a live lease', async () => {
    const h = makeHarness({
      rows: [
        runningRow('on-a-node', {
          jobId: 'job-1',
          // Written once, when the node asked for its upload target, and never
          // again — which is exactly what a node-executed run looks like.
          lastHeartbeatAt: new Date('2026-09-07T02:00:20.000Z'),
        }),
      ],
      liveJobs: ['job-1'],
    });

    await expect(h.sweepAt('2026-09-07T05:00:00.000Z')).resolves.toBe(0);

    expect(h.table.get('on-a-node')?.status).toBe('running');
    // AND THE ARCHIVE IS STILL THERE. This is the assertion that matters: the
    // sweep deletes the object of every run it transitions.
    expect(h.deleteObject).not.toHaveBeenCalled();
    expect(h.notifyPermissionHolders).not.toHaveBeenCalled();
  });

  it('leaves a `pending` run alone while its job is still held — the node has claimed but not yet uploaded', async () => {
    const h = makeHarness({
      rows: [pendingRow('queued-on-a-node', { jobId: 'job-2' })],
      liveJobs: ['job-2'],
    });

    await expect(h.sweepAt('2026-09-07T05:00:00.000Z')).resolves.toBe(0);
    expect(h.table.get('queued-on-a-node')?.status).toBe('pending');
  });

  it('sweeps it the moment the lease is gone — a node that died is still a run to give up on', async () => {
    const h = makeHarness({
      rows: [runningRow('abandoned', { jobId: 'job-3' })],
      // `liveJobs` is empty: the queue reports the job as no longer held,
      // which is what an expired lease or a settled job looks like.
    });

    await expect(h.sweepAt('2026-09-07T05:00:00.000Z')).resolves.toBe(1);
    expect(h.table.get('abandoned')?.status).toBe('stale');
  });

  it('asks the queue nothing when no candidate has a job — every pre-#351 run and every pre-restore dump', async () => {
    const h = makeHarness({
      rows: [runningRow('no-job', { lastHeartbeatAt: new Date('2026-09-07T02:00:20.000Z') })],
    });

    await expect(h.sweepAt('2026-09-07T05:00:00.000Z')).resolves.toBe(1);

    // Not "returns an empty set" — makes NO QUERY. A sweep that asked the jobs
    // table once per tick on a deployment that has never run a queued backup
    // would be a query nobody could explain.
    expect(h.jobFindMany).not.toHaveBeenCalled();
  });
});

// =============================================================================
// `db_backup.backup_failed` from the STALE side (#288, epic #254)
// =============================================================================

describe('the stale sweep raises db_backup.backup_failed', () => {
  it('raises it once per run it actually transitioned', async () => {
    const h = makeHarness({
      rows: [
        runningRow('zombie-a', { lastHeartbeatAt: new Date('2026-09-07T02:00:00.000Z') }),
        runningRow('zombie-b', { lastHeartbeatAt: new Date('2026-09-07T02:00:00.000Z') }),
      ],
    });

    await expect(h.sweepAt('2026-09-07T05:00:00.000Z')).resolves.toBe(2);

    expect(h.notifyPermissionHolders).toHaveBeenCalledTimes(2);
    expect(h.notifyPermissionHolders.mock.calls[0][0]).toBe('db_backup.backup_failed');
    // `db_backup:read` — the exact string `db-backup.controller.ts` enforces,
    // and the same one the runner's own failure path uses.
    expect(h.notifyPermissionHolders.mock.calls[0][1]).toBe('db_backup:read');
  });

  it("carries outcome 'stale', not 'failed' — nothing observed this run break", async () => {
    // An operator chases the two in completely different places: a dump's
    // stderr versus a host that disappeared. Flattening both into "backup
    // failed" sends them to the wrong one.
    const h = makeHarness({
      rows: [runningRow('zombie', { lastHeartbeatAt: new Date('2026-09-07T02:00:00.000Z') })],
    });

    await h.sweepAt('2026-09-07T05:00:00.000Z');

    const payload = h.notifyPermissionHolders.mock.calls[0][2];

    expect(payload).toMatchObject({
      runId: 'zombie',
      outcome: 'stale',
      trigger: 'scheduled',
      failedAt: new Date('2026-09-07T05:00:00.000Z'),
    });
  });

  it('quotes the SAME explanation the row was given, rather than a second wording of it', async () => {
    const h = makeHarness({
      rows: [runningRow('zombie', { lastHeartbeatAt: new Date('2026-09-07T02:00:00.000Z') })],
    });

    await h.sweepAt('2026-09-07T05:00:00.000Z');

    expect(h.notifyPermissionHolders.mock.calls[0][2].error).toBe(
      h.table.get('zombie')?.lastError,
    );
  });

  it('raises NOTHING for a run that settled between the read and the write', async () => {
    // `count === 0`: somebody else transitioned it, and one settled run must
    // raise exactly one notification however many replicas are sweeping.
    const h = makeHarness({
      rows: [runningRow('racer', { lastHeartbeatAt: new Date('2026-09-07T02:00:00.000Z') })],
      settleDuringSweep: ['racer'],
    });

    await expect(h.sweepAt('2026-09-07T05:00:00.000Z')).resolves.toBe(0);

    expect(h.notifyPermissionHolders).not.toHaveBeenCalled();
  });

  it('raises NOTHING when every run is still heartbeating', async () => {
    const h = makeHarness({
      rows: [runningRow('healthy', { lastHeartbeatAt: new Date('2026-09-07T04:59:00.000Z') })],
    });

    await expect(h.sweepAt('2026-09-07T05:00:00.000Z')).resolves.toBe(0);

    expect(h.notifyPermissionHolders).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // CONTAINMENT — the #288 acceptance criterion
  // ---------------------------------------------------------------------------

  it('a THROWING notifier does not fail the sweep, and the slot is still freed', async () => {
    const h = makeHarness({
      rows: [runningRow('zombie', { lastHeartbeatAt: new Date('2026-09-07T02:00:00.000Z') })],
      notifyImpl: () => {
        throw new Error('the notifier exploded');
      },
    });

    await expect(h.sweepAt('2026-09-07T05:00:00.000Z')).resolves.toBe(1);

    expect(h.table.get('zombie')?.status).toBe('stale');
  });

  it('a THROWING notifier does not stop the object cleanup that follows it', async () => {
    const h = makeHarness({
      rows: [runningRow('zombie', { lastHeartbeatAt: new Date('2026-09-07T02:00:00.000Z') })],
      notifyImpl: () => {
        throw new Error('the notifier exploded');
      },
    });

    await h.sweepAt('2026-09-07T05:00:00.000Z');

    expect(h.deleteObject).toHaveBeenCalledWith('backups/zombie.dump');
  });

  it('a notifier that REJECTS does not fail the cron tick', async () => {
    const h = makeHarness({
      rows: [runningRow('zombie', { lastHeartbeatAt: new Date('2026-09-07T02:00:00.000Z') })],
      notifyImpl: async () => {
        throw new Error('dispatch blew up');
      },
    });

    await expect(h.task.handleCron()).resolves.toBeUndefined();
    expect(h.table.get('zombie')?.status).toBe('stale');
  });
});

describe('the already-running guard', () => {
  it('logs at DEBUG, not error: the index did its job', async () => {
    const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const h = makeHarness({
      queueBackupImpl: async () => {
        throw new DatabaseBackupAlreadyRunningError('other-replica-run');
      },
    });

    await expect(h.fireAt('2026-09-07T02:03:00.000Z')).resolves.toBe('already_running');
    expect(error).not.toHaveBeenCalled();
    expect(
      debug.mock.calls.some((call) => String(call[0]).includes('already running'))
    ).toBe(true);

    debug.mockRestore();
    error.mockRestore();
  });

  it('lets any other claim failure stay loud', async () => {
    const h = makeHarness({
      queueBackupImpl: async () => {
        throw new Error('databaseBackup.storageProvider is "gcs"');
      },
    });

    await expect(h.fireAt('2026-09-07T02:03:00.000Z')).rejects.toThrow('gcs');
  });
});

describe('the cron wrapper', () => {
  it('stops for DB_BACKUP_SCHEDULE_ENABLED === false', async () => {
    const h = makeHarness({ config: { 'dbBackup.scheduleEnabled': false } });

    await h.task.handleCron();

    expect(h.queueBackup).not.toHaveBeenCalled();
    expect(h.findMany).not.toHaveBeenCalled();
  });

  it('runs when the switch is unset, so a typo fails open into "keep backing up"', async () => {
    const h = makeHarness({ policy: ALWAYS_DUE, config: {} });

    await h.task.handleCron();

    expect(h.queueBackup).toHaveBeenCalledTimes(1);
  });

  it('IS NOT AFFECTED BY THE JOB WORKER MODE', async () => {
    // ⚠ A backup is not queue work. An API running as a pure control plane in
    // front of an external node fleet is still the only component with a
    // database connection, so gating this on `JOBS_WORKER_MODE` would leave
    // that deployment's database backed up by nobody.
    const h = makeHarness({
      policy: ALWAYS_DUE,
      config: { 'jobs.workerMode': 'off', 'jobs.reaperEnabled': false },
    });

    await h.task.handleCron();

    expect(h.queueBackup).toHaveBeenCalledTimes(1);
    // It never even asks.
    expect(h.configGet.mock.calls.map((call) => call[0])).toEqual(['dbBackup.scheduleEnabled']);
  });

  it('skips a tick while the previous one is still running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = makeHarness({
      policy: ALWAYS_DUE,
      queueBackupImpl: async () => {
        await gate;

        return { run: { id: 'slow' }, job: { id: 'job-slow' } };
      },
    });

    const first = h.task.handleCron();
    await waitFor(() => h.queueBackup.mock.calls.length === 1, 'the first tick to claim');

    // The first tick is still inside `queueBackup`; the second must not run a
    // second boundary check against the same unchanged table.
    await h.task.handleCron();

    expect(h.queueBackup).toHaveBeenCalledTimes(1);

    release();
    await first;
  });

  it('releases the overlap guard even when the tick throws', async () => {
    // A guard left set by a throw would stop the scheduler forever, which is
    // the one failure this whole file exists not to have.
    const h = makeHarness({
      policy: ALWAYS_DUE,
      queueBackupImpl: async () => {
        throw new Error('connection reset');
      },
    });

    await expect(h.task.handleCron()).resolves.toBeUndefined();
    await expect(h.task.handleCron()).resolves.toBeUndefined();

    expect(h.queueBackup).toHaveBeenCalledTimes(2);
  });

  it('never rejects out of the cron handler', async () => {
    const h = makeHarness();
    (h.prisma.databaseBackupRun.findMany as jest.Mock).mockRejectedValue(
      new Error('statement timeout')
    );

    await expect(h.task.handleCron()).resolves.toBeUndefined();
  });

  it('a failed sweep does not also cost tonight\'s backup', async () => {
    // The two are separate duties that happen to share a tick.
    const h = makeHarness({ policy: ALWAYS_DUE });
    (h.prisma.databaseBackupRun.findMany as jest.Mock).mockRejectedValue(
      new Error('statement timeout')
    );

    await h.task.handleCron();

    expect(h.queueBackup).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // #285's third duty: dropping a database a restore displaced
  // ---------------------------------------------------------------------------

  it('sweeps retained databases in the same tick, with the tick\'s own policy and clock', async () => {
    const h = makeHarness({ policy: ALWAYS_DUE });

    await h.task.handleCron();

    expect(h.dropExpiredOldDatabases).toHaveBeenCalledTimes(1);

    const [policy, now] = h.dropExpiredOldDatabases.mock.calls[0];

    // ONE `now` FOR THE WHOLE TICK. A sweep judging its cutoff against a
    // second clock read could disagree with the stale sweep about what "now"
    // was, which is exactly the confusion the single `now` exists to prevent.
    expect(policy.oldDatabaseRetentionHours).toBe(ALWAYS_DUE.oldDatabaseRetentionHours ?? 48);
    expect(now).toBeInstanceOf(Date);
  });

  it('runs the sweep LAST, after the stale sweep and the fire', async () => {
    // Pure housekeeping: nothing waits on it, and a DROP DATABASE blocked by a
    // session somebody left open must never delay a backup that is due.
    const h = makeHarness({ policy: ALWAYS_DUE });

    await h.task.handleCron();

    expect(h.calls).toEqual(['queueBackup', 'dropExpiredOldDatabases']);
  });

  it('does not sweep at all when the scheduler is switched off', async () => {
    const h = makeHarness({ config: { 'dbBackup.scheduleEnabled': false } });

    await h.task.handleCron();

    expect(h.dropExpiredOldDatabases).not.toHaveBeenCalled();
  });

  it('a failed retained-database sweep does not reject out of the tick', async () => {
    const h = makeHarness({
      policy: ALWAYS_DUE,
      dropExpiredImpl: async (): Promise<number> => {
        throw new Error('database "appdb_old_20260907T120000Z" is being accessed by other users');
      },
    });

    await expect(h.task.handleCron()).resolves.toBeUndefined();

    // ...and the duties in front of it still happened.
    expect(h.queueBackup).toHaveBeenCalledTimes(1);
  });
});
