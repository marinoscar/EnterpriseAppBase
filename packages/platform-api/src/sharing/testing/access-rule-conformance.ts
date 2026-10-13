// =============================================================================
// describeAccessRuleConformance (PP-14.16): the extension-author kit of an
// access rule
// =============================================================================
//
// Run it from a Jest/Vitest file of the app, after the rule and its resource
// type are registered, against the app's real `AccessPolicy` and "resources I
// can see" query. For ONE rule it proves:
//
//   - THE DECISION AND THE LIST AGREE over a fixture matrix: for every
//     fixture, `AccessPolicy.decide(...).allowed` equals "the record appears in
//     the list the app builds with `accessibleSql`" (the matrix must not hold a
//     fixture only one of the two can express, such as a bypass holder);
//   - THE DECISION IS WHAT THE AUTHOR SAYS: each fixture names the expected
//     outcome (and `via`);
//   - ORGANIZATIONS ARE ISOLATED: a fixture flagged `crossOrg` (a principal of
//     one organization, a record of another) is denied and not listed;
//   - THE SQL IS PARAMETERISED: built from a principal whose every string
//     field carries a DIFFERENT hostile payload, none reaches the SQL text, and
//     a fragment built outside `ctx.kit` is refused; a sub-select must bind the
//     caller's organization VALUE (the kit sees that it is bound, not that the
//     predicate uses it correctly: review the sub-select, and the fixture
//     matrix's cross-organization rows are what catch a missing predicate);
//   - A RULE THAT CAN DENY SAYS SO AND HAS SQL: `mayDeny` needs `sql` that
//     returns a `deny`, and no decision may be a rule FAILURE (a throw, an
//     unknown verdict, a deny without `mayDeny`: `AccessDecision.ruleFailure`).
//
// Each check is a plain function returning its violations (`accessRuleChecks`),
// so a test can feed a deliberately broken rule and assert the kit rejects it;
// `describeAccessRuleConformance` runs them under the test runner.
// =============================================================================

import type { Principal } from '../../core/index';
import type { AccessDecision, ResourceRef } from '../access/access-policy.service';
import type { AccessRuleDef } from '../access/access-rules';
import type { SqlKit } from '../access/accessible';
import { HOSTILE_STRINGS } from './grantee-kind-conformance';
import { hostilePrincipal } from './hostile-principal';
import { recordingSqlKit, type RecordedSql } from './recording-sql-kit';

/**
 * One row of the fixture matrix.
 *
 * @stability experimental
 */
export interface AccessRuleFixture {
  /** A name for the failure message ("member of the project"). */
  readonly name: string;
  /** The caller, enriched with its groups. */
  readonly principal: Principal;
  /** The record. */
  readonly ref: ResourceRef;
  /** The action asked. */
  readonly action: string;
  /** Whether the action is allowed. */
  readonly allowed: boolean;
  /** The `via` of an allowed decision (the rule's id, or another source). Not checked when absent. */
  readonly via?: string;
  /** The principal's organization is not the record's: it must be denied and not listed. */
  readonly crossOrg?: boolean;
}

/**
 * What an app hands the kit.
 *
 * @typeParam S - the app's `Prisma.Sql`.
 *
 * @stability experimental
 */
export interface AccessRuleConformanceSubject<S> {
  /** The rule under test (the object the app registered). */
  readonly rule: AccessRuleDef;
  /** A resource type the rule applies to. */
  readonly resourceType: string;
  /** The app's SQL builders (`Prisma`); only used with the recording kit here. */
  readonly sqlKit: SqlKit<S>;
  /** The real decision: `AccessPolicy.decide(principal, action, ref)`. */
  readonly decide: (fixture: AccessRuleFixture) => Promise<AccessDecision>;
  /**
   * Whether the real "resources I can see" query for the fixture's principal
   * returns the fixture's record: `accessibleSql` (or the `exists` form of
   * `accessibleWhere`) over the app's table, with `minRole` the role the
   * action needs.
   */
  readonly listsRecord: (fixture: AccessRuleFixture) => Promise<boolean>;
  /** The fixture matrix. It must hold an allowed and a denied row, and a `crossOrg` row. */
  readonly fixtures: readonly AccessRuleFixture[];
}

/**
 * The checks of {@link describeAccessRuleConformance}, as functions returning
 * their violations (empty: the check passes).
 *
 * @stability experimental
 */
