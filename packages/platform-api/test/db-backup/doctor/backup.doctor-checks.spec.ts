import { DoctorCheckOutcome } from '../../../src/doctor/index';
import { DoctorCheckRegistry } from '../../../src/doctor/index';
import type { DbBackupPrisma as PrismaService } from '../../../src/db-backup/data/db-backup-db';
import { DatabaseBackupAdminService } from '../../../src/db-backup/db-backup-admin.service';
import { PgVersionCheck } from '../../../src/db-backup/pg-version.util';
import { BackupPgClientDoctorCheck, decidePgClient } from '../../../src/db-backup/doctor/backup-pg-client.doctor-check';
import { BackupScheduleDoctorCheck, decideBackupSchedule } from '../../../src/db-backup/doctor/backup-schedule.doctor-check';
import { BackupRlsDoctorCheck, decideBackupRls, type OrgTableCounts } from '../../../src/db-backup/doctor/backup-rls.doctor-check';
import type { DbBackupSystemData } from '../../../src/db-backup/ports';

function expectRemedy(outcome: DoctorCheckOutcome): void {
  expect(['warn', 'fail']).toContain(outcome.status);
  expect(outcome.remedy).toEqual(expect.stringMatching(/\S{10,}/));
}

const NOW = new Date('2026-09-30T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe('backup doctor checks', () => {
  describe('backup.schedule', () => {
    const base = {
      enabled: true,
      nextRunAt: '2026-10-01T02:00:00.000Z',
      latestTerminal: { status: 'completed', finishedAt: hoursAgo(10), lastError: null },
      lastSuccessAt: hoursAgo(10),
    };

    it('passes a recent success on an enabled schedule', () => {
      expect(decideBackupSchedule(base, NOW)).toMatchObject({ status: 'pass', data: { lastSuccessAgeHours: 10 } });
    });

    it('fails when the latest run failed, carrying its error', () => {
      const outcome = decideBackupSchedule(
        { ...base, latestTerminal: { status: 'failed', finishedAt: hoursAgo(1), lastError: 'pg_dump: error: x' } },
        NOW,
      );

      expect(outcome).toMatchObject({ status: 'fail', error: 'pg_dump: error: x' });
      expectRemedy(outcome);
    });

    it('fails when the latest run went stale', () => {
      const outcome = decideBackupSchedule(
        { ...base, latestTerminal: { status: 'stale', finishedAt: null, lastError: null } },
        NOW,
      );
      expect(outcome.detail).toContain('went stale');
      expectRemedy(outcome);
    });

    it('warns when the schedule is off', () => {
      expectRemedy(decideBackupSchedule({ ...base, enabled: false }, NOW));
    });

    it('warns when enabled but no backup ever completed', () => {
      const outcome = decideBackupSchedule({ ...base, latestTerminal: null, lastSuccessAt: null }, NOW);
      expect(outcome.detail).toContain('none has ever completed');
      expectRemedy(outcome);
    });

    it('warns when the last success is older than 48 h', () => {
      expectRemedy(decideBackupSchedule({ ...base, lastSuccessAt: hoursAgo(49) }, NOW));
      expect(decideBackupSchedule({ ...base, lastSuccessAt: hoursAgo(48) }, NOW).status).toBe('pass');
    });

    it('reads the config and the two latest runs', async () => {
      const getConfig = jest.fn().mockResolvedValue({ enabled: true, nextRunAt: null });
      const findFirst = jest
        .fn()
        .mockResolvedValueOnce({ status: 'completed', finishedAt: new Date(), lastError: null })
        .mockResolvedValueOnce({ finishedAt: new Date(), createdAt: new Date() });
      const check = new BackupScheduleDoctorCheck(
        new DoctorCheckRegistry(),
        { getConfig } as unknown as DatabaseBackupAdminService,
        { databaseBackupRun: { findFirst } } as unknown as PrismaService,
      );

      await expect(check.run()).resolves.toMatchObject({ status: 'pass' });
      expect(findFirst).toHaveBeenCalledTimes(2);
    });
  });

  describe('backup.pg-client', () => {
    const version = (overrides: Partial<PgVersionCheck>): PgVersionCheck => ({
      status: 'ok',
      client: 'pg_dump (PostgreSQL) 17.2',
      clientMajor: 17,
      serverMajor: 16,
      message: '',
      ...overrides,
    });

    it('passes a client that can dump the server', () => {
      expect(decidePgClient(version({}))).toMatchObject({ status: 'pass', data: { clientMajor: 17, serverMajor: 16 } });
    });

    it('fails a client older than the server', () => {
      expectRemedy(decidePgClient(version({ status: 'blocked', clientMajor: 16, serverMajor: 17 })));
    });

    it('fails a client older than the pinned minimum', () => {
      const outcome = decidePgClient(version({ clientMajor: 15, serverMajor: 15 }));
      expect(outcome.status).toBe('fail');
      expectRemedy(outcome);
    });

    it('warns when pg_dump is missing', () => {
      const outcome = decidePgClient(version({ status: 'unknown', client: null, clientMajor: null }));
      expect(outcome.status).toBe('warn');
      expectRemedy(outcome);
    });

    it('passes, saying so, when only the server version is unknown', () => {
      const outcome = decidePgClient(version({ status: 'unknown', serverMajor: null }));
      expect(outcome).toMatchObject({ status: 'pass', detail: expect.stringContaining('could not be read') });
    });

    it('allows pg_dump --version its own timeout and registers itself', async () => {
      const registry = new DoctorCheckRegistry();
      const check = new BackupPgClientDoctorCheck(registry);
      (check as unknown as { probe: () => Promise<PgVersionCheck> }).probe = async () => version({});
      check.onModuleInit();

      await expect(check.run()).resolves.toMatchObject({ status: 'pass' });
      expect(check.timeoutMs).toBeGreaterThan(10_000);
      expect(registry.get('backup.pg-client')).toBe(check);
    });
  });
});

