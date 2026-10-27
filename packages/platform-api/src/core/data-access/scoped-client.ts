// =============================================================================
// Scoped data access: forUser() and asSystem() (issue #688 PP-1.9, moved to
// core by #699)
// =============================================================================
//
// `forUser(client, scope)` returns a Prisma client extension whose queries on
// REGISTERED OWNER MODELS (./user-owned-data.registry.ts) are confined to the
// scope's user. Everything else through that client throws `ScopedAccessError`:
// actor-only models, unregistered models and raw SQL. A path that needs a
// system table says so with `asSystem(client, { kind: 'system', reason })`,
// which returns the client unchanged and records the reason on the active span.
//
// SCHEMA-INDEPENDENT: the extension is built with `Prisma.defineExtension` from
// `@prisma/client/extension`, which does not depend on any generated client.
// Model names are strings looked up in the registry the app fills; nothing
// here imports a generated model type. The app's client is passed in at call
// time (in a packaged slice: the `PLATFORM_PRISMA` host port).
//
// Defence in depth, never a replacement for authorization: every route still
// declares its access, and a service still decides WHICH user it acts for.
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
// scoped call. See README.md next to this folder.
//
// `Scope.orgId` and `Scope.groupIds` are accepted and ignored: org scoping
// arrives with row-level security (#725) and group grants with #729.
// =============================================================================

import { trace } from '@opentelemetry/api';
import { Prisma } from '@prisma/client/extension';

import type { Scope, SystemActor } from '../principal/index';
import { ScopedAccessError } from './scoped-access.error';
import type { UserOwnedModelLookup } from './types';
import { ownerRelationOf, userOwnedModelRegistry } from './user-owned-data.registry';

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
 * Not exported from the package entry point; the package's unit tests import
 * it from this file.
 *
 * @param call - `model` is `undefined` for raw SQL (`$queryRaw` and friends).
 * @param scope - only `userId` is applied (see the file header).
 * @param registry - the user-owned model registry; tests pass a fixture.
 * @internal
 */
export function scopeQueryArgs(
  call: { model?: string; operation: string; args: unknown },
  scope: Scope,
  registry: UserOwnedModelLookup = userOwnedModelRegistry,
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
 * The Prisma client extension {@link userScopeExtension} returns: a function
 * of a client, as `Prisma.defineExtension` builds it, that adds no models,
 * results or client methods (all four type arguments empty), so the extended
 * client keeps the app's generated types.
 *
 * @stability experimental
 */
export type UserScopeExtension = ReturnType<typeof Prisma.defineExtension<{}, {}, {}, {}>>;

/**
 * The extension behind {@link forUser}: confines queries on registered owner
 * models to `scope.userId` and refuses every other model and raw SQL. Pass it
 * to the app's own client with `$extends` when the call site needs the app's
 * generated types (the reference app's `PrismaService.forUser`).
 *
 * @param scope - only `userId` is applied; `orgId` and `groupIds` are accepted and ignored until #725 and #729.
 * @param registry - defaults to {@link userOwnedModelRegistry}.
 * @throws ScopedAccessError when `scope.userId` is empty.
 *
 * @stability experimental
 * @example
 * ```ts
 * // apps/api/src/prisma/prisma.service.ts
 * forUser(scope: Scope) {
 *   return this.$extends(userScopeExtension(scope));
 * }
 * ```
 */
export function userScopeExtension(scope: Scope, registry: UserOwnedModelLookup = userOwnedModelRegistry): UserScopeExtension {
  assertScope(scope);
  const pinned: Scope = { userId: scope.userId };
  return Prisma.defineExtension({
    name: 'user-scope',
    query: {
      $allOperations({ model, operation, args, query }) {
        return query(scopeQueryArgs({ model, operation, args }, pinned, registry) as typeof args);
      },
    },
  });
}

/**
 * The structural shape {@link forUser} needs from a client: `$extends`. The
 * app's generated `PrismaClient` and the `PLATFORM_PRISMA` host port's
 * `PrismaClientLike` both satisfy it.
 *
 * @stability experimental
 */
export interface ExtendableClient {
  /** Prisma's client-extension entry point. */
  $extends(extension: never): unknown;
}

/**
 * A client whose queries on registered owner models are confined to
 * `scope.userId`, and which refuses every other model and raw SQL.
 *
 * Built per call; `$extends` shares the underlying connection pool, so this is
 * cheap. Interactive transactions on the returned client stay scoped. The
 * return type is whatever the client's `$extends` returns; an app that wants
 * its generated model types back uses {@link userScopeExtension} on its own
 * client instead.
 *
 * @param client - the app's Prisma client (or the `PLATFORM_PRISMA` port).
 * @param scope - derived from the principal, never from request input.
 * @param registry - defaults to {@link userOwnedModelRegistry}.
 * @throws ScopedAccessError when `scope.userId` is empty.
 *
 * @stability experimental
 * @example
 * ```ts
 * const db = forUser(prisma, { userId: principal.userId });
 * await db.userCredential.findMany(); // only that user's rows
 * ```
 */
export function forUser<C extends ExtendableClient>(
  client: C,
  scope: Scope,
  registry: UserOwnedModelLookup = userOwnedModelRegistry,
): ReturnType<C['$extends']> {
  const extension = userScopeExtension(scope, registry);
  return (client.$extends as (extension: UserScopeExtension) => ReturnType<C['$extends']>)(extension);
}

/**
 * The explicit, greppable marker for deliberately unscoped work (backups,
 * purges, the Doctor, cross-user admin reads, actor-only tables). Returns
 * `client` unchanged after checking the actor, and sets
 * `db.access.scope = 'system'` and `db.access.reason` on the active span. The
 * reason is never a metric label (cardinality).
 *
 * @param client - the unscoped client to hand back.
 * @param actor - `{ kind: 'system', reason }` with a short, non-empty reason.
 * @throws ScopedAccessError when the actor is not a system actor with a reason.
 *
 * @stability experimental
 * @example
 * ```ts
 * const db = asSystem(prisma, { kind: 'system', reason: 'retention.purge' });
 * await db.notification.deleteMany({ where: { createdAt: { lt: cutoff } } });
 * ```
 */
export function asSystem<C>(client: C, actor: SystemActor): C {
  if (actor?.kind !== 'system' || typeof actor.reason !== 'string' || actor.reason.trim() === '') {
    throw new ScopedAccessError('asSystem() needs { kind: "system", reason } with a non-empty reason.');
  }
  trace.getActiveSpan()?.setAttributes({
    'db.access.scope': 'system',
    'db.access.reason': actor.reason,
  });
  return client;
}
