// The db-backup contract (#740): representative bodies, rows and node results
// parse, the confirmation literals are literal, and the value lists match the
// schemas built from them.
import { describe, expect, it } from 'vitest';

import {
  BACKUP_STATUSES,
  BACKUP_TRIGGERS,
  RESTORE_CONFIRMATION,
  RESTORE_GATE_IDS,
  ROLLBACK_CONFIRMATION,
  backupRunListQuerySchema,
  databaseBackupConfigSchema,
  databaseBackupSettingsPatchSchema,
  dbBackupRunResultSchema,
  restoreGateSchema,
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
});