// =============================================================================
// backup.rls-bypass (issue #725): would a dump carry every organization's rows?
// =============================================================================


describe('decideBackupRls', () => {
  const counts = (over: Partial<OrgTableCounts> = {}): OrgTableCounts => ({
    storage_objects: 6,
    storage_object_chunks: 4,
    ai_runs: 6,
    ai_usage_events: 7,
    ...over,
  });

  it('passes when the dump connection counts exactly what the system client counts', () => {
    const outcome = decideBackupRls({ system: counts(), startupOption: counts() });

    expect(outcome.status).toBe('pass');
    expect(outcome.detail).toMatch(/all 23 row\(s\)/);
    expect(outcome.data).toMatchObject({ 'system.storage_objects': 6, 'startupOption.storage_objects': 6 });
  });

  it('fails, naming the tables, when the dump connection sees fewer rows (an empty archive in waiting)', () => {
    const outcome = decideBackupRls({ system: counts(), startupOption: counts({ ai_runs: 0, storage_objects: 0 }) });

    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toMatch(/storage_objects, ai_runs/);
    expect(outcome.remedy).toMatch(/--enable-row-security.*app\.rls_bypass=on/);
  });

  it('warns, not fails, when the startup-option connection cannot be opened (a pooler)', () => {
    const outcome = decideBackupRls({ system: counts(), startupOption: { error: 'unsupported startup parameter' } });

    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toMatch(/unsupported startup parameter/);
    expect(outcome.remedy).toMatch(/direct/);
  });
});

describe('backup.rls-bypass through the DB_BACKUP_SYSTEM_DATA port (#740)', () => {
  /** The bypass side: one doctor-reason transaction, four read-only counts. */
  function systemData(count: number) {
    const sql: string[] = [];
    const reasons: string[] = [];
    const port: DbBackupSystemData = {
      runAsSystem: async (reason, fn) => {
        reasons.push(reason);
        return fn({
          $queryRawUnsafe: async <T>(query: string) => {
            sql.push(query);
            return [{ count: String(count) }] as T;
          },
        });
      },
    };
    return { port, sql, reasons };
  }

  class TestCheck extends BackupRlsDoctorCheck {
    constructor(port: DbBackupSystemData, startup: () => Promise<OrgTableCounts>) {
      super(new DoctorCheckRegistry(), port);
      this.countWithStartupOption = startup;
    }
  }

  const same = (n: number): OrgTableCounts => ({ storage_objects: n, storage_object_chunks: n, ai_runs: n, ai_usage_events: n });

  it('passes when the startup-option side sees every row the bypass client counts', async () => {
    const { port, sql, reasons } = systemData(3);

    const outcome = await new TestCheck(port, async () => same(3)).run();

    expect(outcome.status).toBe('pass');
    expect(reasons).toEqual(['doctor']);
    expect(sql).toHaveLength(4);
    expect(sql.every((text) => /^SELECT count\(\*\)::text AS count FROM [a-z_]+$/.test(text))).toBe(true);
  });

  it('fails when the startup option did not lift row-level security', async () => {
    const { port } = systemData(3);

    const outcome = await new TestCheck(port, async () => same(0)).run();

    expect(outcome.status).toBe('fail');
  });

  it('warns when a connection with the startup option cannot be opened (a pooler)', async () => {
    const { port } = systemData(3);

    const outcome = await new TestCheck(port, async () => {
      throw new Error('unsupported startup parameter: options');
    }).run();

    expect(outcome.status).toBe('warn');
  });
});
