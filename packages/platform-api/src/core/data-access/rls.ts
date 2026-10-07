// =============================================================================
// Row-level security: the contract constants and the two client shapes
// (ADR 0002 D5, issue #725 PP-6.5)
// =============================================================================
//
// The database enforces organisation isolation: every org-owned table has a
// policy keyed on three TRANSACTION-LOCAL settings, and these functions are the
// only code that sets them. The policy text lives in the platform-db migration;
// this file is the other half of that contract.
//
//   app.org_id      the active organisation's UUID   (every scoped operation)
//   app.user_id     the acting user's UUID, or ''    (every scoped operation)
//   app.rls_bypass  'on'                             (the SYSTEM client only)
//
// ⚠ NEVER A SESSION-LEVEL SETTING. Every value is written with
// `set_config(name, value, true)` (the third argument is `is_local`) inside a
// transaction, so it disappears at COMMIT or ROLLBACK. A session-level value
// leaks to the next request on a pooled connection, and it leaks harder behind
// a transaction-mode pooler (PgBouncer, RDS Proxy) that hands the next statement
// of one client to another server connection. The ADR's negative control
// reproduced 600 cross-org rows with a pool of one.
//
// Two shapes, each in a per-operation and an interactive form:
//
//   forOrg / orgScopeExtension / forScope
//       A Prisma client extension: every operation becomes
//       `$transaction([ set_config(...), operation ])` on ONE connection.
//       Covers every model operation AND `$queryRaw` / `$executeRaw`.
//   runInOrg / runInScope
//       One interactive transaction: set_config first, then `fn(tx)` where `tx`
//       is the UNEXTENDED transaction client. Use it for any unit of work of
//       more than one statement.
//
//   forSystem / systemScopeExtension / runAsSystem
//       The same two forms for the bypass flag. They belong on a SEPARATE
//       PrismaClient with its own pool (the app's `PrismaSystemService`).
//
// ⚠ Never use an extended client inside `$transaction(async tx => ...)`: its
// operations open their own transaction and ESCAPE the outer one (a create
// followed by a throw leaves the row committed). That is why `runInOrg` hands
// out the plain `tx`. The extension refuses to run inside an interactive
// transaction when Prisma tells it so (see `insideInteractiveTransaction`).
// =============================================================================

import { trace } from '@opentelemetry/api';
import { Prisma } from '@prisma/client/extension';

import type { Scope } from '../principal/index';
import { ScopedAccessError } from './scoped-access.error';

/**
 * The transaction-local settings the row-level-security policies read.
 *
 * @stability experimental
 * @example
 * ```ts
 * // current_setting(RLS_SETTINGS.orgId, true) inside a policy
 * ```
 */
export const RLS_SETTINGS = Object.freeze({
  /** The active organisation's UUID. */
  orgId: 'app.org_id',
  /** The acting user's UUID, or the empty string. Reserved for owner-based policies. */
  userId: 'app.user_id',
  /** `'on'` lets a transaction see every organisation. Set only by the system client. */
  bypass: 'app.rls_bypass',
} as const);

/**
 * Why code runs without an organisation scope. A closed list so a reviewer can
 * grep the reasons and a test can pin them.
 *
 * - `backup` / `restore`: the database dump and its replay.
 * - `purge`: deleting rows across organisations (storage purge, user and
 *   factory reset).
 * - `doctor`: read-only health checks that count rows across organisations.
 * - `retention`: the retention purge handlers.
 * - `admin-aggregate`: deployment-wide administrator views and aggregates, and
 *   display-only reads such as another user's avatar.
 * - `migration-tooling`: seeds and migration helpers.
 *
 * @stability experimental
 */
export type SystemAccessReason =
  | 'backup'
  | 'restore'
  | 'purge'
  | 'doctor'
  | 'retention'
  | 'admin-aggregate'
  | 'migration-tooling';

