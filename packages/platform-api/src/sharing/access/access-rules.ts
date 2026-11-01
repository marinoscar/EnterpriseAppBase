// =============================================================================
// The access-rule registry (PP-14.16): rung 2 of the extension contract
// =============================================================================
//
// An ACCESS RULE is an app's own opinion about who may touch a record, added
// to `AccessPolicy` without replacing it: "members of the record's project may
// read it", "nobody may edit a record in a closed period". It joins the
// decision at a documented place and may only ever ADD an allow or a deny:
//
//   THE DECISION ORDER (the order of the offers; the strongest role wins, a tie
//   goes to the earlier source)
//
//     1. unknown resource type or action ........... programming error (500)
//     2. record missing / in another organization ... deny
//     3. a required `actionPermissions` entry missing  deny (even for the owner)
//     4. a held bypass permission .................... allow  (`bypass`) } rules are not
//     5. the record's USER OWNER ..................... allow  (`owner`)  } consulted (both: `bypass`)
//     --- from here the caller is subject to the rules ---
//     6. rules `before-grants`: ANY deny ends it (deny); an allow offers its role
//     7. group owner, then the strongest ACTIVE, UNEXPIRED grant (user, group, ...)
//     8. rules `after-grants`: ANY deny ends it (deny); an allow offers its role
//     9. the type's `defaultVisibility: 'org'` role
//    10. otherwise deny
//
//   A `deny` from any rule wins over every allow of steps 6 to 9. The user
//   owner and a bypass holder are decided BEFORE the rules, so a faulty rule
//   cannot lock an owner or an administrator out of their own record. A
//   group owner is an ordinary source (step 7) and IS subject to a deny.
//
// FAIL CLOSED. A rule that throws, rejects, returns anything but `'allow'`,
// `'deny'` or `'abstain'`, names a role the resource type does not have, or
// returns `'deny'` without declaring `mayDeny` (its list SQL would not hide the
// record), counts as a `deny` flagged `ruleFailure`, and the failure is logged
// with the rule's id and the error's class only (no message, no principal, no
// record id). A statement that fails inside a rule aborts the shared
// transaction, so `AccessPolicy` takes a SAVEPOINT per call and rolls back to
// it after a failing rule.
//
// ALLOW CONFERS A ROLE. `role` is the role an allow gives (default: the type's
// weakest role, so a rule that only opens a record to read cannot, by default,
// open it to write). The action is allowed when that role reaches the action's
// minimum, as for a grant. `AccessDecision.via` is the rule's id.
//
// THE LIST MUST AGREE. `AccessPolicy` answers "may I open THIS record"; the
// "resources I can see" helpers answer "WHICH records". A rule therefore
// provides `sql` (an `allow` and/or a `deny` condition over the record's
// table) and a rule that can deny (`mayDeny`) must. `describeAccessRuleConformance`
// compares the two over a fixture matrix and across organizations.
// =============================================================================

import { Logger } from '@nestjs/common';
import { GRANTEE_KIND_ID_PATTERN } from '@marinoscar/platform-contract/sharing';

import { defineRegistry, type Principal } from '../../core/index';
import type { ResourceOwner } from '../ownership';
import type { SqlKit } from './accessible';
import type { ResolvedResourceType } from './resource-types';

/**
 * What a rule decides about one record.
 *
 * @stability experimental
 */
export type AccessRuleVerdict = 'allow' | 'deny' | 'abstain';

/**
 * Where a rule's allow sits among the sources of a role: before the grants
 * (step 6 of the decision order) or after them (step 8). A deny ends the
 * decision wherever it sits.
 *
 * @stability experimental
 */
export type AccessRulePosition = 'before-grants' | 'after-grants';

/**
 * What a rule sees of one record.
 *
 * @stability experimental
 */
