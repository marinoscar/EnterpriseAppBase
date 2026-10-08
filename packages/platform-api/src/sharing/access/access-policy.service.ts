// =============================================================================
// AccessPolicy: can(principal, action, resource) (issue #729, PP-7.2)
// =============================================================================
//
// THE ONE DECISION POINT for the app-policy layer above row-level security
// (spec, "Tenancy and access model", Enforcement: "App policy"): owner, group
// owner, grant and organization-default rules inside ONE organization. RLS
// confines every query to the caller's active organization; this decides
// which of that organization's records the caller may act on.
//
// THE DECISION ORDER (tested as a matrix in access-policy.service.spec.ts):
//
//   1. Unknown resource type or action: a PROGRAMMING error (500), not a 404.
//   2. The record is missing, or in another organization: deny. RLS already
//      hides other organizations; the check is defence in depth.
//   3. A required `actionPermissions[action]` the caller lacks: deny, EVEN FOR
//      THE OWNER. An RBAC failure, so `require()` answers 403 naming the
//      permission (kvox's `assertWritePermission`), whatever `denyAs` says.
//   4. A held `bypassPermissions[action]` (or `sharing:admin` for `share`):
//      allow, `via: 'bypass'`.
//   5. Owner: role `owner`.
//   6. Member of the owning group: the role `groupRoleMap` gives their group role.
//   7. The strongest ACTIVE, UNEXPIRED grant: to the caller, or to a group of
//      `Scope.groupIds` (the caller's groups in the active organization).
//   8. `defaultVisibility: 'org'`: `orgRole`.
//   9. Otherwise deny.
//
// The effective role is the MAXIMUM over steps 5 to 8 (ties: the earlier
// step names `via`), compared with `actions[action]`.
//
// BATCHED: `decideMany` reads the owners of a whole batch with ONE
// `loadOwners` call per resource type and every relevant grant with ONE
// query, in one transaction scoped to the caller's active organization.
//
// MEMOISED PER REQUEST, NEVER ACROSS REQUESTS: decisions are cached on the
// principal object of one request (the authentication guard builds a new one
// for every request), so a revoked grant stops working on the very next
// request with no cache to invalidate.
// =============================================================================

import { Inject, Injectable, Optional } from '@nestjs/common';
import { trace } from '@opentelemetry/api';

import type { GroupMembership, Principal } from '../../core/index';
import { MetricsHostService, Trace } from '../../otel-core/index';
import { asSharingTx, type GrantRow } from '../data/sharing-tx';
import { missingPermission, resourceForbidden, resourceNotFound } from '../errors';
import { SHARING_ACCESS_DECISIONS_METRIC } from '../metrics';
import { SHARING_PERMISSIONS } from '../permissions';
import { SHARING_DATA, type SharingDataPort } from '../ports';
import { PrincipalGroupsProvider } from '../principal-groups.provider';
import { requireResourceType, type ResolvedResourceType, type ResourceOwnerInfo } from './resource-types';

/**
 * One record of a registered resource type.
 *
 * @stability stable
 */
export interface ResourceRef {
  /** The registered resource type. */
  type: string;
  /** The record's id. */
  id: string;
}

/**
 * An effective role: `'owner'` or one of the type's roles.
 *
 * @stability stable
 */
export type EffectiveRole = 'owner' | (string & {});

/**
 * What decided an allowed access (`null` for a denial).
 *
 * @stability stable
 */
export type AccessVia = 'owner' | 'group_owner' | 'user_grant' | 'group_grant' | 'org_default' | 'bypass';

/**
 * One access decision.
 *
 * @stability stable
 */
export interface AccessDecision {
  /** Whether the action is allowed. */
  allowed: boolean;
  /** The caller's effective role on the record (`null`: none). */
  role: EffectiveRole | null;
  /** What allowed it, or `null` for a denial. */
  via: AccessVia | null;
  /** Set when the denial is a missing RBAC permission (step 3): that permission. */
  missingPermission?: string;
}

/**
 * Optional injection token of the policy's clock (ms since epoch); tests
 * inject one to move expiries.
 *
 * @stability experimental
 */
export const ACCESS_POLICY_CLOCK: unique symbol = Symbol.for('@marinoscar/platform/sharing/ACCESS_POLICY_CLOCK');

/** The memo key of one decision. */
function memoKey(action: string | null, ref: ResourceRef): string {
  return `${action ?? '\u0000role'}\u0000${ref.type}\u0000${ref.id}`;
}

/**
 * The map key `decideMany` returns a decision under: `${type}:${id}`.
 *
 * @param ref - the record.
 * @returns the key.
 *
 * @stability stable
 */
export function resourceKey(ref: ResourceRef): string {
  return `${ref.type}:${ref.id}`;
}

