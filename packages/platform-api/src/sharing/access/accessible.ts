// =============================================================================
// "Resources I can see": scoped query helpers (issue #729, PP-7.2)
// =============================================================================
//
// List endpoints ask the inverse of `AccessPolicy`: not "may I see THIS
// record" but "WHICH records may I see". Three helpers answer it in one query,
// with no N+1 and no per-row decision:
//
//   accessibleWhere()   a Prisma `where` fragment, for `findMany`/`count`
//   accessibleSql()     an SQL condition with an `EXISTS (...)` on `grants`,
//                       for `$queryRaw` (the ONLY sanctioned raw-SQL path)
//   sharedResourceIds() the ids shared with the caller, bounded
//
// THE SCOPES (`AccessScope`):
//
//   owned   owner_user_id = me
//   groups  owned by a group I belong to (whose group role maps to minRole or more)
//   shared  an ACTIVE, UNEXPIRED user or group grant with minRole or more, or
//           the type's `defaultVisibility: 'org'` when `orgRole` reaches minRole
//   all     the union (the default)
//
// Every form also requires the record to be in the caller's ACTIVE
// organization (`orgField`/`orgColumn`; pass `null` to leave it to RLS).
//
// THE THRESHOLD. A Prisma `where` cannot embed SQL, so `accessibleWhere` turns
// the shared part into `id IN (...)`. It loads AT MOST `SHARED_IDS_INLINE_LIMIT`
// (1,000) ids for that: above it, it does not grow the list, it SWITCHES to
// the EXISTS form and returns `{ form: 'exists', sql }` (the same rows, through
// `accessibleSql`), which the caller runs with `$queryRaw`. kvox's
// `sharedTranscriptIds` loaded every id on every list; this is the fix.
//
// Bypass permissions and `actionPermissions` are about ACTIONS: they are
// `AccessPolicy`'s, not the list helpers'. A route that shows "every record of
// the organization" to an administrator does so without these helpers.
//
// THE SQL KIT. The package never imports Prisma (no generated client, no
// runtime subpath: it is built before any `prisma generate`), so the SQL
// helpers build their fragment with the app's own `Prisma` namespace, passed
// as `sqlKit: Prisma` (`sql`, `join`, `raw`, `empty`), exactly as the e-mail
// renderers take the app's `html` kit. The result is the app's `Prisma.Sql`,
// which nests in its `$queryRaw` templates.
//
// Give every helper a principal the `PrincipalGroupsProvider` enriched
// (`principalGroups.enrich(principal)`): its `groups` are the caller's groups
// of the active organization (`Scope.groupIds`). An unenriched principal has
// none.
// =============================================================================

import type { AccessScope } from '@marinoscar/platform-contract/sharing';

import type { Principal } from '../../core/index';
import { asSharingTx } from '../data/sharing-tx';
import { activeGroupsOf } from '../ownership';
import { requireResourceType, type ResolvedResourceType } from './resource-types';

/**
 * Above this many shared ids, `accessibleWhere` switches to the EXISTS form
 * instead of inlining an id list.
 *
 * @stability stable
 */
export const SHARED_IDS_INLINE_LIMIT = 1000;

/**
 * The app's raw-SQL builders, structurally: pass the generated `Prisma`
 * namespace (`Prisma.sql`, `Prisma.join`, `Prisma.raw`, `Prisma.empty`). Every
 * value goes through `sql` as a bind parameter; `raw` only ever receives
 * validated identifiers.
 *
 * @typeParam S - the app's `Prisma.Sql`.
 *
 * @stability stable
 */
export interface SqlKit<S> {
  /** The tagged template (`Prisma.sql`): every interpolation is a bind parameter or a nested fragment. */
  sql(strings: readonly string[], ...values: unknown[]): S;
  /** Joins values or fragments with a separator (`Prisma.join`). */
  join(values: readonly unknown[], separator?: string): S;
  /** A fragment of literal SQL (`Prisma.raw`); here only for checked identifiers. */
  raw(text: string): S;
  /** The empty fragment (`Prisma.empty`). */
  readonly empty: S;
}