export interface AccessRuleContext {
  /** The caller, enriched with its groups. */
  readonly principal: Principal;
  /** The action asked, or `null` when the role (not an action) is being computed. */
  readonly action: string | null;
  /** The record. `orgId` is the caller's active organization (a record elsewhere is decided before the rules). */
  readonly resource: {
    /** The resource type. */
    readonly type: string;
    /** The record id. */
    readonly id: string;
    /** The record's organization. */
    readonly orgId: string;
    /** Who owns it. */
    readonly owner: ResourceOwner;
  };
  /**
   * The transaction the decision runs in, scoped to the caller's
   * organization (row-level security confines every query on an `org`
   * table). Read only: a rule decides, it never writes. Cast it to the app's Prisma transaction client.
   */
  readonly tx: unknown;
  /** Scratch shared by every record of one decision call: load a project's members once, not per record. */
  readonly cache: Map<string, unknown>;
}

/**
 * What a rule's `sql` receives: the record's table and the builders.
 *
 * @typeParam S - the app's `Prisma.Sql`.
 *
 * @stability experimental
 */
export interface AccessRuleSqlContext<S> {
  /** The caller, enriched with its groups. */
  readonly principal: Principal;
  /** The resource type being listed. */
  readonly resourceType: string;
  /** The caller's active organization: bind it in every sub-select of an organization table. */
  readonly orgId: string;
  /** The app's SQL builders. Every value is a bind parameter; never interpolate input. */
  readonly kit: SqlKit<S>;
  /** A column of the record's table, qualified by its alias (a checked identifier). */
  column(name: string): S;
  /** The record id column (uuid). */
  readonly idColumn: S;
}

/**
 * The two conditions a rule contributes to "resources I can see".
 *
 * @typeParam S - the app's `Prisma.Sql`.
 *
 * @stability experimental
 */
export interface AccessRuleSql<S> {
  /** Records the rule allows (confers `role` on). */
  readonly allow?: S;
  /** Records the rule denies (hidden from everyone but the record's user owner). */
  readonly deny?: S;
}

/**
 * One access rule.
 *
 * @example
 * ```ts
 * registerAccessRule({
 *   id: 'project-member',
 *   position: 'before-grants',
 *   resourceTypes: ['project_document'],
 *   async evaluate(ctx) { return (await isProjectMember(ctx)) ? 'allow' : 'abstain'; },
 *   sql: (ctx) => ({ allow: ctx.kit.sql`EXISTS (SELECT 1 FROM project_members pm WHERE ...)` }),
 * });
 * ```
 *
 * @stability experimental
 */
export interface AccessRuleDef {
  /** Stable id (`GRANTEE_KIND_ID_PATTERN`: lower-case letters, digits, hyphens); it is `AccessDecision.via` of an allow. */
  readonly id: string;
  /** Where its allow sits among the sources of a role. */
  readonly position: AccessRulePosition;
  /** The resource types it applies to. Default: every type. */
  readonly resourceTypes?: readonly string[];
  /** The role an allow confers: one of the type's roles, or `'owner'`. Default: the type's weakest role. */
  readonly role?: string;
  /**
   * Whether the rule can return `deny`. A rule that can deny must provide `sql` so lists hide what it denies;
   * a `deny` from a rule that did not declare it is a configuration error (still a deny, flagged `ruleFailure`).
   */
  readonly mayDeny?: boolean;
  /**
   * The verdict for one record. A rejection or an unknown value is a deny.
   *
   * @param ctx - the caller, the action, the record and the transaction.
   */
  evaluate(ctx: AccessRuleContext): Promise<AccessRuleVerdict>;
  /**
   * The same decision as SQL over the record's table, for "resources I can
   * see". Return `null` for "nothing to add for this caller". Parameterise
   * every value and bind `ctx.orgId` in every sub-select of an organization table.
   *
   * @param ctx - the caller, the table and the builders.
   */
  sql?<S>(ctx: AccessRuleSqlContext<S>): AccessRuleSql<S> | null;
}

/**
 * The ids no rule may take: `AccessVia` values of the platform's own sources
 * and the metric labels `none` (a denial) and `app` (a rule or kind). The other
 * platform vias and every grantee kind's `via` contain an underscore, which a
 * rule id (hyphenated) never does.
 */