const DENIED: AccessDecision = Object.freeze({ allowed: false, role: null, via: null });

/** What one grant contributes. */
type GrantContribution = Pick<GrantRow, 'resourceType' | 'resourceId' | 'granteeKind' | 'granteeUserId' | 'granteeGroupId' | 'role'>;

/**
 * Decides what a principal may do with a record of a registered resource
 * type. Inject it; never cache a decision beyond the request.
 *
 * @stability stable
 */
@Injectable()
export class AccessPolicy {
  /** Per-request memo: the principal object of one request, mapped to its decisions. */
  private readonly memo = new WeakMap<object, Map<string, Promise<AccessDecision>>>();

  constructor(
    @Inject(SHARING_DATA) private readonly data: SharingDataPort,
    private readonly principalGroups: PrincipalGroupsProvider,
    @Optional() private readonly metrics?: MetricsHostService,
    @Optional() @Inject(ACCESS_POLICY_CLOCK) private readonly now: () => number = Date.now,
  ) {}

  /**
   * Whether `principal` may perform `action` on `ref`.
   *
   * @param principal - the caller.
   * @param action - one of the type's actions (`read`, `write`, `share`, ...).
   * @param ref - the record.
   * @returns `true` when allowed.
   * @throws Error for an unknown resource type or action (a programming error).
   */
  async can(principal: Principal, action: string, ref: ResourceRef): Promise<boolean> {
    return (await this.decide(principal, action, ref)).allowed;
  }

  /**
   * The full decision for one record.
   *
   * @param principal - the caller.
   * @param action - one of the type's actions.
   * @param ref - the record.
   * @returns allowed, the effective role and what decided it.
   * @throws Error for an unknown resource type or action.
   */
  async decide(principal: Principal, action: string, ref: ResourceRef): Promise<AccessDecision> {
    return (await this.decideMany(principal, action, [ref])).get(resourceKey(ref))!;
  }

  /**
   * The decision, or the HTTP refusal: `404` with the same body as a missing
   * record for a `denyAs: 'not_found'` type (the default), `403` for a
   * `'forbidden'` type, and `403` naming the permission when a required
   * `actionPermissions` entry is missing (step 3). Never leaks which.
   *
   * @param principal - the caller.
   * @param action - one of the type's actions.
   * @param ref - the record.
   * @returns the (allowed) decision.
   * @throws NotFoundException or ForbiddenException on a denial.
   */
  async require(principal: Principal, action: string, ref: ResourceRef): Promise<AccessDecision> {
    const decision = await this.decide(principal, action, ref);
    if (!decision.allowed) throw denial(requireResourceType(ref.type), decision);
    return decision;
  }

  /**
   * The caller's effective role on `ref` (steps 2 and 5 to 8; permissions
   * and bypasses are about actions, so they do not apply), or `null`.
   *
   * @param principal - the caller.
   * @param ref - the record.
   * @returns `'owner'`, one of the type's roles, or `null`.
   */
  async roleFor(principal: Principal, ref: ResourceRef): Promise<EffectiveRole | null> {
    const decisions = await this.evaluateMemoised(principal, null, [ref]);
    return decisions.get(resourceKey(ref))!.role;
  }

  /**
   * The decisions for a batch: ONE owner query per resource type and ONE
   * grant query for the whole batch, in one org-scoped transaction.
   *
   * @param principal - the caller.
   * @param action - one action, applied to every record.
   * @param refs - the records (any mix of registered types).
   * @returns a decision per record, keyed by {@link resourceKey} (`type:id`).
   * @throws Error for an unknown resource type or action.
   */
  @Trace('sharing.access.decide_many')
  async decideMany(principal: Principal, action: string, refs: readonly ResourceRef[]): Promise<Map<string, AccessDecision>> {
    const span = trace.getActiveSpan();
    span?.setAttribute('sharing.batch_size', refs.length);
    if (principal.activeOrgId) span?.setAttribute('org.id', principal.activeOrgId);
    return this.evaluateMemoised(principal, action, refs);
  }

  /**
   * {@link decideMany} inside a transaction the caller already holds (scoped
   * to the principal's active organization), so a service that checks and
   * then writes does both in one transaction. Not memoised.
   *
   * @param tx - the org-scoped transaction client.
   * @param principal - the caller.
   * @param action - one action.
   * @param refs - the records.
   * @returns a decision per record, keyed by {@link resourceKey}.
   */
  async decideManyIn(tx: unknown, principal: Principal, action: string, refs: readonly ResourceRef[]): Promise<Map<string, AccessDecision>> {
    const groups = await this.groupsOf(principal);
    return this.evaluate(tx, principal, groups, action, refs);
  }