/** The largest `limit` `sharedResourceIds` accepts. */
const SHARED_IDS_MAX = 10_000;

/** A Prisma field name or an SQL identifier we interpolate: plain identifiers only. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The Prisma fields `accessibleWhere` filters on.
 *
 * @stability stable
 */
export interface AccessibleFieldOptions {
  /** The owner user field. Default `'ownerUserId'`. */
  ownerUserField?: string;
  /** The owner group field. Default `'ownerGroupId'`. */
  ownerGroupField?: string;
  /** The record id field. Default `'id'`. */
  idField?: string;
  /** The organization field, or `null` to leave the organization to RLS. Default `'orgId'`. */
  orgField?: string | null;
  /** Which records. Default `'all'`. */
  scope?: AccessScope;
  /** The least role the caller must hold (`'owner'` allowed). Default: any role. */
  minRole?: string;
}

/**
 * The options of {@link accessibleWhere}.
 *
 * @stability stable
 */
export interface AccessibleWhereOptions<S = unknown> extends AccessibleFieldOptions {
  /** The app's transaction client, scoped to the caller's active organization. */
  tx: unknown;
  /** The app's `Prisma` namespace, for the EXISTS form above the threshold. */
  sqlKit: SqlKit<S>;
  /**
   * The SQL shape of the table, for the EXISTS form above the threshold:
   * its alias and columns. Default: alias `r`, columns `owner_user_id`,
   * `owner_group_id`, `id`, `org_id`.
   */
  sql?: {
    /** The table's alias in the caller's query. Default `r`. */
    alias?: string;
  } & AccessibleColumnOptions;
  /** The threshold. Default {@link SHARED_IDS_INLINE_LIMIT}; lower it in tests only. */
  inlineLimit?: number;
}

/**
 * The SQL columns `accessibleSql` filters on.
 *
 * @stability stable
 */
export interface AccessibleColumnOptions {
  /** The owner user column. Default `'owner_user_id'`. */
  ownerUserColumn?: string;
  /** The owner group column. Default `'owner_group_id'`. */
  ownerGroupColumn?: string;
  /** The record id column (uuid). Default `'id'`. */
  idColumn?: string;
  /** The organization column (uuid), or `null` to leave the organization to RLS. Default `'org_id'`. */
  orgColumn?: string | null;
}

/**
 * The options of {@link accessibleSql}.
 *
 * @stability stable
 */
export interface AccessibleSqlOptions<S = unknown> extends AccessibleColumnOptions {
  /** The app's `Prisma` namespace (`sql`, `join`, `raw`, `empty`). */
  sqlKit: SqlKit<S>;
  /** Which records. Default `'all'`. */
  scope?: AccessScope;
  /** The least role the caller must hold. Default: any role. */
  minRole?: string;
}

/**
 * What {@link accessibleWhere} returns: a Prisma `where` fragment, or, when
 * more than {@link SHARED_IDS_INLINE_LIMIT} records are shared with the
 * caller, the EXISTS form to run with `$queryRaw` (the same rows).
 *
 * @stability stable
 */
export type AccessibleWhere<S = unknown> =
  | {
      /** A Prisma `where` fragment. */
      readonly form: 'where';
      /** Pass it to `findMany`/`count` (AND it with your own filters). */
      readonly where: Record<string, unknown>;
    }
  | {
      /** The EXISTS form: too many shared records to inline. */
      readonly form: 'exists';
      /** An SQL condition on `alias` for `$queryRaw` (`accessibleSql`): the app's `Prisma.Sql`. */
      readonly sql: S;
    };

interface Prepared {
  rt: ResolvedResourceType;
  orgId: string | null;
  scope: AccessScope;
  /** Grant roles at or above minRole. */
  grantRoles: readonly string[];
  /** The caller's groups whose mapped role reaches minRole. */
  ownerGroupIds: string[];
  /** Every group of the caller in the active organization (grants to them count). */
  granteeGroupIds: string[];
  /** Whether the org default reaches minRole. */
  orgDefault: boolean;
}

