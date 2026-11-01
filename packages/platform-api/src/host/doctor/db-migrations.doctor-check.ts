import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';

import { PLATFORM_PRISMA, type PrismaClientLike } from '../../core/index';
import { DoctorCheckRegistry, type DoctorCheck, type DoctorCheckOutcome } from '../../doctor/index';

/**
 * What the one `_prisma_migrations` read returns.
 *
 * @stability experimental
 */
export interface MigrationState {
  /** Finished and not rolled back. */
  applied: number;
  /** Started and never finished, not rolled back: failed or still running. */
  unfinished: number;
  /** Rolled back, with no later successful application of the same name. */
  rolledBack: number;
  /** The oldest unfinished migration's name, for the detail line. */
  firstUnfinished: string | null;
}

/**
 * Pure: the verdict on the migration history.
 *
 * @param state - the counts one `_prisma_migrations` read returns.
 * @returns the check outcome.
 *
 * @stability experimental
 */
export function decideMigrations(state: MigrationState): DoctorCheckOutcome {
  const data = { applied: state.applied, unfinished: state.unfinished, rolledBack: state.rolledBack };

  if (state.unfinished > 0) {
    return {
      status: 'fail',
      detail:
        `${state.unfinished} migration(s) started but did not finish` +
        (state.firstUnfinished ? ` (first: ${state.firstUnfinished})` : ''),
      remedy:
        'Inspect the failed migration and fix the database, then mark it with ' +
        '`node scripts/prisma-env.js migrate resolve --rolled-back <name>` (or --applied) in the ' +
        'api container and run `npm run prisma:migrate` again.',
      data,
    };
  }

  if (state.rolledBack > 0) {
    return {
      status: 'fail',
      detail: `${state.rolledBack} migration(s) are marked rolled back and were never re-applied`,
      remedy: 'Run `npm run prisma:migrate` (in the api container) to apply them again.',
      data,
    };
  }

  if (state.applied === 0) {
    return {
      status: 'fail',
      detail: 'No migration has been applied to this database',
      remedy: 'Run `npm run prisma:migrate` in the api container, then `npm run prisma:seed`.',
      data,
    };
  }

  return { status: 'pass', detail: `${state.applied} migrations applied, none failed`, data };
}

/**
 * `core` / `db.migrations` — no migration is half-applied.
 *
 * One read-only `SELECT` against Prisma's own bookkeeping table, through the
 * `PLATFORM_PRISMA` host port.
 *
 * @stability experimental
 */
@Injectable()
export class DbMigrationsDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'db.migrations';
  readonly category = 'core';
  readonly label = 'Database migrations';
  readonly dependsOn = ['db.connection'];

  constructor(
    private readonly registry: DoctorCheckRegistry,
    @Optional() @Inject(PLATFORM_PRISMA) private readonly prisma?: PrismaClientLike,
  ) {}

  /** Registers the check with the Doctor. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    const prisma = this.prisma;
    if (!prisma) {
      return { status: 'skip', detail: 'No database client is bound to PLATFORM_PRISMA, so there is no migration history to read' };
    }

    try {
      const rows = await prisma.$queryRaw<
        Array<{ applied: unknown; unfinished: unknown; rolled_back: unknown; first_unfinished: unknown }>
      >`
        SELECT
          (SELECT count(*) FROM _prisma_migrations
            WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied,
          (SELECT count(*) FROM _prisma_migrations
            WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS unfinished,
          (SELECT count(DISTINCT m.migration_name) FROM _prisma_migrations m
            WHERE m.rolled_back_at IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM _prisma_migrations a
                 WHERE a.migration_name = m.migration_name
                   AND a.finished_at IS NOT NULL AND a.rolled_back_at IS NULL))::int AS rolled_back,
          (SELECT migration_name FROM _prisma_migrations
            WHERE finished_at IS NULL AND rolled_back_at IS NULL
            ORDER BY started_at LIMIT 1) AS first_unfinished`;

      const row = rows?.[0];

      return decideMigrations({
        applied: Number(row?.applied ?? 0),
        unfinished: Number(row?.unfinished ?? 0),
        rolledBack: Number(row?.rolled_back ?? 0),
        firstUnfinished: typeof row?.first_unfinished === 'string' ? row.first_unfinished : null,
      });
    } catch (error) {
      return {
        status: 'fail',
        detail: 'Could not read the migration history (_prisma_migrations)',
        remedy: 'Run `npm run prisma:migrate` in the api container; the table is created by the first migration.',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