  /**
   * {@link require} inside a transaction the caller already holds. Not memoised.
   *
   * @param tx - the org-scoped transaction client.
   * @param principal - the caller.
   * @param action - one action.
   * @param ref - the record.
   * @returns the (allowed) decision.
   * @throws NotFoundException or ForbiddenException on a denial.
   */
  async requireIn(tx: unknown, principal: Principal, action: string, ref: ResourceRef): Promise<AccessDecision> {
    const decision = (await this.decideManyIn(tx, principal, action, [ref])).get(resourceKey(ref))!;
    if (!decision.allowed) throw denial(requireResourceType(ref.type), decision);
    return decision;
  }

  // ---- internals ----------------------------------------------------------------

  /** The caller's groups in its active organization: the enriched list, else the provider's. */
  private async groupsOf(principal: Principal): Promise<readonly GroupMembership[]> {
    const org = principal.activeOrgId;
    if (!org) return [];
    const groups = principal.groups ?? (await this.principalGroups.groupsFor(principal));
    return groups.filter((group) => group.orgId === org);
  }

  private async evaluateMemoised(principal: Principal, action: string | null, refs: readonly ResourceRef[]): Promise<Map<string, AccessDecision>> {
    validate(action, refs);
    let memo = this.memo.get(principal);
    if (!memo) {
      memo = new Map();
      this.memo.set(principal, memo);
    }
    const misses: ResourceRef[] = [];
    const seen = new Set<string>();
    for (const ref of refs) {
      const key = memoKey(action, ref);
      if (memo.has(key) || seen.has(key)) continue;
      seen.add(key);
      misses.push(ref);
    }
    if (misses.length > 0) {
      const batch = (async () => {
        const groups = await this.groupsOf(principal);
        const orgId = principal.activeOrgId;
        if (!orgId) return new Map(misses.map((ref) => [resourceKey(ref), DENIED]));
        return this.data.runInOrg({ orgId, userId: principal.userId }, (tx) => this.evaluate(tx, principal, groups, action, misses));
      })();
      for (const ref of misses) {
        const one = batch.then((decisions) => decisions.get(resourceKey(ref))!);
        one.catch(() => undefined); // awaited below; never an unhandled rejection
        memo.set(memoKey(action, ref), one);
      }
      // A failed batch is not remembered: the next call retries it.
      batch.catch(() => {
        for (const ref of misses) memo!.delete(memoKey(action, ref));
      });
    }
    const out = new Map<string, AccessDecision>();
    for (const ref of refs) out.set(resourceKey(ref), await memo.get(memoKey(action, ref))!);
    return out;
  }

  /** Steps 2 to 9 for a batch, inside `rawTx`. */
  private async evaluate(
    rawTx: unknown,
    principal: Principal,
    groups: readonly GroupMembership[],
    action: string | null,
    refs: readonly ResourceRef[],
  ): Promise<Map<string, AccessDecision>> {
    validate(action, refs);
    const out = new Map<string, AccessDecision>();
    const orgId = principal.activeOrgId;
    if (!orgId) {
      for (const ref of refs) out.set(resourceKey(ref), DENIED);
      return out;
    }
    const tx = asSharingTx(rawTx);

    // Owners: one loadOwners call per type.
    const byType = new Map<string, string[]>();
    for (const ref of refs) {
      const ids = byType.get(ref.type) ?? [];
      if (!ids.includes(ref.id)) ids.push(ref.id);
      byType.set(ref.type, ids);
    }
    const owners = new Map<string, ResourceOwnerInfo>();
    for (const [type, ids] of byType) {
      const rt = requireResourceType(type);
      const found = await rt.def.loadOwners(ids, rawTx);
      for (const [id, info] of found) owners.set(`${type}:${id}`, info);
    }

    // Grants: one query for every record that exists in this organization.
    const groupRole = new Map(groups.map((group) => [group.groupId, group.role]));
    const groupIds = [...groupRole.keys()];
    const present = [...byType].map(([type, ids]) => [type, ids.filter((id) => owners.get(`${type}:${id}`)?.orgId === orgId)] as const);
    const wanted = present.filter(([, ids]) => ids.length > 0);
    const grants = new Map<string, GrantContribution[]>();
    if (wanted.length > 0) {
      const rows = await tx.grant.findMany<GrantContribution>({
        where: {
          orgId,
          revokedAt: null,
          AND: [
            { OR: wanted.map(([type, ids]) => ({ resourceType: type, resourceId: { in: ids } })) },
            { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(this.now()) } }] },
            {
              OR: [
                { granteeKind: 'user', granteeUserId: principal.userId },
                ...(groupIds.length > 0 ? [{ granteeKind: 'group', granteeGroupId: { in: groupIds } }] : []),
              ],
            },
          ],
        },
        select: { resourceType: true, resourceId: true, granteeKind: true, granteeUserId: true, granteeGroupId: true, role: true },
      });
      for (const row of rows) {
        const key = `${row.resourceType}:${row.resourceId}`;
        grants.set(key, [...(grants.get(key) ?? []), row]);
      }
    }

    for (const ref of refs) {
      const key = resourceKey(ref);
      const rt = requireResourceType(ref.type);
      const decision = decideOne(rt, principal, orgId, groupRole, action, owners.get(key), grants.get(key) ?? []);
      out.set(key, decision);
      if (action !== null) this.count(rt.type, decision);
    }
    return out;
  }

  private count(type: string, decision: AccessDecision): void {
    try {
      this.metrics?.add(SHARING_ACCESS_DECISIONS_METRIC, 1, {
        resource_type: type,
        outcome: decision.allowed ? 'allowed' : 'denied',
        via: decision.via ?? 'none',
      });
    } catch {
      // Metrics never fail a decision.
    }
  }
}