function prepare(principal: Principal, type: string, scope: AccessScope | undefined, minRole: string | undefined): Prepared {
  const rt = requireResourceType(type);
  if (minRole !== undefined && rt.rank(minRole) === 0) {
    throw new Error(`Resource type "${type}" has no role "${minRole}" (roles: ${rt.roles.join(', ')}, or 'owner').`);
  }
  const min = minRole === undefined ? 1 : rt.rank(minRole);
  const groups = activeGroupsOf(principal);
  return {
    rt,
    orgId: principal.activeOrgId ?? null,
    scope: scope ?? 'all',
    grantRoles: rt.roles.filter((role) => rt.rank(role) >= min),
    ownerGroupIds: [...new Set(groups.filter((group) => rt.rank(rt.groupRole(group.role)) >= min).map((group) => group.groupId))],
    granteeGroupIds: [...new Set(groups.map((group) => group.groupId))],
    orgDefault: rt.defaultVisibility === 'org' && rt.rank(rt.orgRole) >= min,
  };
}

/** The kit's functions, bound (a namespace object's methods may rely on `this`), checked once. */
function kitOf<S>(kit: SqlKit<S> | undefined): { sql: (strings: TemplateStringsArray, ...values: unknown[]) => S; join: (values: readonly unknown[], separator?: string) => S; raw: (text: string) => S; empty: S } {
  if (!kit || typeof kit.sql !== 'function' || typeof kit.join !== 'function' || typeof kit.raw !== 'function') {
    throw new Error('accessibleSql needs `sqlKit`: pass the app\'s Prisma namespace (`sqlKit: Prisma`).');
  }
  return {
    sql: (strings, ...values) => kit.sql(strings, ...values),
    join: (values, separator) => (separator === undefined ? kit.join(values) : kit.join(values, separator)),
    raw: (text) => kit.raw(text),
    empty: kit.empty,
  };
}

function includes(scope: AccessScope, part: 'owned' | 'groups' | 'shared'): boolean {
  return scope === 'all' || scope === part;
}

function identifier(value: string, what: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`${what} must be a plain identifier, not ${JSON.stringify(value)}`);
  return value;
}

/** The Prisma `where` of the grants shared with the caller. */
function sharedGrantWhere(p: Prepared, principal: Principal, now: Date): Record<string, unknown> {
  return {
    orgId: p.orgId,
    resourceType: p.rt.type,
    revokedAt: null,
    role: { in: [...p.grantRoles] },
    AND: [
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      {
        OR: [
          { granteeKind: 'user', granteeUserId: principal.userId },
          ...(p.granteeGroupIds.length > 0 ? [{ granteeKind: 'group', granteeGroupId: { in: p.granteeGroupIds } }] : []),
        ],
      },
    ],
  };
}

/**
 * A Prisma `where` fragment selecting the records of `type` the caller may
 * see in `opts.scope`: ONE bounded grant query (at most
 * {@link SHARED_IDS_INLINE_LIMIT} + 1 ids) inside `opts.tx`, none at all when
 * the scope needs no grant. Above the threshold it switches to the EXISTS
 * form ({@link accessibleSql}) and returns `{ form: 'exists', sql }`.
 *
 * @param principal - the caller, enriched with its groups (`PrincipalGroupsProvider.enrich`).
 * @param type - a registered resource type.
 * @param opts - the transaction, the model's fields, the scope and the least role.
 * @returns `{ form: 'where', where }`, or `{ form: 'exists', sql }` above the threshold.
 * @throws Error for an unknown type or role.
 *
 * @example
 * ```ts
 * const me = await principalGroups.enrich(principal);
 * await prisma.runInOrg(me.activeOrgId!, async (tx) => {
 *   const access = await accessibleWhere(me, 'transcript', { tx, sqlKit: Prisma, scope: 'shared' });
 *   if (access.form === 'where') return tx.transcript.findMany({ where: { AND: [access.where, filters] } });
 *   const ids = await tx.$queryRaw<{ id: string }[]>`
 *     SELECT r.id FROM transcripts r WHERE ${access.sql} ORDER BY r.created_at DESC LIMIT 50`;
 *   return tx.transcript.findMany({ where: { id: { in: ids.map((row) => row.id) } } });
 * });
 * ```
 *
 * @extensionPoint hook
 * @stability stable
 */
