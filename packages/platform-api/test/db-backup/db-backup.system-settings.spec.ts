// The `databaseBackup` namespace after the schedule policy and the retention
// object (PP-14.12): a row stored by the previous version still loads and
// round-trips unchanged, `retentionCount` and `retention.count` are one value
// under two names (read AND write), and `cron` is carried through a merge.
import {
  databaseBackupSettingsPatchSchema,
  systemDatabaseBackupSchema,
  updateDatabaseBackupConfigSchema,
  type SystemDatabaseBackupValue,
} from '@marinoscar/platform-contract/db-backup';
import {
  DATABASE_BACKUP_SYSTEM_SETTINGS,
  mergeDatabaseBackupSettings,
  resolveBackupRetention,
} from '../../src/db-backup/db-backup.system-settings';

/** The row exactly as the previous version stored it: thirteen fields, no `cron`, no `retention`. */
const STORED_BEFORE_PP_14_12 = {
  enabled: true,
  frequency: 'weekly',
  dayOfWeek: 3,
  dayOfMonth: 1,
  timeOfDay: '02:30',
  timezone: 'America/New_York',
  retentionCount: 12,
  storageProvider: 's3',
  runStaleMinutes: 180,
  compressionLevel: 6,
  restoreRollbackMode: 'retain_database',
  oldDatabaseRetentionHours: 48,
  nodeOffloadEnabled: false,
} as const;

const current = (extra: Partial<SystemDatabaseBackupValue> = {}): SystemDatabaseBackupValue => ({
  ...(STORED_BEFORE_PP_14_12 as SystemDatabaseBackupValue),
  ...extra,
});

describe('a row stored before cron and retention existed', () => {
  it('loads through the stored schema and comes back identical', () => {
    const loaded = systemDatabaseBackupSchema.parse(STORED_BEFORE_PP_14_12);

    expect(loaded).toEqual(STORED_BEFORE_PP_14_12);
    expect(Object.keys(loaded)).not.toContain('cron');
    expect(Object.keys(loaded)).not.toContain('retention');
  });

  it('still reads as the same retention', () => {
    expect(resolveBackupRetention(STORED_BEFORE_PP_14_12)).toEqual({ count: 12 });
  });

  it('an empty merge returns the same shape: no cron, no retention keys appear', () => {
    const merged = mergeDatabaseBackupSettings(current());

    expect(merged).toEqual(STORED_BEFORE_PP_14_12);
    expect(Object.keys(merged)).not.toContain('retention');
    expect(Object.keys(merged)).not.toContain('cron');
  });

  it('a patch that only the previous version could send writes the same row it always did', () => {
    const patch = updateDatabaseBackupConfigSchema.parse({ retentionCount: 5, timeOfDay: '04:00' });

    expect(mergeDatabaseBackupSettings(current(), patch)).toEqual({ ...STORED_BEFORE_PP_14_12, retentionCount: 5, timeOfDay: '04:00' });
  });

  it('still declares the same defaults: a fresh deployment is unchanged', () => {
    expect(DATABASE_BACKUP_SYSTEM_SETTINGS.defaults).toEqual({
      enabled: false,
      frequency: 'daily',
      dayOfWeek: 0,
      dayOfMonth: 1,
      timeOfDay: '02:00',
      timezone: 'UTC',
      retentionCount: 7,
      storageProvider: '',
      runStaleMinutes: 120,
      compressionLevel: 6,
      restoreRollbackMode: 'retain_database',
      oldDatabaseRetentionHours: 48,
      nodeOffloadEnabled: false,
    });
  });
});

describe('retentionCount and retention.count are one value', () => {
  it('writing retention.count also writes the alias, and wins over a retentionCount in the same patch', () => {
    const merged = mergeDatabaseBackupSettings(current(), databaseBackupSettingsPatchSchema.parse({ retention: { count: 20 }, retentionCount: 3 }));

    expect(merged.retentionCount).toBe(20);
    expect(merged.retention).toEqual({ count: 20 });
  });

  it('writing the alias moves a stored retention.count too, so the two cannot diverge', () => {
    const merged = mergeDatabaseBackupSettings(
      current({ retention: { count: 20, maxAgeDays: 30 } }),
      databaseBackupSettingsPatchSchema.parse({ retentionCount: 9 })
    );

    expect(merged.retentionCount).toBe(9);
    expect(merged.retention).toEqual({ count: 9, maxAgeDays: 30 });
  });

  it('writing the alias leaves a retention without a count alone', () => {
    const merged = mergeDatabaseBackupSettings(
      current({ retention: { maxAgeDays: 30 } }),
      databaseBackupSettingsPatchSchema.parse({ retentionCount: 9 })
    );

    expect(merged.retention).toEqual({ maxAgeDays: 30 });
    expect(resolveBackupRetention(merged)).toEqual({ count: 9, maxAgeDays: 30 });
  });

  it('retention replaces the stored object whole, and an empty one clears the age bound', () => {
    const withAge = current({ retention: { count: 12, maxAgeDays: 30 } });

    expect(mergeDatabaseBackupSettings(withAge, databaseBackupSettingsPatchSchema.parse({ retention: { maxAgeDays: 10 } })).retention).toEqual({
      maxAgeDays: 10,
    });
    const cleared = mergeDatabaseBackupSettings(withAge, databaseBackupSettingsPatchSchema.parse({ retention: {} }));
    expect(cleared.retention).toEqual({});
    expect(resolveBackupRetention(cleared)).toEqual({ count: 12 });
  });

  it('reads the count from retention first, then the alias', () => {
    expect(resolveBackupRetention({ retentionCount: 7, retention: { count: 3, maxAgeDays: 14 } })).toEqual({ count: 3, maxAgeDays: 14 });
    expect(resolveBackupRetention({ retentionCount: 7, retention: {} })).toEqual({ count: 7 });
    expect(resolveBackupRetention({ retentionCount: 7 })).toEqual({ count: 7 });
  });

  it('the merged value always validates against the stored schema', () => {
    const merged = mergeDatabaseBackupSettings(
      current(),
      databaseBackupSettingsPatchSchema.parse({ frequency: 'cron', cron: '0 */6 * * *', retention: { count: 4, maxAgeDays: 30 } })
    );

    expect(() => systemDatabaseBackupSchema.parse(merged)).not.toThrow();
    expect(merged).toMatchObject({ frequency: 'cron', cron: '0 */6 * * *', retentionCount: 4 });
  });
});

describe('cron', () => {
  it('is carried through a merge that does not mention it', () => {
    const merged = mergeDatabaseBackupSettings(
      current({ frequency: 'cron', cron: '0 3 * * 1-5' }),
      databaseBackupSettingsPatchSchema.parse({ timezone: 'UTC' })
    );

    expect(merged.cron).toBe('0 3 * * 1-5');
    expect(merged.timezone).toBe('UTC');
  });

  it('is replaced by a patch that names it', () => {
    expect(
      mergeDatabaseBackupSettings(current({ cron: '0 3 * * *' }), databaseBackupSettingsPatchSchema.parse({ cron: '0 */4 * * *' })).cron
    ).toBe('0 */4 * * *');
  });
});