/**
 * Every {@link SystemAccessReason}, for validation and tests.
 *
 * @stability experimental
 */
export const SYSTEM_ACCESS_REASONS: readonly SystemAccessReason[] = Object.freeze([
  'backup',
  'restore',
  'purge',
  'doctor',
  'retention',
  'admin-aggregate',
  'migration-tooling',
]);

/**
 * The scope of an org-scoped client: the organisation, and optionally the user
 * the work is done for.
 *
 * @stability experimental
 * @example
 * ```ts
 * const scope: OrgScope = { orgId: principal.activeOrgId!, userId: principal.userId };
 * ```
 */
export interface OrgScope {
  /** The organisation (a UUID): `principal.activeOrgId`, or a job payload's `orgId`. */
  readonly orgId: string;
  /** The acting user (a UUID), when there is one. Becomes `app.user_id`. */
  readonly userId?: string;
}

/**
 * What the scoped functions need from a Prisma client, structurally: the
 * generated `PrismaClient` and the `PLATFORM_PRISMA` port both satisfy it. The
 * transaction methods are typed loosely on purpose (Prisma overloads them).
 *
 * @stability experimental
 */
export interface RlsBaseClient {
  /** Prisma's batch and interactive transaction entry point. */
  $transaction(arg: never, options?: never): Promise<unknown>;
  /** Tagged-template raw statement; lazy, so it can join a batch. */
  $executeRaw(query: TemplateStringsArray, ...values: never[]): unknown;
  /** Prisma's client-extension entry point. */
  $extends(extension: never): unknown;
}

/**
 * What {@link runInOrg} and {@link runAsSystem} need: a client, or the
 * transaction client an outer call handed out (it has no `$transaction`).
 *
 * @stability experimental
 */
export interface RlsRunnableClient {
  /** Tagged-template raw statement. */
  $executeRaw(query: TemplateStringsArray, ...values: never[]): unknown;
}

/**
 * The client an interactive transaction hands its callback: the app's client
 * without the connection and transaction methods, as Prisma types it.
 *
 * @stability experimental
 */
export type RlsTransactionClient<C> = Omit<C, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends' | '$use'>;

/**
 * Options forwarded to Prisma's interactive transaction.
 *
 * @stability experimental
 */
export interface RlsTransactionOptions {
  /** Longest wait for a pooled connection, in milliseconds (Prisma's default is 2000). */
  readonly maxWait?: number;
  /** Longest transaction, in milliseconds (Prisma's default is 5000). */
  readonly timeout?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Throws unless `value` is a UUID. The ids reach `set_config` as bound
 * parameters, never as SQL text, but the policy casts `app.org_id` to `uuid`,
 * so a malformed value would otherwise surface as an opaque cast error on the
 * first query.
 */
function assertUuid(value: unknown, what: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new ScopedAccessError(`${what} must be a UUID, got ${JSON.stringify(value)}.`);
  }
  return value;
}

function validateOrgScope(scope: OrgScope): { orgId: string; userId: string } {
  const orgId = assertUuid(scope?.orgId, 'scope.orgId');
  const userId = scope.userId === undefined || scope.userId === '' ? '' : assertUuid(scope.userId, 'scope.userId');
  return { orgId, userId };
}

function validateReason(reason: unknown): SystemAccessReason {
  if (typeof reason !== 'string' || !(SYSTEM_ACCESS_REASONS as readonly string[]).includes(reason)) {
    throw new ScopedAccessError(
      `A system access needs a reason from ${SYSTEM_ACCESS_REASONS.join(', ')}, got ${JSON.stringify(reason)}.`,
    );
  }
  return reason as SystemAccessReason;
}

/** The `set_config` statement for a scope: one round trip, two settings, both transaction-local. */
function setScopeStatement(client: RlsRunnableClient, scope: { orgId: string; userId: string }): unknown {
  return client.$executeRaw`SELECT set_config('app.org_id', ${scope.orgId as never}, true), set_config('app.user_id', ${scope.userId as never}, true)`;
}

