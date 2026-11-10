// =============================================================================
// The db-backup slice's conformance suite (issue #740)
// =============================================================================
//
// Importing `@marinoscar/platform-api/db-backup/testing` registers it with
// `runPlatformConformance` (suite id `db-backup`). Static checks over the
// slice's own declarations, so they run in any app's unit tier without a
// database:
//
//   1. every dump and every restore carries BOTH `--enable-row-security` and
//      `PGOPTIONS=-c app.rls_bypass=on`, the option in the environment and
//      never in argv (CLAUDE.md invariant; the real-database proof is the
//      app's `db-backup-rls.db.spec.ts`);
//   2. `db.restore.run` is server-only (no `nodeResultSchema`, no
//      `persistNodeResult`); `db.backup.run` is node-eligible with profile
//      `{ maxRuntimeMs: 6 h, maxAttempts: 1 }` and a credential broker;
//   3. the three `db_backup:*` permissions are system scope;
//   4. the `database-backups/` key prefix is registered, deployment scope;
//   5. every registered restore carry-over binds its row as `$1`.
//
// The app's integration and real-database suites (`apps/api/test/db-backup/`)
// stay where the composed app is; see the slice README, "Conformance suite".
// =============================================================================

import { conformanceSuites } from '../../testing/index';
import type { ConformanceCase, ConformanceFinding, ConformanceReport, ConformanceSuite } from '../../testing/index';
import { storageKeyPrefixRegistry } from '../../storage/index';
import { restoreCarryOverRegistry } from '../carry-over.registry';
import { DB_BACKUP_KEY_PREFIX } from '../db-backup-key-prefix';
import { DB_BACKUP_PERMISSIONS } from '../db-backup.permissions';
import { BACKUP_JOB_MAX_RUNTIME_MS, DatabaseBackupRunHandler } from '../handlers/db-backup-run.handler';
import { DatabaseRestoreRunHandler } from '../handlers/db-restore-run.handler';
import { buildPgDumpArgs, rlsBypassEnv, type PgConnection } from '../pg-dump.util';
import { buildPgRestoreArgs } from '../pg-restore.util';

declare module '../../testing/index' {
  interface PlatformConformanceSuiteOptions {
    /** The db-backup slice's suite: its options, or `false` to opt out. Registered by importing `@marinoscar/platform-api/db-backup/testing`. */
    dbBackup?: DbBackupConformanceOptions | false;
  }
}

/**
 * Options of the `db-backup` suite.
 *
 * @stability experimental
 */
export interface DbBackupConformanceOptions {
  /** Restore carry-over ids the app must have registered (its own tables). */
  readonly requiredCarryOverIds?: readonly string[];
}

const FILE_RLS = 'db-backup-rls-pair';
const FILE_JOBS = 'db-backup-job-types';
const FILE_PERMS = 'db-backup-permissions';
const FILE_PREFIX = 'db-backup-key-prefix';
const FILE_CARRY = 'db-backup-carry-over';

const PROBE: PgConnection = { host: 'db', port: '5432', user: 'app', password: 'probe', database: 'appdb', sslMode: null };

/**
 * Check 1: the dump and restore argument vectors carry `--enable-row-security`,
 * the child environment carries the bypass option, and argv never does.
 *
 * @returns one finding per problem.
 * @stability experimental
 */
export function checkRlsPair(): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const vectors = { pg_dump: buildPgDumpArgs({ connection: PROBE }), pg_restore: buildPgRestoreArgs({ connection: PROBE }) };
  for (const [tool, args] of Object.entries(vectors)) {
    if (!args.includes('--enable-row-security')) {
      findings.push({ file: FILE_RLS, message: `${tool} is spawned without --enable-row-security: a dump would refuse every org table` });
    }
    if (args.join(' ').includes('app.rls_bypass')) {
      findings.push({ file: FILE_RLS, message: `${tool}'s argv carries app.rls_bypass: the option belongs in PGOPTIONS, never in argv` });
    }
  }
  if (!(rlsBypassEnv({}).PGOPTIONS ?? '').includes('app.rls_bypass=on')) {
    findings.push({ file: FILE_RLS, message: 'rlsBypassEnv() does not set PGOPTIONS=-c app.rls_bypass=on: --enable-row-security alone writes an archive with no rows' });
  }
  return findings;
}

/**
 * Check 2: `db.restore.run` is server-only and `db.backup.run` is
 * node-eligible with its declared profile and broker.
 *
 * @returns one finding per problem.
 * @stability experimental
 */
