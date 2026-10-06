// =============================================================================
// ScopedPrismaService: user-scoped data access and explicit system access
// (issue #688, PP-1.9)
// =============================================================================
//
// `forUser(userId)` / `forScope(scope)` return a Prisma client extension whose
// queries on REGISTERED OWNER MODELS (user-owned-model.registry.ts) are
// confined to the scope's user. Everything else through that client throws
// `ScopedAccessError`: actor-only models, unregistered models and raw SQL. A
// path that needs a system table says so with `asSystem({ kind: 'system',
// reason })`, which returns the plain `PrismaService` and records the reason.
//
// Defence in depth, never a replacement for authorization: every route still
// declares `@Auth(...)`, and a service still decides WHICH user it acts for.
// What this adds is that, once it has decided, a forgotten `where: { userId }`
// cannot read or change another user's rows.
//
// What the extension does per operation, for owner field O and user U:
//
//   findFirst(OrThrow), findMany, count, aggregate, groupBy,
//   updateMany(AndReturn), deleteMany
//       where := { AND: [where ?? {}, { O: U }] }
//   findUnique(OrThrow), update, delete, upsert
//       where := { ...where, AND: [...where.AND, { O: U }] }   (a unique where
//       accepts extra filters; another user's row is "not found", never 403)
//   create, createMany(AndReturn), upsert.create
//       O absent: set to U. O present and different: throw. The owner given
//       as the relation instead (`user: { connect: { id } }`) is accepted only
//       when the id is U.
//   update, updateMany(AndReturn), upsert.update
//       data may not move the row to another owner (throw).
//
// NOT REWRITTEN: nested writes and `include`/`select` of relations. A nested
// write into another user-owned model must go through that model's own
// scoped call. See README.md next to this file.
//
// `Scope.orgId` and `Scope.groupIds` are accepted and ignored: org scoping
// arrives with row-level security (#725) and group grants with #729.
// =============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import type { PrismaClient } from '@prisma/client';

import type { Registry, Scope, SystemActor } from '@marinoscar/platform-api/core';
import { PrismaService } from '../prisma.service';
import { ScopedAccessError } from './scoped-access.error';
// Fills the registry this file reads, whichever path imported it.
import './user-owned-model.manifest';
import {
  ownerRelationOf,
  userOwnedModelRegistry,
  type UserOwnedModelDef,
} from './user-owned-model.registry';

type Args = Record<string, unknown>;

/** Operations whose `where` is a filter: the owner condition is ANDed in. */
const FILTER_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'updateManyAndReturn',
  'deleteMany',
]);

/** Operations whose `where` is a unique where: the owner condition is added to it. */
const UNIQUE_OPERATIONS = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert']);

/** Operations whose `data` creates rows. */
const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);

/** Operations whose `data` updates rows. */
const UPDATE_OPERATIONS = new Set(['update', 'updateMany', 'updateManyAndReturn']);

function isRecord(value: unknown): value is Args {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Field and value a scoped call is pinned to. */
interface Pin {
  readonly model: string;
  readonly operation: string;
  readonly field: string;
  readonly relation: string | undefined;
  readonly userId: string;
}

function refuse(pin: Pick<Pin, 'model' | 'operation'>, message: string): never {
  throw new ScopedAccessError(message, { model: pin.model, operation: pin.operation });
}

function ownerCondition(pin: Pin): Args {
  return { [pin.field]: pin.userId };
}

function scopeFilterWhere(where: unknown, pin: Pin): Args {
  return { AND: [isRecord(where) ? where : {}, ownerCondition(pin)] };
}

function scopeUniqueWhere(where: unknown, pin: Pin): Args {
  const base = isRecord(where) ? where : {};
  const existing = base.AND === undefined ? [] : Array.isArray(base.AND) ? base.AND : [base.AND];
  return { ...base, AND: [...existing, ownerCondition(pin)] };
}

/** The scalar value an update or create assigns, unwrapping `{ set: v }`. */
function assignedValue(value: unknown): unknown {
  return isRecord(value) && 'set' in value ? value.set : value;
}

/** Whether a relation write points exactly at the scope's user: `{ connect: { id: U } }`. */
function isConnectToScopeUser(value: unknown, pin: Pin): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'connect' || !isRecord(value.connect)) return false;
  const connect = value.connect;
  return Object.keys(connect).length === 1 && connect.id === pin.userId;
}

function scopeCreateData(data: unknown, pin: Pin): Args {
  if (!isRecord(data)) refuse(pin, `${pin.model}.${pin.operation}: create data must be an object.`);

  if (pin.field in data) {
    if (assignedValue(data[pin.field]) !== pin.userId) {
      refuse(pin, `${pin.model}.${pin.operation}: ${pin.field} names another user; a scoped client only writes its own user's rows.`);
    }
    return data;
  }

  if (pin.relation !== undefined && pin.relation in data) {
    if (!isConnectToScopeUser(data[pin.relation], pin)) {
      refuse(
        pin,
        `${pin.model}.${pin.operation}: ${pin.relation} must be { connect: { id: <scope user> } }; a scoped client only writes its own user's rows.`,
      );
    }
    return data;
  }

  return { ...data, [pin.field]: pin.userId };
}