export async function accessibleWhere<S>(principal: Principal, type: string, opts: AccessibleWhereOptions<S>): Promise<AccessibleWhere<S>> {
  const p = prepare(principal, type, opts.scope, opts.minRole);
  const idField = identifier(opts.idField ?? 'id', 'idField');
  const ownerUserField = identifier(opts.ownerUserField ?? 'ownerUserId', 'ownerUserField');
  const ownerGroupField = identifier(opts.ownerGroupField ?? 'ownerGroupId', 'ownerGroupField');
  const orgField = opts.orgField === null ? null : identifier(opts.orgField ?? 'orgId', 'orgField');
  const limit = opts.inlineLimit ?? SHARED_IDS_INLINE_LIMIT;
  const nothing = { [idField]: { in: [] as string[] } };
  if (p.orgId === null) return { form: 'where', where: nothing };

  const any: Record<string, unknown>[] = [];
  let everyOrgRecord = false;
  if (includes(p.scope, 'owned') && p.rt.def.ownership !== 'group') any.push({ [ownerUserField]: principal.userId });
  if (includes(p.scope, 'groups') && p.rt.def.ownership !== 'user' && p.ownerGroupIds.length > 0) {
    any.push({ [ownerGroupField]: { in: p.ownerGroupIds } });
  }
  if (includes(p.scope, 'shared')) {
    if (p.orgDefault) everyOrgRecord = true;
    else if (p.grantRoles.length > 0) {
      const rows = await asSharingTx(opts.tx).grant.groupBy<{ resourceId: string }>({
        by: ['resourceId'],
        where: sharedGrantWhere(p, principal, new Date()),
        orderBy: { resourceId: 'asc' },
        take: limit + 1,
      });
      if (rows.length > limit) {
        const sql = accessibleSql(principal, type, opts.sql?.alias ?? 'r', {
          ...opts.sql,
          sqlKit: opts.sqlKit,
          scope: p.scope,
          ...(opts.minRole ? { minRole: opts.minRole } : {}),
        });
        return { form: 'exists', sql };
      }
      if (rows.length > 0) any.push({ [idField]: { in: rows.map((row) => row.resourceId) } });
    }
  }

  const org = orgField === null ? null : { [orgField]: p.orgId };
  if (everyOrgRecord) return { form: 'where', where: org ?? {} };
  if (any.length === 0) return { form: 'where', where: nothing };
  const visible = any.length === 1 ? any[0]! : { OR: any };
  return { form: 'where', where: org ? { AND: [org, visible] } : visible };
}

/**
 * An SQL condition on the table aliased `alias` selecting the records of
 * `type` the caller may see in `opts.scope`, with the grant check as an
 * `EXISTS (SELECT 1 FROM grants ...)` correlated on the record id. Pure: no
 * query. Every value is a bind parameter; the alias and the columns must be
 * plain identifiers. The only sanctioned raw-SQL access path to `grants`.
 *
 * @param principal - the caller, enriched with its groups.
 * @param type - a registered resource type.
 * @param alias - the table's alias in the caller's query (`r` in `FROM transcripts r`).
 * @param opts - the columns, the scope and the least role.
 * @returns the app's `Prisma.Sql` condition, for `$queryRaw`.
 * @throws Error for an unknown type or role, or a non-identifier alias or column.
 *
 * @example
 * ```ts
 * const rows = await tx.$queryRaw<{ id: string }[]>`
 *   SELECT r.id FROM transcripts r
 *   WHERE ${accessibleSql(me, 'transcript', 'r', { sqlKit: Prisma, scope: 'all' })}
 *   ORDER BY r.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`;
 * ```
 *
 * @extensionPoint hook
 * @stability stable
 */
