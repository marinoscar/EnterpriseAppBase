import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import {
  orgScopeExtension,
  runInOrg,
  userScopeExtension,
  type RlsTransactionOptions,
  type Scope,
} from '@marinoscar/platform-api/core';

// One shared builder rather than a third private copy of the formula; the
// header of that module explains what the three copies did to each other.
import { buildDatabaseUrl } from '../common/database-url';
// Fills the user-owned registry that forUser() reads (platform, then app).
import './ownership/user-owned-model.manifest';
import './ownership/model-ownership.manifest';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const adapter = new PrismaPg(buildDatabaseUrl());
    super({
      adapter,
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');

    // Log queries in development
    if (process.env.NODE_ENV === 'development') {
      // @ts-ignore - Prisma event typing
      this.$on('query', (e: any) => {
        this.logger.debug(`Query: ${e.query}`);
        this.logger.debug(`Duration: ${e.duration}ms`);
      });
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }

  /**
   * A client whose queries on registered user-owned models are confined to
   * `scope.userId`, typed with this app's generated models. The mechanism is
   * `userScopeExtension` from `@marinoscar/platform-api/core` (issue #699);
   * Nest code usually reaches it through `ScopedPrismaService.forUser(userId)`.
   *
   * @throws ScopedAccessError when `scope.userId` is empty.
   */
  forUser(scope: Scope) {
    return this.$extends(userScopeExtension(scope));
  }

  /**
   * A client whose every operation runs in a transaction that first sets the
   * transaction-local `app.org_id` (and `app.user_id`), so row-level security
   * shows it one organization's rows and refuses an insert naming another
   * (issue #725, ADR 0002 D5). The ONLY way to reach an `org` table
   * (`storage_objects`, `storage_object_chunks`, `ai_runs`, `ai_usage_events`)
   * from tenant code: this pool's role is subject to FORCEd policies, so an
   * unscoped query on such a table returns no rows and an unscoped insert fails.
   *
   * Good for single operations (each costs one extra statement). A unit of
   * work of more than one statement uses {@link PrismaService.runInOrg}; never
   * open `$transaction(async tx => ...)` on the returned client (its
   * operations would escape the transaction; the extension throws).
   *
   * @param orgId - `principal.activeOrgId`, or a job payload's `orgId`; never request input.
   * @param opts - `userId`: the acting user, becomes `app.user_id`.
   * @throws ScopedAccessError when an id is not a UUID.
   */
  forOrg(orgId: string, opts: { userId?: string } = {}) {
    return this.$extends(orgScopeExtension(this, { orgId, ...opts }));
  }

  /**
   * One interactive transaction in an organization's scope: `set_config` is
   * the first statement and `fn` receives the plain transaction client (use
   * it for everything inside, `jobs` included). Nested calls with the same
   * scope reuse the outer transaction.
   *
   * `notify()` belongs AFTER this returns, never inside `fn`.
   *
   * @param orgId - `principal.activeOrgId`, or a job payload's `orgId`.
   * @param fn - the unit of work.
   * @param opts - `userId` and Prisma's `maxWait` / `timeout`.
   */
  runInOrg<R>(
    orgId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
    opts: { userId?: string } & RlsTransactionOptions = {},
  ): Promise<R> {
    const { userId, ...transaction } = opts;
    return runInOrg(
      this,
      { orgId, ...(userId !== undefined ? { userId } : {}) },
      fn as (tx: unknown) => Promise<R>,
      transaction,
    );
  }

  /**
   * Clean database for testing
   */
  async cleanDatabase() {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('cleanDatabase only allowed in test environment');
    }

    const tablenames = await this.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname='public'
    `;

    for (const { tablename } of tablenames) {
      if (tablename !== '_prisma_migrations') {
        await this.$executeRawUnsafe(
          `TRUNCATE TABLE "public"."${tablename}" CASCADE;`,
        );
      }
    }
  }
}
