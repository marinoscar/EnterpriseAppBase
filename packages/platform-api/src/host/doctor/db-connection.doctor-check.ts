import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';

import { PLATFORM_PRISMA, type PrismaClientLike } from '../../core/index';
import { DoctorCheckRegistry, type DoctorCheck, type DoctorCheckOutcome } from '../../doctor/index';

/**
 * Above this round trip the database answers, but slowly enough to notice.
 *
 * @stability experimental
 */
export const DB_SLOW_LATENCY_MS = 500;

/**
 * `core` / `db.connection` — the database answers `SELECT 1`.
 *
 * One `SELECT 1` through the `PLATFORM_PRISMA` host port, timed. The check has
 * no other dependency: an app binds nothing for it beyond the port every
 * slice already needs.
 *
 * @stability experimental
 */
@Injectable()
export class DbConnectionDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'db.connection';
  readonly category = 'core';
  readonly label = 'Database connection';

  constructor(
    private readonly registry: DoctorCheckRegistry,
    @Optional() @Inject(PLATFORM_PRISMA) private readonly prisma?: PrismaClientLike,
  ) {}

  /** Registers the check with the Doctor. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    if (!this.prisma) {
      return { status: 'skip', detail: 'No database client is bound to PLATFORM_PRISMA, so there is nothing to probe' };
    }

    try {
      const startedAt = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      const latencyMs = Date.now() - startedAt;

      if (latencyMs > DB_SLOW_LATENCY_MS) {
        return {
          status: 'warn',
          detail: `Connected, but SELECT 1 took ${latencyMs} ms`,
          remedy:
            'Check the database host load and the network path between the API and PostgreSQL ' +
            '(POSTGRES_HOST); a healthy round trip is a few milliseconds.',
          data: { latencyMs },
        };
      }

      return {
        status: 'pass',
        detail: `Connected in ${latencyMs} ms`,
        data: { latencyMs },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      return {
        status: 'fail',
        detail: 'The database did not answer',
        remedy:
          'Check PostgreSQL is running and reachable, and that the POSTGRES_HOST, POSTGRES_PORT, ' +
          'POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DB variables are correct.',
        error: message,
      };
    }
  }
}
