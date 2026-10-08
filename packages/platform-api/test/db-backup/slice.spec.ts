// The db-backup slice's own surface (#740): forRoot options and the
// deployment-mode gate, the RestoreCarryOver registry, the key-prefix
// registration, the conformance suite and the migration comparison with a
// synced platform migration name.
import { Test } from '@nestjs/testing';

import { RegistryError, withTemporaryEntries } from '../../src/core/index';
import { storageKeyPrefixRegistry } from '../../src/storage/index';
import {
  registerRestoreCarryOver,
  registerRestoreCarryOvers,
  restoreCarryOverRegistry,
  type RestoreCarryOver,
} from '../../src/db-backup/carry-over.registry';
import { DB_BACKUP_KEY_PREFIX, registerDbBackupKeyPrefix } from '../../src/db-backup/db-backup-key-prefix';
import { DB_BACKUP_PERMISSIONS } from '../../src/db-backup/db-backup.permissions';
import { DatabaseRestoreDisabledError } from '../../src/db-backup/db-backup.errors';
import { compareMigrationNames } from '../../src/db-backup/migration-state.util';
import {
  DB_BACKUP_OPTIONS,
  defaultAppVersion,
  resolveDbBackupModuleOptions,
  resolveRestoreEnabled,
} from '../../src/db-backup/options';
import { DB_BACKUP_DEPLOYMENT_MODE } from '../../src/db-backup/ports';
import { DbBackupRestoreGate, restoreGateFor } from '../../src/db-backup/restore-gate';
import {
  checkBackupKeyPrefix,
  checkCarryOvers,
  checkJobTypes,
  checkRlsPair,
  checkSystemScopePermissions,
  dbBackupConformanceSuite,
} from '../../src/db-backup/testing/conformance';

const carry = (id: string, order: number): RestoreCarryOver => ({
  id,
  order,
  exportSql: `SELECT * FROM ${id}`,
  reinsertSql: `INSERT INTO ${id} SELECT * FROM jsonb_populate_record(NULL::${id}, $1::jsonb) ON CONFLICT (id) DO NOTHING`,
});

describe('DbBackupModule.forRoot options', () => {
  it('defaults every option to the behaviour before the move', () => {
    const resolved = resolveDbBackupModuleOptions();

    expect(resolved.appName).toBe('app');
    expect(resolved.deploymentMode).toBeUndefined();
    expect(resolved.restoreEnabled).toBeUndefined();
    expect(resolved.scheduleEnabled).toBeUndefined();
    expect(resolved.imports).toEqual([]);
    expect(resolved.appVersion).toBe(defaultAppVersion);
  });

  it('accepts a version string or a resolver', () => {
    expect(resolveDbBackupModuleOptions({ appVersion: '9.9.9' }).appVersion()).toBe('9.9.9');
    expect(resolveDbBackupModuleOptions({ appVersion: () => '1.2.3' }).appVersion()).toBe('1.2.3');
  });

  it('refuses an unknown deployment mode at forRoot time', () => {
    expect(() => resolveDbBackupModuleOptions({ deploymentMode: 'cloud' as never })).toThrow(/deploymentMode/);
  });
});

describe('the deployment-mode restore gate', () => {
  it.each([
    [{}, undefined, true],
    [{}, 'self-hosted' as const, true],
    [{}, 'saas' as const, false],
    [{ deploymentMode: 'saas' as const }, 'self-hosted' as const, false],
    [{ deploymentMode: 'self-hosted' as const }, 'saas' as const, true],
    [{ restoreEnabled: true }, 'saas' as const, true],
    [{ restoreEnabled: false }, 'self-hosted' as const, false],
  ])('options %j with the port saying %s -> restore %s', (options, port, expected) => {
    expect(resolveRestoreEnabled(options, port)).toBe(expected);
  });

  it('refuses with DatabaseRestoreDisabledError (403, details.reason deployment_mode_saas) in saas', () => {
    const gate = restoreGateFor('saas');

    expect(gate.inAppRestoreEnabled).toBe(false);
    expect(gate.mode).toBe('saas');
    expect(() => gate.assertInAppRestoreEnabled()).toThrow(DatabaseRestoreDisabledError);
    expect(() => restoreGateFor('self-hosted').assertInAppRestoreEnabled()).not.toThrow();
  });

  it('reads the app-bound DB_BACKUP_DEPLOYMENT_MODE port through Nest', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DbBackupRestoreGate,
        { provide: DB_BACKUP_OPTIONS, useValue: resolveDbBackupModuleOptions() },
        { provide: DB_BACKUP_DEPLOYMENT_MODE, useValue: { mode: 'saas' } },
      ],
    }).compile();

    expect(moduleRef.get(DbBackupRestoreGate).inAppRestoreEnabled).toBe(false);
  });

  it('is self-hosted when nothing is bound', async () => {
    const moduleRef = await Test.createTestingModule({ providers: [DbBackupRestoreGate] }).compile();

    expect(moduleRef.get(DbBackupRestoreGate)).toMatchObject({ mode: 'self-hosted', inAppRestoreEnabled: true });
  });
});