/** The `set_config` statement that lifts row-level security for the transaction. */
function setBypassStatement(client: RlsRunnableClient): unknown {
  return client.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
}

function recordSystemAccess(reason: SystemAccessReason): void {
  const span = trace.getActiveSpan();
  span?.setAttributes({ 'db.access.scope': 'system', 'db.access.reason': reason });
  span?.addEvent('db.rls_bypass', { 'db.access.reason': reason });
}

type TransactionFn = (arg: unknown, options?: unknown) => Promise<unknown>;

function batch(client: RlsBaseClient, statements: unknown[]): Promise<unknown[]> {
  return (client.$transaction as unknown as TransactionFn).call(client, statements) as Promise<unknown[]>;
}

/**
 * The scope an interactive transaction was opened with, so a nested
 * {@link runInOrg} reuses the outer setting instead of opening another.
 */
const TRANSACTION_SCOPES = new WeakMap<object, string>();

function scopeKey(scope: { orgId: string; userId: string }): string {
  return `${scope.orgId}|${scope.userId}`;
}

function isTransactionClient(client: RlsRunnableClient): boolean {
  // Prisma's interactive-transaction client has no `$connect` and no `$extends`
  // (it keeps a `$transaction` that only throws), and the one `runInOrg` handed
  // out is remembered in TRANSACTION_SCOPES.
  const c = client as { $connect?: unknown; $extends?: unknown };
  return TRANSACTION_SCOPES.has(client) || (typeof c.$connect !== 'function' && typeof c.$extends !== 'function');
}

/**
 * The Prisma client extension behind {@link forOrg}: every operation (model
 * operations and raw SQL alike) runs as
 * `$transaction([ set_config('app.org_id', …, true), operation ])`, so the
 * policies see the organisation on the very connection that runs the query.
 *
 * `base` is the client whose pool runs the transaction, usually the client the
 * extension is then applied to.
 *
 * @param base - the app's Prisma client (or the `PLATFORM_PRISMA` port).
 * @param scope - the organisation (and optionally the user); validated as UUIDs.
 * @throws ScopedAccessError when an id is not a UUID.
 *
 * @stability experimental
 * @example
 * ```ts
 * // apps/api/src/prisma/prisma.service.ts
 * forOrg(orgId: string, opts?: { userId?: string }) {
 *   return this.$extends(orgScopeExtension(this, { orgId, userId: opts?.userId }));
 * }
 * ```
 */
export function orgScopeExtension(base: RlsBaseClient, scope: OrgScope) {
  const pinned = validateOrgScope(scope);
  return Prisma.defineExtension({
    name: 'org-scope',
    query: {
      async $allOperations({ args, query, ...rest }) {
        assertNotInsideTransaction(rest);
        const [, result] = await batch(base, [setScopeStatement(base, pinned), query(args)]);
        return result;
      },
    },
  });
}

/**
 * The extension behind {@link forSystem}: the same per-operation batch, setting
 * `app.rls_bypass = 'on'` instead of an organisation. Apply it only to a
 * SEPARATE client (its own pool), so the tenant pool never carries the flag.
 *
 * @param base - the system `PrismaClient`.
 * @param reason - why; recorded on the active span.
 * @throws ScopedAccessError for a reason outside {@link SYSTEM_ACCESS_REASONS}.
 *
 * @stability experimental
 */
export function systemScopeExtension(base: RlsBaseClient, reason: SystemAccessReason) {
  const checked = validateReason(reason);
  return Prisma.defineExtension({
    name: 'system-scope',
    query: {
      async $allOperations({ args, query, ...rest }) {
        assertNotInsideTransaction(rest);
        recordSystemAccess(checked);
        const [, result] = await batch(base, [setBypassStatement(base), query(args)]);
        return result;
      },
    },
  });
}

