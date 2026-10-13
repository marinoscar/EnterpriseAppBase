// =============================================================================
// describeGranteeKindConformance (PP-14.16): the extension-author kit of a
// grantee kind
// =============================================================================
//
// Run it from a Jest/Vitest file of the app (the globals `describe`, `it` and
// `expect` are the runner's). It proves, for ONE registered-or-registrable
// kind:
//
//   - the descriptor is well formed (`GET /api/sharing/grantee-kinds` would
//     serve it);
//   - `validateGrantee` accepts the valid inputs, returns a ref of its own
//     kind, and refuses the invalid ones, hostile strings included;
//   - `describe` answers every valid ref;
//   - THE TWO SPELLINGS AGREE: `matchesPrincipal` (the in-memory decision)
//     equals the SQL fragment `resolvePrincipalMatch` builds (the "resources I
//     can see" list), evaluated by the app's database over a principal x
//     grantee matrix, and a grantee of ANOTHER kind never matches;
//   - the fragment is PARAMETERISED: built from a principal full of hostile
//     strings, none reaches the SQL text;
//   - the fragment is CONFINED to the grant row's columns: a sub-select must
//     bind the caller's organization.
// =============================================================================

import { granteeKindDescriptorSchema } from '@marinoscar/platform-contract/sharing';

import type { Principal } from '../../core/index';
import type { SqlKit } from '../access/accessible';
import { describeGranteeKind, type GranteeColumns, type GranteeFacts, type GranteeKindDef } from '../access/grantee-kinds';
import { recordingSqlKit, type RecordedSql } from './recording-sql-kit';

/**
 * Strings a fragment must never let into its SQL text.
 *
 * @stability experimental
 */
export const HOSTILE_STRINGS: readonly string[] = [
  "'; DROP TABLE grants; --",
  '" OR 1=1 --',
  "x') OR ('1'='1",
  '\\u0027); SELECT pg_sleep(10); --',
  'a@b.c\' UNION SELECT password FROM users --',
];

/**
 * What an app hands the kit.
 *
 * @typeParam S - the app's `Prisma.Sql`.
 *
 * @stability experimental
 */
export interface GranteeKindConformanceSubject<S> {
  /** The kind under test. It need not be registered: the kit calls its members directly. */
  readonly kind: GranteeKindDef;
  /** The app's SQL builders (`Prisma`). */
  readonly sqlKit: SqlKit<S>;
  /**
   * Runs `query` (a `SELECT (<condition>) AS match`) on the app's database and
   * returns the `match` column of its one row: `$queryRaw` in the reference app.
   */
  readonly runQuery: (query: S) => Promise<boolean | null>;
  /** Principals to test against (valid uuids; with groups as the kind needs). */
  readonly principals: readonly Principal[];
  /** Stored grantees to test (the grants row's grantee columns), of this kind and of others. */
  readonly grantees: readonly GranteeFacts[];
  /** Inputs `validateGrantee` accepts. */
  readonly validInputs: readonly unknown[];
  /** Inputs it must refuse (the kit adds {@link HOSTILE_STRINGS} to the string case itself). */
  readonly invalidInputs: readonly unknown[];
}

function hostile(principal: Principal, value: string): Principal {
  return {
    ...principal,
    userId: value,
    email: value,
    activeOrgId: value,
    groups: [{ groupId: value, orgId: value, role: value }],
  };
}

function columnsOf<S>(kit: SqlKit<S>, facts: GranteeFacts): GranteeColumns<S> {
  return {
    kind: kit.sql`${facts.kind}::text`,
    userId: kit.sql`${facts.userId}::uuid`,
    groupId: kit.sql`${facts.groupId}::uuid`,
    ref: kit.sql`${facts.ref}::text`,
  };
}

const RECORDING_COLUMNS: GranteeColumns<RecordedSql> = {
  kind: recordingSqlKit.raw('g.grantee_kind'),
  userId: recordingSqlKit.raw('g.grantee_user_id'),
  groupId: recordingSqlKit.raw('g.grantee_group_id'),
  ref: recordingSqlKit.raw('g.grantee_ref'),
};