const RESERVED_RULE_IDS: readonly string[] = ['owner', 'bypass', 'none', 'app'];

function check(condition: unknown, id: string, why: string): asserts condition {
  if (!condition) throw new Error(`access rule "${id}": ${why}`);
}

function validateRule(def: AccessRuleDef): void {
  const id = typeof def?.id === 'string' ? def.id : '?';
  check(!RESERVED_RULE_IDS.includes(id), id, `"${id}" is reserved for a platform source`);
  check(def.position === 'before-grants' || def.position === 'after-grants', id, "`position` must be 'before-grants' or 'after-grants'");
  check(typeof def.evaluate === 'function', id, '`evaluate` must be a function');
  check(def.sql === undefined || typeof def.sql === 'function', id, '`sql` must be a function');
  check(def.mayDeny === undefined || typeof def.mayDeny === 'boolean', id, '`mayDeny` must be a boolean');
  check(def.mayDeny !== true || typeof def.sql === 'function', id, '`mayDeny` needs `sql`: a list must hide what the rule denies');
  check(def.role === undefined || (typeof def.role === 'string' && def.role.length > 0), id, '`role` must be a role name');
  check(
    def.resourceTypes === undefined || (Array.isArray(def.resourceTypes) && def.resourceTypes.every((type) => typeof type === 'string' && type.length > 0)),
    id,
    '`resourceTypes` must be an array of resource type ids',
  );
}

/**
 * The access rules, in registration order. String ids, a duplicate-id error,
 * frozen after bootstrap (the core registry primitive).
 *
 * @stability experimental
 */
export const accessRuleRegistry = defineRegistry<AccessRuleDef>({
  name: 'sharing-access-rules',
  idOf: (def) => def.id,
  idPattern: GRANTEE_KIND_ID_PATTERN,
  validate: (def) => validateRule(def),
});

/**
 * Registers one access rule. Call it at import time, before the application
 * bootstraps (an app's `app-registrations` module).
 *
 * @param def - the rule (the object is shallow-frozen).
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY` (the message names the
 *   rule and the problem), `DUPLICATE_ID` or `FROZEN` (after bootstrap).
 *
 * @example
 * ```ts
 * registerAccessRule(createProjectMemberAccessRule({ resourceType: 'project_document', table: 'project_documents' }));
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerAccessRule(def: AccessRuleDef): void {
  // Shallow-frozen: a registered rule is the app's decision at start-up, not a live object
  // that code holding a reference can change later (this freezes the object you pass).
  accessRuleRegistry.register(Object.freeze(def));
}

/** The rules that apply to `type`, in registration order. */
export function accessRulesFor(type: string): AccessRuleDef[] {
  return accessRuleRegistry.list().filter((rule) => rule.resourceTypes === undefined || rule.resourceTypes.includes(type));
}

/**
 * The role an allow of `rule` confers on records of `rt`, or `null` when the
 * rule names a role the type does not have (a misconfiguration: fail closed).
 */
export function accessRuleRole(rt: ResolvedResourceType, rule: AccessRuleDef): string | null {
  const role = rule.role ?? rt.roles[0]!;
  return rt.rank(role) > 0 ? role : null;
}

/** One role a rule offers. */
export interface RuleOffer {
  readonly role: string;
  readonly via: string;
}

/** What the rules decided about one record. */
export interface RuleOutcome {
  /** Some rule denied (or failed): the record is denied. */
  readonly denied: boolean;
  /** The denial is a rule FAILURE or a misconfiguration (a throw, an unknown verdict, a deny the rule did not declare), not a decision. */
  readonly failed?: boolean;
  /** Allows of `before-grants` rules. */
  readonly before: readonly RuleOffer[];
  /** Allows of `after-grants` rules. */
  readonly after: readonly RuleOffer[];
}

export const NO_RULE_OUTCOME: RuleOutcome = Object.freeze({ denied: false, before: [], after: [] });
const log = new Logger('SharingAccessRules');

