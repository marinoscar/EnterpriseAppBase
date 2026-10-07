import { Injectable, OnModuleInit } from '@nestjs/common';
import { Client } from 'pg';

import {
  DoctorCheck,
  DoctorCheckOutcome,
  DoctorCheckRegistry,
} from '@marinoscar/platform-api/doctor';
import { buildDatabaseUrl } from '../../common/database-url';
import { PrismaSystemService } from '../../prisma/prisma-system.service';
import { RLS_BYPASS_PGOPTIONS } from '../pg-dump.util';
import { BACKUP_SETTINGS_PATH } from './backup-schedule.doctor-check';

/** The org-owned tables a backup must carry in full. */
const ORG_TABLES = ['storage_objects', 'storage_object_chunks', 'ai_runs', 'ai_usage_events'] as const;

/** Row counts of the org-owned tables, per table. */
export type OrgTableCounts = Record<(typeof ORG_TABLES)[number], number>;

/** The counts as flat doctor data: `<prefix>.<table>`. */
function flat(prefix: string, counts: OrgTableCounts): Record<string, number> {
  return Object.fromEntries(ORG_TABLES.map((table) => [`${prefix}.${table}`, Number(counts[table] ?? 0)]));
}

/** What the check compares. */
export interface BackupRlsFacts {
  /** Counted by the system client (the bypass flag set transaction-locally). */
  system: OrgTableCounts;
  /** Counted over a connection that carries the `app.rls_bypass` STARTUP OPTION, as `pg_dump` and `pg_restore` do. */
  startupOption: OrgTableCounts | { error: string };
}

const RUNBOOK = 'docs/specs/database-backup.md (Row-level security)';

/**
 * Pure: would a dump of this database carry every row?
 *
 * `pg_dump --enable-row-security` WITHOUT the `app.rls_bypass` startup option
 * exits 0 and writes an archive with no rows: a plausible, successful, empty
 * backup. This check counts the org-owned tables twice, once with the system
 * client and once over a connection carrying the option the dump uses, and
 * fails when they differ.
 *
 * - `fail`: a count differs (the option did not lift row-level security).
 * - `warn`: the connection with the startup option could not be made (a
 *   transaction-mode pooler refuses it: dump and restore need a DIRECT
 *   connection to the database).
 * - `pass`: every count matches.
 */
export function decideBackupRls(facts: BackupRlsFacts): DoctorCheckOutcome {
  if ('error' in facts.startupOption) {
    return {
      status: 'warn',
      detail: `A connection carrying the "${RLS_BYPASS_PGOPTIONS}" startup option could not be opened: ${facts.startupOption.error}`,
      remedy:
        'pg_dump and pg_restore need a direct (or session-mode) connection to the database: a transaction-mode ' +
        `pooler rejects the startup option. Point POSTGRES_HOST/POSTGRES_PORT at the database itself. See ${RUNBOOK}.`,
      data: flat('system', facts.system),
    };
  }

  const differing = ORG_TABLES.filter((table) => facts.system[table] !== (facts.startupOption as OrgTableCounts)[table]);
  const data = { ...flat('system', facts.system), ...flat('startupOption', facts.startupOption as OrgTableCounts) };

  if (differing.length > 0) {
    return {
      status: 'fail',
      detail:
        `A backup would be incomplete: ${differing.join(', ')} count differently under the dump's startup option ` +
        '(system client vs the option): the archive would be written with missing rows',
      remedy:
        `Check that the API role is NOSUPERUSER NOBYPASSRLS and that dump and restore run with BOTH ` +
        `--enable-row-security and PGOPTIONS="${RLS_BYPASS_PGOPTIONS}". Fix it before the next scheduled backup. ` +
        `See ${RUNBOOK} and the backup settings at ${BACKUP_SETTINGS_PATH}.`,
      data,
    };
  }

  const total = ORG_TABLES.reduce((sum, table) => sum + facts.system[table], 0);
  return { status: 'pass', detail: `A dump sees all ${total} row(s) of the organization-owned tables`, data };
}

/**
 * `backup` / `backup.rls-bypass` — a dump's connection sees every organization's
 * rows. Read-only: four counts over the system client and the same four over a
 * short-lived `pg` connection with the dump's startup option; nothing is
 * written.
 */
@Injectable()
export class BackupRlsDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'backup.rls-bypass';
  readonly category = 'backup';
  readonly label = 'Backups carry every organization';
  readonly settingsPath = BACKUP_SETTINGS_PATH;
  readonly dependsOn = ['db.connection'];
  readonly timeoutMs = 20_000;

  /** Overridable in tests: the counts over a connection carrying the startup option. */
  protected countWithStartupOption: () => Promise<OrgTableCounts> = () => countWithStartupOption();

  constructor(
    private readonly registry: DoctorCheckRegistry,
    private readonly system: PrismaSystemService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    const system = await this.system.runAsSystem('doctor', async (tx) => ({
      storage_objects: await tx.storageObject.count(),
      storage_object_chunks: await tx.storageObjectChunk.count(),
      ai_runs: await tx.aiRun.count(),
      ai_usage_events: await tx.aiUsageEvent.count(),
    }));

    try {
      return decideBackupRls({ system, startupOption: await this.countWithStartupOption() });
    } catch (error) {
      return decideBackupRls({
        system,
        startupOption: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }
}

async function countWithStartupOption(): Promise<OrgTableCounts> {
  const client = new Client({ connectionString: buildDatabaseUrl(), options: RLS_BYPASS_PGOPTIONS, application_name: 'doctor-backup-rls' });
  await client.connect();

  try {
    const counts: Partial<OrgTableCounts> = {};
    for (const table of ORG_TABLES) {
      const { rows } = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table}`);
      counts[table] = Number(rows[0]?.count ?? 0);
    }
    return counts as OrgTableCounts;
  } finally {
    await client.end();
  }
}
