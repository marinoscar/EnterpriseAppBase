// =============================================================================
// PrismaSystemService: the bypass connection (issue #725 PP-6.5, ADR 0002 D5)
// =============================================================================
//
// Cross-organisation work (backups, purges, retention, the Doctor, deployment
// wide admin aggregates) must see every organisation's rows, and row-level
// security is FORCEd on the org tables, so the tenant pool (`PrismaService`)
// cannot do it. This is the ONE other way in: a SEPARATE `PrismaClient` with
// its own small `pg` pool, whose every transaction sets `app.rls_bypass = 'on'`
// transaction-locally. Same database role and URL as the tenant pool, so no
// new environment variable and no new role; its sessions carry
// `application_name = '<app>-system'` so an operator can tell them apart in
// `pg_stat_activity`.
//
// WHY A SEPARATE POOL, NOT A FLAG ON THE TENANT CLIENT. The flag can never
// reach a tenant request's connection, whatever a bug does: the two pools share
// no backend, the flag does not outlive its transaction, and the tenant pool
// stays fail-closed after system work (all verified in the ADR). It is the
// same reasoning as `db-backup/admin-connection.util.ts`, which stays as the
// cluster-admin connection.
//
// ONLY AN ALLOWLIST OF MODULES MAY INJECT IT. `test/tenancy/system-injection-
// boundary.spec.ts` scans every constructor and `@Inject` and fails on any
// file outside `SYSTEM_PRISMA_ALLOWLIST`; adding a file there is a reviewed
// decision. Each acquisition names a closed `SystemAccessReason`, puts it on
// the active span (`db.access.reason`, plus a `db.rls_bypass` event) and logs
// it at debug. The reason is never a metric label.
//
// The pool is small on purpose (system work is batch work, not request
// traffic): `SYSTEM_POOL_MAX`.
// =============================================================================

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { APP_SLUG } from '@app/shared';

import {
  runAsSystem,
  systemScopeExtension,
  type RlsTransactionOptions,
  type SystemAccessReason,
} from '@marinoscar/platform-api/core';

import { buildDatabaseUrl } from '../common/database-url';

/** Connections the system pool may hold. Small: system work is batch work. */
export const SYSTEM_POOL_MAX = 4;

/** `application_name` of every system session. */
export const SYSTEM_APPLICATION_NAME = `${APP_SLUG}-system`;

@Injectable()
export class PrismaSystemService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaSystemService.name);

  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString: buildDatabaseUrl(),
        max: SYSTEM_POOL_MAX,
        application_name: SYSTEM_APPLICATION_NAME,
      }),
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log(`System database pool connected (${SYSTEM_APPLICATION_NAME}, max ${SYSTEM_POOL_MAX})`);
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * A client whose every operation lifts row-level security for its own
   * transaction. Name the reason; it is recorded on the active span and
   * logged at debug.
   *
   * One operation per transaction: for a unit of work of more than one
   * statement use {@link PrismaSystemService.runAsSystem}. Never open
   * `$transaction(async tx => ...)` on the returned client.
   *
   * @throws ScopedAccessError for a reason outside the closed list.
   */
  asSystem(reason: SystemAccessReason) {
    const client = this.$extends(systemScopeExtension(this, reason));
    this.logger.debug(`System database access: ${reason}`);
    return client;
  }

  /**
   * One interactive transaction with the bypass flag set, handing `fn` the
   * plain transaction client.
   *
   * @throws ScopedAccessError for a reason outside the closed list.
   */
  runAsSystem<R>(
    reason: SystemAccessReason,
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
    options: RlsTransactionOptions = {},
  ): Promise<R> {
    this.logger.debug(`System database access: ${reason}`);
    return runAsSystem(this, reason, fn as (tx: unknown) => Promise<R>, options);
  }
}

/** The client {@link PrismaSystemService.asSystem} returns, with this app's generated model types. */
export type SystemPrismaClient = ReturnType<PrismaSystemService['asSystem']>;