export function checkJobTypes(): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const none = undefined as never;
  const restore = new DatabaseRestoreRunHandler(none, none, none) as unknown as Record<string, unknown>;
  if (restore.nodeResultSchema !== undefined || typeof restore.persistNodeResult === 'function') {
    findings.push({ file: FILE_JOBS, message: 'db.restore.run declares a node result: the restore is server-only, permanently' });
  }
  const backup = new DatabaseBackupRunHandler(none, none, none, {} as never) as unknown as Record<string, unknown>;
  if (backup.nodeResultSchema === undefined || typeof backup.persistNodeResult !== 'function') {
    findings.push({ file: FILE_JOBS, message: 'db.backup.run lost node eligibility (nodeResultSchema + persistNodeResult)' });
  }
  if (backup.nodeSecretBroker === undefined) {
    findings.push({ file: FILE_JOBS, message: 'db.backup.run lost its nodeSecretBroker: a node could not be issued its job-scoped role' });
  }
  const profile = backup.profile as { maxRuntimeMs?: number; maxAttempts?: number } | undefined;
  if (profile?.maxRuntimeMs !== BACKUP_JOB_MAX_RUNTIME_MS || profile.maxAttempts !== 1 || BACKUP_JOB_MAX_RUNTIME_MS !== 6 * 60 * 60 * 1000) {
    findings.push({ file: FILE_JOBS, message: 'db.backup.run must keep profile { maxRuntimeMs: 6 h, maxAttempts: 1 }' });
  }
  return findings;
}

/**
 * Check 3: every `db_backup:*` permission is system scope.
 *
 * @returns one finding per org-scoped permission.
 * @stability experimental
 */
export function checkSystemScopePermissions(): ConformanceFinding[] {
  return Object.values(DB_BACKUP_PERMISSIONS)
    .filter((def) => def.scope !== 'system')
    .map((def) => ({ file: FILE_PERMS, message: `${def.id} is ${def.scope} scope: a restore rolls back every organization` }));
}

/**
 * Check 4: the `database-backups/` prefix is registered with deployment scope.
 *
 * @returns one finding per problem.
 * @stability experimental
 */
export function checkBackupKeyPrefix(): ConformanceFinding[] {
  const def = storageKeyPrefixRegistry.get(DB_BACKUP_KEY_PREFIX.id);
  if (def === undefined) return [{ file: FILE_PREFIX, message: 'the database-backups/ prefix is not registered: a storage purge would leave every archive' }];
  if (def.prefix !== DB_BACKUP_KEY_PREFIX.prefix || def.scope !== 'deployment') {
    return [{ file: FILE_PREFIX, message: `the database-backups prefix is registered as "${def.prefix}" (${def.scope}), not "${DB_BACKUP_KEY_PREFIX.prefix}" (deployment)` }];
  }
  return [];
}

/**
 * Check 5: every carry-over binds its row and the required ones exist.
 *
 * @param requiredIds - ids the app must have registered.
 * @returns one finding per problem.
 * @stability experimental
 */
export function checkCarryOvers(requiredIds: readonly string[]): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  for (const carry of restoreCarryOverRegistry.list()) {
    if (!carry.reinsertSql.includes('$1')) findings.push({ file: FILE_CARRY, message: `carry-over "${carry.id}" does not bind its row as $1` });
  }
  for (const id of requiredIds) {
    if (!restoreCarryOverRegistry.has(id)) findings.push({ file: FILE_CARRY, message: `carry-over "${id}" is not registered: its rows would not survive a restore` });
  }
  return findings;
}

/**
 * The `db-backup` conformance suite.
 *
 * @stability experimental
 */
export const dbBackupConformanceSuite: ConformanceSuite<DbBackupConformanceOptions> = {
  id: 'db-backup',
  title: 'the db-backup slice keeps its invariants',
  description:
    'Every dump and restore lifts row-level security with both halves of the pair, the restore stays server-only, the backup stays node-eligible, the permissions are system scope and the archives are a registered key prefix.',
  check(_context, options): ConformanceReport {
    const findings = [
      ...checkRlsPair(),
      ...checkJobTypes(),
      ...checkSystemScopePermissions(),
      ...checkBackupKeyPrefix(),
      ...checkCarryOvers(options.requiredCarryOverIds ?? []),
    ];
    return {
      scanned: { tools: 2, jobTypes: 2, permissions: Object.keys(DB_BACKUP_PERMISSIONS).length, carryOvers: restoreCarryOverRegistry.size },
      scannedFiles: {},
      findings,
    };
  },
  cases(): ConformanceCase[] {
    const only = (file: string) => (report: ConformanceReport) => report.findings.filter((finding) => finding.file === file);
    return [
      { name: 'rls: pg_dump and pg_restore carry --enable-row-security and PGOPTIONS app.rls_bypass=on (never in argv)', run: (report, expect) => expect(only(FILE_RLS)(report)).toEqual([]) },
      { name: 'jobs: db.restore.run is server-only; db.backup.run is node-eligible with its profile and broker', run: (report, expect) => expect(only(FILE_JOBS)(report)).toEqual([]) },
      { name: 'permissions: db_backup:read, :write and :restore are system scope', run: (report, expect) => expect(only(FILE_PERMS)(report)).toEqual([]) },
      { name: 'storage: database-backups/ is a registered deployment-scope key prefix', run: (report, expect) => expect(only(FILE_PREFIX)(report)).toEqual([]) },
      { name: 'carry-over: every registered carry binds its row, and the required ones exist', run: (report, expect) => expect(only(FILE_CARRY)(report)).toEqual([]) },
    ];
  },
};

if (!conformanceSuites.has(dbBackupConformanceSuite.id)) conformanceSuites.register(dbBackupConformanceSuite);