describe('the RestoreCarryOver registry', () => {
  it('lists carries in ascending order, ties in registration order', async () => {
    await withTemporaryEntries(restoreCarryOverRegistry, [carry('c_late', 20), carry('c_first', 5), carry('c_tie', 20)], () => {
      expect(restoreCarryOverRegistry.ids()).toEqual(['c_first', 'c_late', 'c_tie']);
    });
  });

  it('refuses a duplicate id', async () => {
    await withTemporaryEntries(restoreCarryOverRegistry, [carry('c_dup', 1)], () => {
      expect(() => registerRestoreCarryOver(carry('c_dup', 2))).toThrow(RegistryError);
    });
  });

  it('skips an identical re-registration, so forRoot and an app file may both name one', async () => {
    await withTemporaryEntries(restoreCarryOverRegistry, [carry('c_same', 1)], () => {
      expect(() => registerRestoreCarryOvers([carry('c_same', 1)])).not.toThrow();
      expect(restoreCarryOverRegistry.ids()).toEqual(['c_same']);
    });
  });

  it('refuses a carry whose reinsert does not bind the row as $1', async () => {
    await withTemporaryEntries(restoreCarryOverRegistry, [], () => {
      expect(() => registerRestoreCarryOver({ ...carry('c_bad', 1), reinsertSql: 'INSERT INTO t VALUES (1)' })).toThrow(RegistryError);
    });
  });

  it('is frozen after bootstrap', async () => {
    await withTemporaryEntries(restoreCarryOverRegistry, [], () => {
      restoreCarryOverRegistry.freeze();
      expect(() => registerRestoreCarryOver(carry('c_late_registration', 1))).toThrow(RegistryError);
    });
  });
});

describe('the database-backups key prefix', () => {
  it('registers through the storage key-prefix registry, deployment scope, idempotently', async () => {
    await withTemporaryEntries(storageKeyPrefixRegistry, [], () => {
      registerDbBackupKeyPrefix();
      registerDbBackupKeyPrefix();

      expect(storageKeyPrefixRegistry.get('database-backups')).toEqual(DB_BACKUP_KEY_PREFIX);
      expect(DB_BACKUP_KEY_PREFIX).toMatchObject({ prefix: 'database-backups/', scope: 'deployment', owner: 'db-backup' });
    });
  });
});

describe('the db-backup conformance suite', () => {
  it('passes for the slice as shipped', async () => {
    await withTemporaryEntries(storageKeyPrefixRegistry, [DB_BACKUP_KEY_PREFIX], () => {
      expect(checkRlsPair()).toEqual([]);
      expect(checkJobTypes()).toEqual([]);
      expect(checkSystemScopePermissions()).toEqual([]);
      expect(checkBackupKeyPrefix()).toEqual([]);
      expect(checkCarryOvers([])).toEqual([]);
      expect(dbBackupConformanceSuite.check({ sourceRoots: [] } as never, {}).findings).toEqual([]);
    });
  });

  it('reports a missing prefix, a missing required carry and an org-scoped permission', async () => {
    await withTemporaryEntries(storageKeyPrefixRegistry, [], () => {
      expect(checkBackupKeyPrefix()).toHaveLength(1);
    });
    expect(checkCarryOvers(['release_artifacts'])).toEqual([expect.objectContaining({ file: 'db-backup-carry-over' })]);
    expect(Object.values(DB_BACKUP_PERMISSIONS).every((def) => def.scope === 'system')).toBe(true);
  });
});

describe('schema_compatibility with synced platform migration names (#710)', () => {
  // Platform migrations are installed into an app's history under app-local
  // ids (`YYYYMMDDHHMMSS_<name>`, `platform db sync`), so within ONE app's
  // `_prisma_migrations` the lexicographic order is the apply order.
  it('orders a synced platform migration against the app migrations around it', () => {
    expect(compareMigrationNames('20261008041856_add_org_credentials', '20261008052119_add_jobs_org_id')).toBe('archive_older');
    expect(compareMigrationNames('20261008052120_add_jobs_org_id_status_index', '20261008052119_add_jobs_org_id')).toBe('archive_newer');
    expect(compareMigrationNames('20261008052119_add_jobs_org_id', '20261008052119_add_jobs_org_id')).toBe('match');
    expect(compareMigrationNames(null, '20261008052119_add_jobs_org_id')).toBe('unknown');
  });
});