export function accessibleSql<S>(principal: Principal, type: string, alias: string, opts: AccessibleSqlOptions<S>): S {
  const p = prepare(principal, type, opts.scope, opts.minRole);
  const { sql, join, raw, empty } = kitOf(opts.sqlKit);
  const col = (name: string | undefined, fallback: string, what: string): S =>
    raw(`"${identifier(alias, 'alias')}"."${identifier(name ?? fallback, what)}"`);
  if (p.orgId === null) return sql`FALSE`;

  const any: S[] = [];
  if (includes(p.scope, 'owned') && p.rt.def.ownership !== 'group') {
    any.push(sql`${col(opts.ownerUserColumn, 'owner_user_id', 'ownerUserColumn')} = ${principal.userId}::uuid`);
  }
  if (includes(p.scope, 'groups') && p.rt.def.ownership !== 'user' && p.ownerGroupIds.length > 0) {
    any.push(sql`${col(opts.ownerGroupColumn, 'owner_group_id', 'ownerGroupColumn')} IN (${join(p.ownerGroupIds.map((id) => sql`${id}::uuid`))})`);
  }
  if (includes(p.scope, 'shared')) {
    if (p.orgDefault) any.push(sql`TRUE`);
    else if (p.grantRoles.length > 0) {
      const groupGrantee =
        p.granteeGroupIds.length > 0
          ? sql` OR (g.grantee_kind = 'group' AND g.grantee_group_id IN (${join(p.granteeGroupIds.map((id) => sql`${id}::uuid`))}))`
          : empty;
      any.push(sql`EXISTS (
        SELECT 1 FROM grants g
        WHERE g.org_id = ${p.orgId}::uuid
          AND g.resource_type = ${p.rt.type}
          AND g.resource_id = ${col(opts.idColumn, 'id', 'idColumn')}
          AND g.revoked_at IS NULL
          AND (g.expires_at IS NULL OR g.expires_at > now())
          AND g.role IN (${join([...p.grantRoles])})
          AND ((g.grantee_kind = 'user' AND g.grantee_user_id = ${principal.userId}::uuid)${groupGrantee})
      )`);
    }
  }
  const visible = any.length === 0 ? sql`FALSE` : sql`(${join(any, ' OR ')})`;
  if (opts.orgColumn === null) return visible;
  return sql`(${col(opts.orgColumn, 'org_id', 'orgColumn')} = ${p.orgId}::uuid AND ${visible})`;
}

/**
 * The ids of the records of `type` shared with the caller through an active,
 * unexpired user or group grant (not ownership, not the org default),
 * bounded: at most `opts.limit` (default {@link SHARED_IDS_INLINE_LIMIT},
 * at most 10,000), by id.
 *
 * @param principal - the caller, enriched with its groups.
 * @param type - a registered resource type.
 * @param opts - the transaction, the least role and the limit.
 * @returns the record ids.
 * @throws Error for an unknown type or role.
 *
 * @example
 * ```ts
 * const ids = await sharedResourceIds(me, 'transcript', { tx, minRole: 'editor', limit: 200 });
 * ```
 *
 * @extensionPoint hook
 * @stability stable
 */
export async function sharedResourceIds(principal: Principal, type: string, opts: { tx: unknown; minRole?: string; limit?: number }): Promise<string[]> {
  const p = prepare(principal, type, 'shared', opts.minRole);
  if (p.orgId === null || p.grantRoles.length === 0) return [];
  const limit = Math.min(Math.max(1, Math.trunc(opts.limit ?? SHARED_IDS_INLINE_LIMIT)), SHARED_IDS_MAX);
  const rows = await asSharingTx(opts.tx).grant.groupBy<{ resourceId: string }>({
    by: ['resourceId'],
    where: sharedGrantWhere(p, principal, new Date()),
    orderBy: { resourceId: 'asc' },
    take: limit,
  });
  return rows.map((row) => row.resourceId);
}