/** Logs a rule failure without leaking: the rule id and the error's class, never a message or a record. */
function logFailure(rule: AccessRuleDef, reason: string, error?: unknown): void {
  const name = error instanceof Error ? error.constructor.name : typeof error;
  try {
    log.warn(`access rule "${rule.id}" ${reason}${error === undefined ? '' : ` (${name})`}; treating it as a deny`);
  } catch {
    // Logging never changes a decision.
  }
}

/**
 * Evaluates every applicable rule for one record. Fail closed: a throw, a
 * rejection, an unknown verdict, a misconfigured role or a `deny` from a rule
 * that did not declare `mayDeny` (its list SQL would not hide the record) is a
 * deny, flagged `failed`. `context.recover` runs after a rule threw, so a
 * failed statement of the shared transaction does not poison the next rule.
 */
export async function evaluateAccessRules(
  rt: ResolvedResourceType,
  context: AccessRuleContext & { recover?: () => Promise<void> },
): Promise<RuleOutcome> {
  const rules = accessRulesFor(rt.type);
  if (rules.length === 0) return NO_RULE_OUTCOME;
  const { recover, ...ruleContext } = context;
  const failed: RuleOutcome = { denied: true, failed: true, before: [], after: [] };
  const before: RuleOffer[] = [];
  const after: RuleOffer[] = [];
  for (const rule of rules) {
    let verdict: unknown;
    try {
      verdict = await rule.evaluate(ruleContext);
    } catch (error) {
      logFailure(rule, 'failed', error);
      try {
        await recover?.();
      } catch {
        // The transaction is gone; the caller's next statement reports it.
      }
      return failed;
    }
    if (verdict === 'abstain') continue;
    if (verdict === 'deny') {
      if (rule.mayDeny === true) return { denied: true, before: [], after: [] };
      // A configuration error: the list SQL of a rule that did not declare `mayDeny` does not hide the record.
      logFailure(rule, 'returned deny without declaring mayDeny');
      return failed;
    }
    if (verdict !== 'allow') {
      logFailure(rule, 'returned an unknown verdict');
      return failed;
    }
    const role = accessRuleRole(rt, rule);
    if (role === null) {
      logFailure(rule, 'confers a role the resource type does not have');
      return failed;
    }
    (rule.position === 'before-grants' ? before : after).push({ role, via: rule.id });
  }
  return { denied: false, before, after };
}

/** The SQL conditions the rules contribute for one listing. */
export interface RuleSqlParts<S> {
  /** `allow` conditions of rules whose role reaches `minRank`. */
  readonly allow: S[];
  /** `deny` conditions. */
  readonly deny: S[];
}

/**
 * Collects the SQL of every applicable rule. A rule whose `sql` throws is
 * failed closed: a rule that can deny hides every record it could deny
 * (`deny` = TRUE), any other rule contributes nothing.
 */
export function collectRuleSql<S>(
  rt: ResolvedResourceType,
  base: Omit<AccessRuleSqlContext<S>, 'resourceType'>,
  minRank: number,
): RuleSqlParts<S> {
  const parts: RuleSqlParts<S> = { allow: [], deny: [] };
  for (const rule of accessRulesFor(rt.type)) {
    if (typeof rule.sql !== 'function') continue;
    let result: AccessRuleSql<S> | null;
    try {
      result = rule.sql<S>({ ...base, resourceType: rt.type });
    } catch (error) {
      logFailure(rule, 'could not build its SQL', error);
      if (rule.mayDeny) parts.deny.push(base.kit.sql`TRUE`);
      continue;
    }
    if (!result) continue;
    if (result.deny !== undefined) parts.deny.push(result.deny);
    if (result.allow !== undefined) {
      const role = accessRuleRole(rt, rule);
      if (role === null) {
        // The in-memory side denies a rule that confers a role the type lacks; the list agrees.
        logFailure(rule, 'confers a role the resource type does not have');
        parts.deny.push(base.kit.sql`TRUE`);
      } else if (rt.rank(role) >= minRank) {
        parts.allow.push(result.allow);
      }
    }
  }
  return parts;
}
