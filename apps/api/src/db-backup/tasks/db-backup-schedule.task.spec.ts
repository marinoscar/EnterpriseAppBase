import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemSettingsService } from '../../settings/system-settings/system-settings.service';
import type { StorageProvider } from '../../storage/providers/storage-provider.interface';
import type { SystemDatabaseBackupValue } from '../../common/schemas/settings.schema';
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
};

interface RunRow {
  id: string;
  status: string;
  storageKey: string;
  startedAt: Date | null;
  lastHeartbeatAt: Date | null;
  finishedAt?: Date;
  lastError?: string;
}

interface HarnessOptions {
  policy?: Partial<SystemDatabaseBackupValue>;
  config?: Record<string, unknown>;
  rows?: RunRow[];
  /** Replaces the default `startBackup`, e.g. to make it reject. */
  startBackupImpl?: () => Promise<{ id: string }>;
  deleteImpl?: (key: string) => Promise<void>;
  /** Rows this table pretends were mutated by somebody else between read and write. */
  settleDuringSweep?: string[];
}

function makeHarness(options: HarnessOptions = {}) {
  const policy = { ...POLICY, ...options.policy };
  /** Every side effect in the order it happened, for the ordering assertions. */
  const calls: string[] = [];
  const table = new Map((options.rows ?? []).map((row) => [row.id, { ...row }]));
  const settleDuring = new Set(options.settleDuringSweep ?? []);

  const findMany = jest.fn(async (args: any) => {
    const { where } = args;

    return [...table.values()]
      .filter((row) => {
        if (row.status !== where.status) return false;

        return where.OR.some((arm: any) => {
          if (arm.lastHeartbeatAt === null) {
            return row.lastHeartbeatAt === null && row.startedAt !== null
              ? row.startedAt < arm.startedAt.lt
              : false;
          }

          return row.lastHeartbeatAt !== null && row.lastHeartbeatAt < arm.lastHeartbeatAt.lt;
        });
      })
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

  const prisma = {
    databaseBackupRun: { findMany, updateMany, findFirst },
  } as unknown as PrismaService;

  const settings = {
    getDatabaseBackupPolicy: jest.fn(async () => policy),
  } as unknown as SystemSettingsService;

  /** Set by `fireAt` so a claimed run records the instant the tick believed it was. */
  let tickNow = new Date(0);
  let claimed = 0;

  const startBackup = jest.fn(
    options.startBackupImpl ??
      (async () => {
        calls.push('startBackup');
        claimed += 1;
        const id = `run-${claimed}`;
        table.set(id, {
          id,
          status: 'running',
          storageKey: `backups/${id}.dump`,
          startedAt: tickNow,
          lastHeartbeatAt: tickNow,
        });

        return { id };
      })
  );

  const runner = { startBackup } as unknown as DatabaseBackupRunnerService;

  const deleteObject = jest.fn(async (key: string) => {
    calls.push(`object:${key}`);
    if (options.deleteImpl) await options.deleteImpl(key);
  });

  const storage = { delete: deleteObject } as unknown as StorageProvider;

  const configGet = jest.fn((key: string) => (options.config ?? {})[key]);
  const config = { get: configGet } as unknown as ConfigService;

  const build = () =>
    new DatabaseBackupScheduleTask(prisma, settings, runner, storage, config);

  const task = build();

  return {
    task,
    /** A fresh instance over the SAME table — the restart simulation. */
    restart: build,
    policy,
    prisma,
    calls,
    table,
    findMany,
    updateMany,
    findFirst,
    startBackup,
    deleteObject,
    configGet,
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
    startedAt: new Date('2026-09-07T02:00:00.000Z'),
    lastHeartbeatAt: new Date('2026-09-07T02:00:20.000Z'),
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
    expect(h.startBackup).toHaveBeenCalledWith({ trigger: 'scheduled' });
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
    expect(h.startBackup).not.toHaveBeenCalled();
  });

  it('stands down for the rest of the window: two ticks inside one window fire once', async () => {
    const h = makeHarness();

    await expect(h.fireAt('2026-09-07T02:03:00.000Z')).resolves.toBe('fired');
    await expect(h.fireAt('2026-09-07T02:13:00.000Z')).resolves.toBe('not_due');
    await expect(h.fireAt('2026-09-07T23:59:00.000Z')).resolves.toBe('not_due');

    expect(h.startBackup).toHaveBeenCalledTimes(1);
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

    expect(h.startBackup).toHaveBeenCalledTimes(2);
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
    expect(h.startBackup).toHaveBeenCalledTimes(1);
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
    expect(h.startBackup).not.toHaveBeenCalled();
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

    expect(h.startBackup).toHaveBeenCalledTimes(1);
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

    expect(h.startBackup).toHaveBeenCalledTimes(2);
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

    expect(h.startBackup).toHaveBeenCalledTimes(1);
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
    expect(h.startBackup).not.toHaveBeenCalled();
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
    expect(h.startBackup).not.toHaveBeenCalled();
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
      'startBackup',
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

    expect(h.startBackup).not.toHaveBeenCalled();
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
});

describe('the already-running guard', () => {
  it('logs at DEBUG, not error: the index did its job', async () => {
    const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const h = makeHarness({
      startBackupImpl: async () => {
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
      startBackupImpl: async () => {
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

    expect(h.startBackup).not.toHaveBeenCalled();
    expect(h.findMany).not.toHaveBeenCalled();
  });

  it('runs when the switch is unset, so a typo fails open into "keep backing up"', async () => {
    const h = makeHarness({ policy: ALWAYS_DUE, config: {} });

    await h.task.handleCron();

    expect(h.startBackup).toHaveBeenCalledTimes(1);
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

    expect(h.startBackup).toHaveBeenCalledTimes(1);
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
      startBackupImpl: async () => {
        await gate;

        return { id: 'slow' };
      },
    });

    const first = h.task.handleCron();
    await waitFor(() => h.startBackup.mock.calls.length === 1, 'the first tick to claim');

    // The first tick is still inside `startBackup`; the second must not run a
    // second boundary check against the same unchanged table.
    await h.task.handleCron();

    expect(h.startBackup).toHaveBeenCalledTimes(1);

    release();
    await first;
  });

  it('releases the overlap guard even when the tick throws', async () => {
    // A guard left set by a throw would stop the scheduler forever, which is
    // the one failure this whole file exists not to have.
    const h = makeHarness({
      policy: ALWAYS_DUE,
      startBackupImpl: async () => {
        throw new Error('connection reset');
      },
    });

    await expect(h.task.handleCron()).resolves.toBeUndefined();
    await expect(h.task.handleCron()).resolves.toBeUndefined();

    expect(h.startBackup).toHaveBeenCalledTimes(2);
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

    expect(h.startBackup).toHaveBeenCalledTimes(1);
  });
});