/**
 * Prisma passes the call's internal parameters beside the public ones. Inside
 * an interactive transaction they carry the transaction handle; an extended
 * client used there would open a second transaction and escape the first.
 */
function assertNotInsideTransaction(rest: Record<string, unknown>): void {
  const internal = rest.__internalParams as { transaction?: unknown } | undefined;
  if (internal?.transaction !== undefined && internal.transaction !== null) {
    throw new ScopedAccessError(
      'A scoped client was used inside $transaction(async tx => ...). Its operations would escape the transaction; ' +
        'use runInOrg()/runAsSystem() and the plain `tx` they hand out instead.',
    );
  }
}

/**
 * The type-level result of {@link forOrg}: whatever the client's `$extends`
 * returns, so the app keeps its generated model types.
 *
 * @stability experimental
 */
export type OrgScopedClient<C extends RlsBaseClient> = ReturnType<C['$extends']>;

/**
 * A client whose every operation runs in a transaction that first sets
 * `app.org_id` (and `app.user_id`) transaction-locally. Fails closed: the
 * policies show this client nothing of another organisation, and refuse an
 * insert naming one.
 *
 * Built per call; `$extends` shares the underlying pool, so this is cheap. Use
 * it for single operations and {@link runInOrg} for a unit of work.
 *
 * @param client - the app's Prisma client.
 * @param orgId - the organisation: `principal.activeOrgId` or a job payload's `orgId`, never request input.
 * @param opts - `userId`, the acting user.
 * @throws ScopedAccessError when an id is not a UUID.
 *
 * @stability experimental
 * @example
 * ```ts
 * const db = forOrg(prisma, principal.activeOrgId!, { userId: principal.userId });
 * await db.storageObject.findMany(); // only this organisation's rows
 * ```
 */
export function forOrg<C extends RlsBaseClient>(client: C, orgId: string, opts: { userId?: string } = {}): OrgScopedClient<C> {
  const extension = orgScopeExtension(client, { orgId, ...(opts.userId !== undefined ? { userId: opts.userId } : {}) });
  return (client.$extends as (extension: unknown) => OrgScopedClient<C>)(extension);
}

/**
 * {@link forOrg} for a {@link Scope}: `scope.orgId` is required here.
 *
 * @param client - the app's Prisma client.
 * @param scope - derived from the principal; `orgId` must be set.
 * @throws ScopedAccessError when `scope.orgId` is missing or an id is not a UUID.
 *
 * @stability experimental
 */
export function forScope<C extends RlsBaseClient>(client: C, scope: Scope): OrgScopedClient<C> {
  if (scope.orgId === undefined) {
    throw new ScopedAccessError('forScope() needs scope.orgId: a client without an organisation sees nothing (fail closed).');
  }
  return forOrg(client, scope.orgId, { userId: scope.userId });
}

/**
 * A client whose every operation sets the bypass flag transaction-locally.
 * Hand it only a client built on its own pool; see {@link systemScopeExtension}.
 *
 * @param client - the system `PrismaClient`.
 * @param reason - why; recorded on the active span.
 * @throws ScopedAccessError for a reason outside {@link SYSTEM_ACCESS_REASONS}.
 *
 * @stability experimental
 * @example
 * ```ts
 * const db = forSystem(systemPrisma, 'retention');
 * await db.aiUsageEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
 * ```
 */
export function forSystem<C extends RlsBaseClient>(client: C, reason: SystemAccessReason): OrgScopedClient<C> {
  return (client.$extends as (extension: unknown) => OrgScopedClient<C>)(systemScopeExtension(client, reason));
}

