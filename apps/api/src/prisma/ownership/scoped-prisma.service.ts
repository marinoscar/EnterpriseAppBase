// =============================================================================
// ScopedPrismaService: user-scoped data access and explicit system access
// (issue #688, PP-1.9; mechanism moved to @marinoscar/platform-api/core by #699)
// =============================================================================
//
// A thin Nest wrapper. The mechanism (the user-owned registry, the scoped
// client extension and its per-operation rewriting, `asSystem`'s checks and
// span attributes) lives in `@marinoscar/platform-api/core`, "Scoped data
// access". What stays here is the binding to this app's `PrismaService`, so
// call sites keep the generated model types, and the debug log line.
//
// `forUser(userId)` / `forScope(scope)` extend the injected client with the
// package's `userScopeExtension(scope)`, as `PrismaService.forUser` does:
// queries on REGISTERED OWNER MODELS are confined to the scope's user, and
// everything else through that client throws `ScopedAccessError` (actor-only
// models, unregistered models, raw SQL). `asSystem({ kind: 'system', reason })`
// returns the plain `PrismaService` and records the reason.
//
// Defence in depth, never a replacement for authorization: every route still
// declares `@Auth(...)`, and a service still decides WHICH user it acts for.
// See README.md next to this file.
// =============================================================================

import { Injectable, Logger } from '@nestjs/common';

import { asSystem, userScopeExtension, type Scope, type SystemActor } from '@marinoscar/platform-api/core';
import { PrismaService } from '../prisma.service';
// Fills the registry the scoped client reads, whichever path imported this.
import './user-owned-model.manifest';

/**
 * A user-scoped Prisma client with this app's generated model types. See
 * `PrismaService.forUser` and `userScopeExtension` in
 * `@marinoscar/platform-api/core`.
 *
 * @stability experimental
 */
export type UserScopedClient = ReturnType<PrismaService['forUser']>;

/**
 * Hands out user-scoped clients and the explicit unscoped one.
 *
 * Provided and exported by the global `PrismaModule`.
 *
 * @stability experimental
 */
@Injectable()
export class ScopedPrismaService {
  private readonly logger = new Logger(ScopedPrismaService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * A client whose queries on user-owned models are confined to
   * `scope.userId`. `scope.orgId` and `scope.groupIds` are accepted and
   * ignored until row-level security (#725) and group grants (#729).
   *
   * @throws ScopedAccessError when `scope.userId` is empty.
   */
  forScope(scope: Scope): UserScopedClient {
    // Same expression as PrismaService.forUser, on the injected client.
    return this.prisma.$extends(userScopeExtension(scope));
  }

  /** Shorthand for `forScope({ userId })`. */
  forUser(userId: string): UserScopedClient {
    return this.forScope({ userId });
  }

  /**
   * The unscoped client, for system work (backups, purges, the Doctor,
   * cross-user admin reads). The package's `asSystem` checks the actor and
   * sets `db.access.scope = 'system'` and `db.access.reason` on the active
   * span; the reason is also logged at debug. Never a metric label
   * (cardinality).
   *
   * @throws ScopedAccessError when the actor is not a system actor with a reason.
   */
  asSystem(actor: SystemActor): PrismaService {
    const client = asSystem(this.prisma, actor);
    this.logger.debug(`Unscoped database access: ${actor.reason}`);
    return client;
  }
}