function assertUpdateKeepsOwner(data: unknown, pin: Pin): void {
  if (!isRecord(data)) return;
  if (pin.field in data && assignedValue(data[pin.field]) !== pin.userId) {
    refuse(pin, `${pin.model}.${pin.operation}: a scoped client cannot move a row to another owner (${pin.field}).`);
  }
  if (pin.relation !== undefined && pin.relation in data && !isConnectToScopeUser(data[pin.relation], pin)) {
    refuse(pin, `${pin.model}.${pin.operation}: a scoped client cannot change a row's owner (${pin.relation}).`);
  }
}

/**
 * The arguments a user-scoped client passes to Prisma for one call. Pure: it
 * never mutates `args`, and it throws {@link ScopedAccessError} instead of
 * returning when the call is outside the scope.
 *
 * Exported for unit tests and for {@link buildUserScopedClient}; not a
 * public API.
 *
 * @param call - `model` is `undefined` for raw SQL (`$queryRaw` and friends).
 * @param scope - only `userId` is applied (see the file header).
 * @param registry - the user-owned model registry; tests pass a fixture.
 * @internal
 */
export function scopeQueryArgs(
  call: { model?: string; operation: string; args: unknown },
  scope: Scope,
  registry: Pick<Registry<UserOwnedModelDef>, 'get'> = userOwnedModelRegistry,
): unknown {
  const { model, operation } = call;

  if (model === undefined) {
    refuse({ model: '(raw)', operation }, `${operation} is not allowed on a user-scoped client: raw SQL is system-only; use asSystem() with a reason.`);
  }

  const def = registry.get(model);
  const field = def?.ownerField;
  if (def === undefined || field === undefined) {
    refuse({ model, operation }, `${model} is not user-owned; use asSystem() with a reason.`);
  }

  const pin: Pin = { model, operation, field, relation: ownerRelationOf(def), userId: scope.userId };
  const args: Args = isRecord(call.args) ? { ...call.args } : {};

  if (FILTER_OPERATIONS.has(operation)) {
    args.where = scopeFilterWhere(args.where, pin);
  } else if (UNIQUE_OPERATIONS.has(operation)) {
    args.where = scopeUniqueWhere(args.where, pin);
  } else if (!CREATE_OPERATIONS.has(operation)) {
    refuse(pin, `${model}.${operation} is not supported on a user-scoped client; use asSystem() with a reason.`);
  }

  if (CREATE_OPERATIONS.has(operation)) {
    args.data = Array.isArray(args.data)
      ? args.data.map((row) => scopeCreateData(row, pin))
      : scopeCreateData(args.data, pin);
  }
  if (UPDATE_OPERATIONS.has(operation)) {
    assertUpdateKeepsOwner(args.data, pin);
  }
  if (operation === 'upsert') {
    args.create = scopeCreateData(args.create, pin);
    assertUpdateKeepsOwner(args.update, pin);
  }

  return args;
}

function assertScope(scope: Scope): void {
  if (typeof scope?.userId !== 'string' || scope.userId.trim() === '') {
    throw new ScopedAccessError('A scope must name a user: scope.userId is empty.');
  }
}

/**
 * A client whose queries on registered owner models are confined to
 * `scope.userId`, and which refuses every other model and raw SQL.
 *
 * Built per call; `$extends` shares the underlying connection pool, so this is
 * cheap. Prefer {@link ScopedPrismaService.forUser} in Nest code.
 *
 * @stability experimental
 * @example
 * ```ts
 * const db = buildUserScopedClient(prisma, { userId });
 * await db.userCredential.findMany(); // only userId's rows
 * ```
 */
export function buildUserScopedClient(prisma: PrismaClient, scope: Scope) {
  assertScope(scope);
  const pinned: Scope = { userId: scope.userId };
  return prisma.$extends({
    name: 'user-scope',
    query: {
      $allOperations({ model, operation, args, query }) {
        return query(scopeQueryArgs({ model, operation, args }, pinned) as typeof args);
      },
    },
  });
}

/**
 * A user-scoped Prisma client. See {@link buildUserScopedClient}.
 *
 * @stability experimental
 */
export type UserScopedClient = ReturnType<typeof buildUserScopedClient>;

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
    return buildUserScopedClient(this.prisma, scope);
  }

  /** Shorthand for `forScope({ userId })`. */
  forUser(userId: string): UserScopedClient {
    return this.forScope({ userId });
  }

  /**
   * The unscoped client, for system work (backups, purges, the Doctor,
   * cross-user admin reads). The reason is logged at debug and set on the
   * active span as `db.access.scope = 'system'` and `db.access.reason`. Never
   * a metric label (cardinality).
   *
   * @throws ScopedAccessError when the actor is not a system actor with a reason.
   */
  asSystem(actor: SystemActor): PrismaService {
    if (actor?.kind !== 'system' || typeof actor.reason !== 'string' || actor.reason.trim() === '') {
      throw new ScopedAccessError('asSystem() needs { kind: "system", reason } with a non-empty reason.');
    }
    this.logger.debug(`Unscoped database access: ${actor.reason}`);
    trace.getActiveSpan()?.setAttributes({
      'db.access.scope': 'system',
      'db.access.reason': actor.reason,
    });
    return this.prisma;
  }
}