/**
 * One interactive transaction in an organisation's scope: `set_config` is the
 * first statement, then `fn(tx)` where `tx` is the plain (unextended)
 * transaction client. Rolls back when `fn` throws.
 *
 * Nested use reuses the outer transaction: calling it with a transaction client
 * that is already scoped to the same organisation runs `fn` directly, and
 * calling it with a different organisation throws.
 *
 * Prisma waits only 2 s for a pooled connection by default; pass `maxWait` when
 * many transactions queue behind a small pool (or size the pool for the load).
 *
 * @param client - the app's Prisma client, or a transaction client from an outer {@link runInOrg}.
 * @param scope - the organisation and optionally the user.
 * @param fn - the unit of work; receives the transaction client.
 * @param options - `maxWait` and `timeout`, forwarded to Prisma.
 * @throws ScopedAccessError when an id is not a UUID or a nested call names another organisation.
 *
 * @stability experimental
 * @example
 * ```ts
 * await runInOrg(prisma, { orgId, userId }, async (tx) => {
 *   const object = await tx.storageObject.create({ data });
 *   await tx.auditEvent.create({ data: auditFor(object) });
 * });
 * ```
 */
export async function runInOrg<C extends RlsRunnableClient, R>(
  client: C,
  scope: OrgScope,
  fn: (tx: RlsTransactionClient<C>) => Promise<R>,
  options: RlsTransactionOptions = {},
): Promise<R> {
  const pinned = validateOrgScope(scope);
  const key = scopeKey(pinned);

  if (isTransactionClient(client)) {
    const outer = TRANSACTION_SCOPES.get(client);
    if (outer !== undefined) {
      if (outer !== key) {
        throw new ScopedAccessError('runInOrg() was nested inside a transaction scoped to another organisation or user.');
      }
      return fn(client);
    }
    await setScopeStatement(client, pinned);
    TRANSACTION_SCOPES.set(client, key);
    return fn(client);
  }

  return (client as unknown as { $transaction: TransactionFn }).$transaction(
    async (tx: RlsRunnableClient) => {
      await setScopeStatement(tx, pinned);
      TRANSACTION_SCOPES.set(tx, key);
      return fn(tx as unknown as RlsTransactionClient<C>);
    },
    options,
  ) as Promise<R>;
}

/**
 * {@link runInOrg} for a {@link Scope}: `scope.orgId` is required.
 *
 * @stability experimental
 */
export function runInScope<C extends RlsRunnableClient, R>(
  client: C,
  scope: Scope,
  fn: (tx: RlsTransactionClient<C>) => Promise<R>,
  options: RlsTransactionOptions = {},
): Promise<R> {
  if (scope.orgId === undefined) {
    return Promise.reject(new ScopedAccessError('runInScope() needs scope.orgId: a transaction without an organisation sees nothing (fail closed).'));
  }
  return runInOrg(client, { orgId: scope.orgId, userId: scope.userId }, fn, options);
}

/**
 * One interactive transaction with the bypass flag set transaction-locally.
 * Run it on the SEPARATE system client. `fn` receives the plain transaction
 * client.
 *
 * @param client - the system `PrismaClient`.
 * @param reason - why; recorded on the active span.
 * @param fn - the unit of work.
 * @param options - `maxWait` and `timeout`, forwarded to Prisma.
 * @throws ScopedAccessError for a reason outside {@link SYSTEM_ACCESS_REASONS}.
 *
 * @stability experimental
 * @example
 * ```ts
 * const total = await runAsSystem(systemPrisma, 'doctor', (tx) => tx.storageObject.count());
 * ```
 */
export async function runAsSystem<C extends RlsRunnableClient, R>(
  client: C,
  reason: SystemAccessReason,
  fn: (tx: RlsTransactionClient<C>) => Promise<R>,
  options: RlsTransactionOptions = {},
): Promise<R> {
  const checked = validateReason(reason);
  recordSystemAccess(checked);

  if (isTransactionClient(client)) {
    await setBypassStatement(client);
    return fn(client);
  }

  return (client as unknown as { $transaction: TransactionFn }).$transaction(
    async (tx: RlsRunnableClient) => {
      await setBypassStatement(tx);
      return fn(tx as unknown as RlsTransactionClient<C>);
    },
    options,
  ) as Promise<R>;
}