/**
 * Registers the grantee-kind conformance suite.
 *
 * @param name - the suite's name.
 * @param subject - the kind and its fixtures.
 *
 * @example
 * ```ts
 * describeGranteeKindConformance('email-domain', {
 *   kind: emailDomainGranteeKind,
 *   sqlKit: Prisma,
 *   runQuery: async (query) => (await prisma.$queryRaw<Array<{ match: boolean | null }>>(query))[0]?.match ?? null,
 *   principals, grantees,
 *   validInputs: ['example.com'], invalidInputs: ['', 'not a domain'],
 * });
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function describeGranteeKindConformance<S>(name: string, subject: GranteeKindConformanceSubject<S>): void {
  const { kind, sqlKit } = subject;

  describe(`grantee kind conformance: ${name}`, () => {
    it('describes itself the way GET /sharing/grantee-kinds serves it', () => {
      expect(() => granteeKindDescriptorSchema.parse(describeGranteeKind(kind))).not.toThrow();
      expect(subject.principals.length).toBeGreaterThan(0);
      expect(subject.grantees.length).toBeGreaterThan(0);
    });

    it('validateGrantee accepts its valid inputs and names its own kind', async () => {
      for (const input of subject.validInputs) {
        const ref = await kind.validateGrantee(input);
        expect(ref.kind).toBe(kind.kind);
        expect(typeof ref.id).toBe('string');
        expect(ref.id.length).toBeGreaterThan(0);
      }
    });

    it('validateGrantee refuses its invalid inputs and every hostile or malformed input', async () => {
      for (const input of [...subject.invalidInputs, undefined, null, 42, {}, [], ...HOSTILE_STRINGS]) {
        if (subject.validInputs.some((valid) => Object.is(valid, input))) continue;
        let outcome: 'ok' | 'refused' = 'ok';
        try {
          const ref = await kind.validateGrantee(input);
          // Accepting a hostile string is acceptable only as inert data of its own kind.
          expect(ref.kind).toBe(kind.kind);
        } catch {
          outcome = 'refused';
        }
        if (subject.invalidInputs.includes(input)) expect(outcome).toBe('refused');
      }
    });

    it('describe answers every valid grantee with a display string', async () => {
      for (const input of subject.validInputs) {
        const ref = await kind.validateGrantee(input);
        const described = await kind.describe(ref);
        expect(typeof described.display).toBe('string');
        expect(described.display.length).toBeGreaterThan(0);
      }
    });

    it('the in-memory match equals the SQL fragment over the principal x grantee matrix', async () => {
      for (const principal of subject.principals) {
        for (const facts of subject.grantees) {
          const memory = kind.matchesPrincipal(facts, principal);
          const condition = kind.resolvePrincipalMatch<S>(principal, columnsOf(sqlKit, facts), sqlKit);
          // `null` is the fragment saying "no grant of this kind can name this principal".
          const sql = condition === null ? false : (await subject.runQuery(sqlKit.sql`SELECT (${condition}) AS match`)) === true;
          expect({ principal: principal.userId, facts, match: sql }).toEqual({ principal: principal.userId, facts, match: memory });
        }
      }
    });

    it('a grantee of another kind never matches, in memory or in SQL', async () => {
      for (const principal of subject.principals) {
        for (const facts of subject.grantees.filter((candidate) => candidate.kind !== kind.kind)) {
          expect(kind.matchesPrincipal(facts, principal)).toBe(false);
          const condition = kind.resolvePrincipalMatch<S>(principal, columnsOf(sqlKit, facts), sqlKit);
          if (condition !== null) expect(await subject.runQuery(sqlKit.sql`SELECT (${condition}) AS match`)).not.toBe(true);
        }
      }
    });

    it('the fragment is parameterised: no principal-derived string reaches the SQL text', () => {
      for (const value of HOSTILE_STRINGS) {
        for (const principal of subject.principals) {
          const fragment = kind.resolvePrincipalMatch<RecordedSql>(hostile(principal, value), RECORDING_COLUMNS, recordingSqlKit);
          if (fragment === null) continue;
          expect(fragment.text).not.toContain(value);
          for (const raw of fragment.raws) expect(raw).toMatch(/^[A-Za-z0-9_.]+$/);
        }
      }
    });

    it('the fragment is a predicate over the grant row: a sub-select must bind the caller organization', () => {
      for (const principal of subject.principals) {
        const fragment = kind.resolvePrincipalMatch<RecordedSql>(principal, RECORDING_COLUMNS, recordingSqlKit);
        if (fragment === null || !/\b(select|from)\b/i.test(fragment.text)) continue;
        expect(principal.activeOrgId).toBeDefined();
        expect(fragment.values).toContain(principal.activeOrgId);
      }
    });
  });
}
