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
//   - THE SQL IS PARAMETERISED: built from a principal full of hostile
//     strings, none reaches the SQL text; a sub-select must bind the caller's
//     organization;
//   - A RULE THAT CAN DENY HAS SQL (`mayDeny` needs `sql`).
// =============================================================================

import type { Principal } from '../../core/index';
import type { AccessDecision, ResourceRef } from '../access/access-policy.service';
import type { AccessRuleDef } from '../access/access-rules';
import type { SqlKit } from '../access/accessible';
import { HOSTILE_STRINGS } from './grantee-kind-conformance';
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

function hostile(principal: Principal, value: string): Principal {
  return { ...principal, userId: value, email: value, activeOrgId: value, groups: [{ groupId: value, orgId: value, role: value }] };
}

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
  const { rule } = subject;

  describe(`access rule conformance: ${name}`, () => {
    it('declares a valid shape; a rule that can deny provides sql', () => {
      expect(typeof rule.id).toBe('string');
      expect(['before-grants', 'after-grants']).toContain(rule.position);
      expect(typeof rule.evaluate).toBe('function');
      if (rule.mayDeny) expect(typeof rule.sql).toBe('function');
      if (rule.resourceTypes !== undefined) expect(rule.resourceTypes).toContain(subject.resourceType);
    });

    it('the fixture matrix holds an allowed, a denied and a cross-organization row', () => {
      expect(subject.fixtures.some((fixture) => fixture.allowed)).toBe(true);
      expect(subject.fixtures.some((fixture) => !fixture.allowed)).toBe(true);
      expect(subject.fixtures.some((fixture) => fixture.crossOrg === true)).toBe(true);
    });

    it('decides every fixture as its author expects', async () => {
      for (const fixture of subject.fixtures) {
        const decision = await subject.decide(fixture);
        expect({ fixture: fixture.name, allowed: decision.allowed }).toEqual({ fixture: fixture.name, allowed: fixture.allowed });
        if (fixture.allowed && fixture.via !== undefined) expect({ fixture: fixture.name, via: decision.via }).toEqual({ fixture: fixture.name, via: fixture.via });
        if (!fixture.allowed) expect(decision.via).toBeNull();
      }
    });

    it('the decision and the "resources I can see" list agree on every fixture', async () => {
      for (const fixture of subject.fixtures) {
        const decision = await subject.decide(fixture);
        const listed = await subject.listsRecord(fixture);
        expect({ fixture: fixture.name, listed }).toEqual({ fixture: fixture.name, listed: decision.allowed });
      }
    });

    it('isolates organizations: a record of another organization is denied and never listed', async () => {
      for (const fixture of subject.fixtures.filter((candidate) => candidate.crossOrg === true)) {
        expect({ fixture: fixture.name, allowed: (await subject.decide(fixture)).allowed }).toEqual({ fixture: fixture.name, allowed: false });
        expect({ fixture: fixture.name, listed: await subject.listsRecord(fixture) }).toEqual({ fixture: fixture.name, listed: false });
      }
    });

    it('builds parameterised SQL: no principal-derived string reaches the SQL text', () => {
      if (typeof rule.sql !== 'function') return;
      for (const value of HOSTILE_STRINGS) {
        for (const fixture of subject.fixtures) {
          const principal = hostile(fixture.principal, value);
          const column = (columnName: string): RecordedSql => recordingSqlKit.raw(`"r"."${columnName}"`);
          const built = rule.sql<RecordedSql>({
            principal,
            resourceType: subject.resourceType,
            orgId: value,
            kit: recordingSqlKit,
            column,
            idColumn: column('id'),
          });
          for (const part of [built?.allow, built?.deny]) {
            if (!part) continue;
            expect(part.text).not.toContain(value);
            for (const raw of part.raws) expect(raw).toMatch(/^[A-Za-z0-9_."]+$/);
            // A sub-select reads other tables: it must be confined to the caller's organization.
            if (/\b(select|from)\b/i.test(part.text)) expect(part.values).toContain(value);
          }
        }
      }
    });
  });
}