export const accessRuleChecks = {
  async shape<S>(subject: AccessRuleConformanceSubject<S>): Promise<string[]> {
    const { rule } = subject;
    const out: string[] = [];
    if (typeof rule.id !== 'string') out.push('the rule has no id');
    if (rule.position !== 'before-grants' && rule.position !== 'after-grants') out.push('position must be before-grants or after-grants');
    if (typeof rule.evaluate !== 'function') out.push('evaluate must be a function');
    if (rule.mayDeny && typeof rule.sql !== 'function') out.push('a rule that can deny (mayDeny) must provide sql');
    if (rule.resourceTypes !== undefined && !rule.resourceTypes.includes(subject.resourceType)) out.push(`the rule does not apply to "${subject.resourceType}"`);
    if (!subject.fixtures.some((fixture) => fixture.allowed)) out.push('the fixture matrix has no allowed row');
    if (!subject.fixtures.some((fixture) => !fixture.allowed)) out.push('the fixture matrix has no denied row');
    if (!subject.fixtures.some((fixture) => fixture.crossOrg === true)) out.push('the fixture matrix has no crossOrg row');
    return out;
  },

  /** Every fixture is decided as its author expects, and no decision is a rule failure. */
  async decisions<S>(subject: AccessRuleConformanceSubject<S>): Promise<string[]> {
    const out: string[] = [];
    for (const fixture of subject.fixtures) {
      const decision = await subject.decide(fixture);
      if (decision.allowed !== fixture.allowed) out.push(`${fixture.name}: decided allowed=${decision.allowed}, expected ${fixture.allowed}`);
      if (fixture.allowed && fixture.via !== undefined && decision.via !== fixture.via) out.push(`${fixture.name}: via ${decision.via}, expected ${fixture.via}`);
      if (!fixture.allowed && decision.via !== null) out.push(`${fixture.name}: a denial names via ${decision.via}`);
      if (decision.ruleFailure === true) out.push(`${fixture.name}: an access rule FAILED or was misconfigured (a throw, an unknown verdict, or a deny without mayDeny and sql.deny)`);
    }
    return out;
  },

  /** The decision equals "the record is listed" on every fixture. */
  async agreement<S>(subject: AccessRuleConformanceSubject<S>): Promise<string[]> {
    const out: string[] = [];
    for (const fixture of subject.fixtures) {
      const decision = await subject.decide(fixture);
      const listed = await subject.listsRecord(fixture);
      if (listed !== decision.allowed) out.push(`${fixture.name}: decision allowed=${decision.allowed}, listed=${listed}`);
    }
    return out;
  },

  /** A record of another organization is denied and never listed. */
  async isolation<S>(subject: AccessRuleConformanceSubject<S>): Promise<string[]> {
    const out: string[] = [];
    for (const fixture of subject.fixtures.filter((candidate) => candidate.crossOrg === true)) {
      if ((await subject.decide(fixture)).allowed) out.push(`${fixture.name}: a record of another organization was allowed`);
      if (await subject.listsRecord(fixture)) out.push(`${fixture.name}: a record of another organization was listed`);
    }
    return out;
  },

  /** No principal-derived string reaches the SQL text; a sub-select binds the organization value; mayDeny gives a deny. */
  async sqlSafety<S>(subject: AccessRuleConformanceSubject<S>): Promise<string[]> {
    const { rule } = subject;
    const out: string[] = [];
    if (typeof rule.sql !== 'function') return out;
    let gaveDeny = false;
    for (const payload of HOSTILE_STRINGS) {
      for (const fixture of subject.fixtures) {
        const { principal, orgValue, values } = hostilePrincipal(fixture.principal, payload);
        const column = (columnName: string): RecordedSql => recordingSqlKit.raw(`"r"."${columnName}"`);
        let built: ReturnType<NonNullable<AccessRuleDef['sql']>>;
        try {
          built = rule.sql<RecordedSql>({ principal, resourceType: subject.resourceType, orgId: orgValue, kit: recordingSqlKit, column, idColumn: column('id') });
        } catch (error) {
          out.push(`sql threw for a hostile principal: ${(error as Error).message}`);
          continue;
        }
        for (const [label, part] of [['allow', built?.allow], ['deny', built?.deny]] as const) {
          if (!part) continue;
          const text = (part as RecordedSql).text;
          if (label === 'deny') {
            gaveDeny = true;
            if (!rule.mayDeny) out.push('sql returns a deny but the rule does not declare mayDeny');
          }
          for (const value of [payload, ...values]) if (text.includes(value)) out.push(`${label}: a principal-derived string reached the SQL text: ${JSON.stringify(value)}`);
          for (const raw of (part as RecordedSql).raws) if (!/^[A-Za-z0-9_."]+$/.test(raw)) out.push(`${label}: raw() received a non-identifier: ${JSON.stringify(raw)}`);
          // A sub-select reads other tables: it must bind the caller's organization VALUE (distinct from every other field).
          if (/\b(select|from)\b/i.test(text) && !(part as RecordedSql).values.includes(orgValue)) {
            out.push(`${label}: a sub-select does not bind the caller organization (ctx.orgId)`);
          }
        }
      }
    }
    if (rule.mayDeny && !gaveDeny) out.push('mayDeny is set but sql never returned a deny');
    return [...new Set(out)];
  },
};

/**
 * Registers the access-rule conformance suite.
 *
 * @param name - the suite's name.
 * @param subject - the rule, the real decision and list, and the fixtures.
 *
 * @example
 * ```ts
 * describeAccessRuleConformance('project-member', {
 *   rule: projectMemberRule, resourceType: 'project_document', sqlKit: Prisma,
 *   decide: (f) => access.decide(f.principal, f.action, f.ref),
 *   listsRecord: async (f) => (await listIds(f.principal)).includes(f.ref.id),
 *   fixtures,
 * });
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function describeAccessRuleConformance<S>(name: string, subject: AccessRuleConformanceSubject<S>): void {
  describe(`access rule conformance: ${name}`, () => {
    it('declares a valid shape; a rule that can deny provides sql; the fixture matrix is usable', async () => expect(await accessRuleChecks.shape(subject)).toEqual([]));
    it('decides every fixture as its author expects, and no decision is a rule failure', async () => expect(await accessRuleChecks.decisions(subject)).toEqual([]));
    it('the decision and the "resources I can see" list agree on every fixture', async () => expect(await accessRuleChecks.agreement(subject)).toEqual([]));
    it('isolates organizations: a record of another organization is denied and never listed', async () => expect(await accessRuleChecks.isolation(subject)).toEqual([]));
    it('builds parameterised SQL that binds the organization in every sub-select', async () => expect(await accessRuleChecks.sqlSafety(subject)).toEqual([]));
  });
}