/** Step 1, before any query: every type registered, the action declared by each. */
function validate(action: string | null, refs: readonly ResourceRef[]): void {
  for (const ref of refs) {
    const rt = requireResourceType(ref.type);
    if (action !== null && rt.required(action) === undefined) {
      throw new Error(`Resource type "${rt.type}" declares no action "${action}" (declared: ${Object.keys(rt.def.actions).join(', ')}).`);
    }
  }
}

/** Steps 2 to 9 for one record. */
function decideOne(
  rt: ResolvedResourceType,
  principal: Principal,
  orgId: string,
  groupRole: ReadonlyMap<string, string>,
  action: string | null,
  info: ResourceOwnerInfo | undefined,
  grants: readonly GrantContribution[],
): AccessDecision {
  // 2. Missing, or in another organization.
  if (!info || info.orgId !== orgId) return DENIED;

  // 5 to 8: every source of a role, strongest wins (ties: the earlier source).
  let best: { role: string; rank: number; via: AccessVia } | null = null;
  const offer = (role: string | null, via: AccessVia): void => {
    const rank = rt.rank(role);
    if (role !== null && rank > 0 && (best === null || rank > best.rank)) best = { role, rank, via };
  };
  if (info.owner.kind === 'user' && info.owner.userId === principal.userId) offer('owner', 'owner');
  if (info.owner.kind === 'group' && groupRole.has(info.owner.groupId)) offer(rt.groupRole(groupRole.get(info.owner.groupId)!), 'group_owner');
  for (const grant of grants.filter((g) => g.granteeKind === 'user' && g.granteeUserId === principal.userId)) offer(grant.role, 'user_grant');
  for (const grant of grants.filter((g) => g.granteeKind === 'group' && g.granteeGroupId !== null && groupRole.has(g.granteeGroupId))) {
    offer(grant.role, 'group_grant');
  }
  if (rt.defaultVisibility === 'org') offer(rt.orgRole, 'org_default');
  const effective = best as { role: string; rank: number; via: AccessVia } | null;

  if (action === null) {
    return effective ? { allowed: true, role: effective.role, via: effective.via } : DENIED;
  }

  // 3. A required RBAC permission the caller lacks: deny, even for the owner.
  const needed = rt.def.actionPermissions?.[action];
  if (needed !== undefined && !principal.permissions.includes(needed)) {
    return { allowed: false, role: effective?.role ?? null, via: null, missingPermission: needed };
  }

  // 4. A bypass permission (and sharing:admin for `share`, on every type).
  const required = rt.required(action)!;
  const bypass = rt.def.bypassPermissions?.[action];
  if ((bypass !== undefined && principal.permissions.includes(bypass)) || (action === 'share' && principal.permissions.includes(SHARING_PERMISSIONS.SHARING_ADMIN))) {
    return { allowed: true, role: effective && effective.rank >= rt.rank(required) ? effective.role : required, via: 'bypass' };
  }

  // 5 to 9: the effective role against the action's minimum.
  if (effective && effective.rank >= rt.rank(required)) return { allowed: true, role: effective.role, via: effective.via };
  return { allowed: false, role: effective?.role ?? null, via: null };
}

/** The HTTP refusal of a denial. */
function denial(rt: ResolvedResourceType, decision: AccessDecision): Error {
  if (decision.missingPermission) return missingPermission(decision.missingPermission);
  return rt.denyAs === 'forbidden' ? resourceForbidden() : resourceNotFound();
}

/**
 * The HTTP refusal `AccessPolicy.require` throws for a denial (exported for
 * services that decide in bulk and refuse one record).
 *
 * @param type - the record's resource type.
 * @param decision - the denial.
 * @returns the exception to throw.
 *
 * @stability experimental
 */
export function accessDenial(type: string, decision: AccessDecision): Error {
  return denial(requireResourceType(type), decision);
}
