// The db-backup contract (#740): representative bodies, rows and node results
// parse, the confirmation literals are literal, and the value lists match the
// schemas built from them.
import { describe, expect, it } from 'vitest';

import {
  BACKUP_FREQUENCIES,
  BACKUP_STATUSES,
  BUILTIN_RESTORE_GATE_IDS,
  BACKUP_TRIGGERS,
  RESTORE_CONFIRMATION,
  RESTORE_GATE_IDS,
  ROLLBACK_CONFIRMATION,
  backupRunListQuerySchema,
  databaseBackupConfigSchema,
  databaseBackupSettingsPatchSchema,
  dbBackupRunResultSchema,
  restoreGateIdSchema,
  restoreGateSchema,
  updateDatabaseBackupConfigSchema,
  rollbackRestoreRequestSchema,
  startRestoreRequestSchema,
  systemDatabaseBackupSchema,
} from '../src/db-backup/index.js';

const STORED = {
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
};

describe('@marinoscar/platform-contract/db-backup', () => {
  it('parses the stored namespace and refuses a malformed time of day', () => {
    expect(systemDatabaseBackupSchema.parse(STORED)).toEqual(STORED);
    expect(systemDatabaseBackupSchema.safeParse({ ...STORED, timeOfDay: '2:00' }).success).toBe(false);
    expect(databaseBackupSettingsPatchSchema.parse({ storageProvider: '' })).toEqual({ storageProvider: '' });
  });

  it('carries the deployment-mode restore fact on the config response', () => {
    const body = {
      ...STORED,
      nextRunAt: null,
      activeRunId: null,
      restore: { available: false, reason: 'deployment_mode_saas' },
    };
    expect(databaseBackupConfigSchema.parse(body).restore).toEqual({ available: false, reason: 'deployment_mode_saas' });
  });

  it('requires the typed confirmation literals, never a boolean', () => {
    expect(startRestoreRequestSchema.safeParse({ confirmation: RESTORE_CONFIRMATION }).success).toBe(true);
    expect(startRestoreRequestSchema.safeParse({ confirm: true }).success).toBe(false);
    expect(rollbackRestoreRequestSchema.safeParse({ confirmation: ROLLBACK_CONFIRMATION }).success).toBe(true);
    expect(rollbackRestoreRequestSchema.safeParse({ confirmation: RESTORE_CONFIRMATION }).success).toBe(false);
  });

  it('builds the list query enums from the value lists', () => {
    for (const status of BACKUP_STATUSES) expect(backupRunListQuerySchema.parse({ status }).status).toBe(status);
    for (const trigger of BACKUP_TRIGGERS) expect(backupRunListQuerySchema.parse({ trigger }).trigger).toBe(trigger);
    expect(backupRunListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('accepts every gate id on a gate', () => {
    for (const id of RESTORE_GATE_IDS) {
      const gate = { id, kind: 'capability', verdict: 'pass', title: 't', detail: 'd', action: null };
      expect(restoreGateSchema.parse(gate).id).toBe(id);
    }
  });

  it('takes a node result whose byte count is a decimal string and refuses a number', () => {
    const result = {
      storageKey: 'database-backups/app/2026/10/app-x.dump',
      bytes: '18446744073709551615',
      sha256: 'a'.repeat(64),
      pgDumpVersion: '16.4',
      dbVersion: '16.4',
      migrationName: '0031_add_jobs_org_id_status_index',
      startedAt: '2026-10-08T02:00:00.000Z',
      finishedAt: '2026-10-08T02:10:00.000Z',
    };
    expect(dbBackupRunResultSchema.safeParse(result).success).toBe(true);
    expect(dbBackupRunResultSchema.safeParse({ ...result, bytes: 1234 }).success).toBe(false);
  });

  it('renames the closed gate list to the built-ins and keeps the old name as an alias', () => {
    expect(RESTORE_GATE_IDS).toBe(BUILTIN_RESTORE_GATE_IDS);
    expect(BUILTIN_RESTORE_GATE_IDS).toHaveLength(8);
  });

  it('takes an app gate id on a gate and refuses a malformed one', () => {
    const gate = { id: 'cdn-quiesced', kind: 'app', verdict: 'block', title: 'CDN quiesced', detail: 'd', action: null };
    expect(restoreGateSchema.parse(gate).id).toBe('cdn-quiesced');
    expect(restoreGateIdSchema.safeParse('Not A Gate').success).toBe(false);
    expect(restoreGateIdSchema.safeParse('').success).toBe(false);
    for (const id of BUILTIN_RESTORE_GATE_IDS) expect(restoreGateIdSchema.safeParse(id).success).toBe(true);
  });

  describe('the schedule and retention policy', () => {
    it('loads a row stored before cron and retention existed, and returns it unchanged', () => {
      const parsed = systemDatabaseBackupSchema.parse(STORED);
      expect(parsed).toEqual(STORED);
      expect(parsed).not.toHaveProperty('cron');
      expect(parsed).not.toHaveProperty('retention');
    });

    it('accepts the cron frequency with an expression and refuses a malformed one', () => {
      expect(BACKUP_FREQUENCIES).toEqual(['daily', 'weekly', 'monthly', 'cron']);
      const cron = { ...STORED, frequency: 'cron', cron: '0 */6 * * *' };
      expect(systemDatabaseBackupSchema.parse(cron)).toEqual(cron);
      expect(systemDatabaseBackupSchema.safeParse({ ...cron, cron: '@hourly' }).success).toBe(false);
      expect(systemDatabaseBackupSchema.safeParse({ ...cron, cron: 'a'.repeat(121) }).success).toBe(false);
    });

    it('takes retention beside the retentionCount alias, on the stored, patch and config shapes', () => {
      const retention = { count: 10, maxAgeDays: 30 };
      expect(systemDatabaseBackupSchema.parse({ ...STORED, retention }).retention).toEqual(retention);
      expect(databaseBackupSettingsPatchSchema.parse({ retention: { maxAgeDays: 14 } }).retention).toEqual({ maxAgeDays: 14 });
      expect(updateDatabaseBackupConfigSchema.parse({ retentionCount: 3 })).toEqual({ retentionCount: 3 });
      expect(systemDatabaseBackupSchema.safeParse({ ...STORED, retention: { maxAgeDays: 0 } }).success).toBe(false);
      expect(systemDatabaseBackupSchema.safeParse({ ...STORED, retention: { count: 366 } }).success).toBe(false);
    });
  });
});
