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
//     kind, and refuses the invalid ones;
//   - `describe` answers every valid ref;
//   - THE TWO SPELLINGS AGREE: `matchesPrincipal` (the in-memory decision)
//     equals the SQL fragment `resolvePrincipalMatch` builds (the "resources I
//     can see" list), evaluated by the app's database over a principal x
//     grantee matrix, and a grantee of ANOTHER kind never matches;
//   - the fragment is PARAMETERISED: built from a principal whose every string
//     field (userId, e-mail, roles, permissions, memberships, groups, ...)
//     carries a DIFFERENT hostile payload, none reaches the SQL text, and a
//     fragment built outside the kit (`Prisma.raw(principal.email)`) is refused;
//   - a fragment that reads another table (a sub-select) BINDS the caller's
//     organization value. The kit sees that the organization value is among
//     the bound values, not that the predicate uses it correctly: review the
//     sub-select, and prefer a table under row-level security.
//
// Each check is a plain function returning its violations (`granteeKindChecks`),
// so a test can feed a deliberately broken kind and assert the kit rejects it;
// `describeGranteeKindConformance` runs them under the test runner.
// =============================================================================

import { granteeKindDescriptorSchema } from '@marinoscar/platform-contract/sharing';

import type { Principal } from '../../core/index';
import type { SqlKit } from '../access/accessible';
import { describeGranteeKind, type GranteeColumns, type GranteeFacts, type GranteeKindDef } from '../access/grantee-kinds';
import { hostilePrincipal } from './hostile-principal';
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
  /** Inputs it must refuse. */
  readonly invalidInputs: readonly unknown[];
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

async function attempt<T>(fn: () => T | Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await fn() };
  } catch {
    return { ok: false };
  }
}

/**
 * The checks of {@link describeGranteeKindConformance}, as functions returning
 * their violations (empty: the check passes).
 *
 * @stability experimental
 */
export const granteeKindChecks = {
  async descriptor<S>(subject: GranteeKindConformanceSubject<S>): Promise<string[]> {
    const out: string[] = [];
    if (!granteeKindDescriptorSchema.safeParse(describeGranteeKind(subject.kind)).success) out.push('the descriptor does not parse');
    if (subject.principals.length === 0) out.push('no principals in the fixture matrix');
    if (subject.grantees.length === 0) out.push('no grantees in the fixture matrix');
    return out;
  },

  async validation<S>(subject: GranteeKindConformanceSubject<S>): Promise<string[]> {
    const out: string[] = [];
    for (const input of subject.validInputs) {
      const result = await attempt(() => subject.kind.validateGrantee(input));
      if (!result.ok) out.push(`validateGrantee refused a valid input ${JSON.stringify(input)}`);
      else if (result.value.kind !== subject.kind.kind || typeof result.value.id !== 'string' || result.value.id.length === 0) {
        out.push(`validateGrantee returned a ref that is not of kind "${subject.kind.kind}" with an id`);
      }
    }
    for (const input of subject.invalidInputs) {
      if ((await attempt(() => subject.kind.validateGrantee(input))).ok) out.push(`validateGrantee accepted an invalid input ${JSON.stringify(input)}`);
    }
    // Anything else may be refused or accepted, but accepted only as inert data of its own kind.
    for (const input of [undefined, null, 42, {}, [], ...HOSTILE_STRINGS]) {
      const result = await attempt(() => subject.kind.validateGrantee(input));
      if (result.ok && result.value.kind !== subject.kind.kind) out.push('validateGrantee returned a ref of another kind for a malformed input');
    }
    return out;
  },

  async describe<S>(subject: GranteeKindConformanceSubject<S>): Promise<string[]> {
    const out: string[] = [];
    for (const input of subject.validInputs) {
      const ref = await subject.kind.validateGrantee(input);
      const described = await attempt(() => subject.kind.describe(ref));
      if (!described.ok || typeof described.value.display !== 'string' || described.value.display.length === 0) {
        out.push(`describe gave no display string for ${JSON.stringify(ref)}`);
      }
    }
    return out;
  },

  /** The in-memory match equals the SQL fragment, evaluated by the database, over the principal x grantee matrix. */
  async agreement<S>(subject: GranteeKindConformanceSubject<S>): Promise<string[]> {
    const out: string[] = [];
    for (const principal of subject.principals) {
      for (const facts of subject.grantees) {
        const memory = subject.kind.matchesPrincipal(facts, principal);
        const condition = subject.kind.resolvePrincipalMatch<S>(principal, columnsOf(subject.sqlKit, facts), subject.sqlKit);
        // `null` is the fragment saying "no grant of this kind can name this principal".
        const sql = condition === null ? false : (await subject.runQuery(subject.sqlKit.sql`SELECT (${condition}) AS match`)) === true;
        if (sql !== memory) out.push(`principal ${principal.userId} x grantee ${JSON.stringify(facts)}: in memory ${memory}, in SQL ${sql}`);
      }
    }
    return out;
  },

  /** A grantee of another kind never matches, in memory or in SQL. */
  async otherKinds<S>(subject: GranteeKindConformanceSubject<S>): Promise<string[]> {
    const out: string[] = [];
    for (const principal of subject.principals) {
      for (const facts of subject.grantees.filter((candidate) => candidate.kind !== subject.kind.kind)) {
        if (subject.kind.matchesPrincipal(facts, principal)) out.push(`a grantee of kind "${facts.kind}" matched in memory`);
        const condition = subject.kind.resolvePrincipalMatch<S>(principal, columnsOf(subject.sqlKit, facts), subject.sqlKit);
        if (condition !== null && (await subject.runQuery(subject.sqlKit.sql`SELECT (${condition}) AS match`)) === true) {
          out.push(`a grantee of kind "${facts.kind}" matched in SQL`);
        }
      }
    }
    return out;
  },

  /** No principal-derived string reaches the SQL text; a sub-select binds the caller's organization value. */
  async sqlSafety<S>(subject: GranteeKindConformanceSubject<S>): Promise<string[]> {
    const out: string[] = [];
    for (const payload of HOSTILE_STRINGS) {
      for (const base of subject.principals) {
        const { principal, orgValue, values } = hostilePrincipal(base, payload);
        let fragment: RecordedSql | null;
        try {
          fragment = subject.kind.resolvePrincipalMatch<RecordedSql>(principal, RECORDING_COLUMNS, recordingSqlKit);
        } catch (error) {
          out.push(`resolvePrincipalMatch threw for a hostile principal: ${(error as Error).message}`);
          continue;
        }
        if (fragment === null) continue;
        for (const value of [payload, ...values]) {
          if (fragment.text.includes(value)) out.push(`a principal-derived string reached the SQL text: ${JSON.stringify(value)}`);
        }
        for (const raw of fragment.raws) if (!/^[A-Za-z0-9_.]+$/.test(raw)) out.push(`raw() received a non-identifier: ${JSON.stringify(raw)}`);
        if (/\b(select|from)\b/i.test(fragment.text) && !fragment.values.includes(orgValue)) {
          out.push('a sub-select does not bind the caller organization (principal.activeOrgId)');
        }
      }
    }
    return [...new Set(out)];
  },
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
  describe(`grantee kind conformance: ${name}`, () => {
    it('describes itself the way GET /sharing/grantee-kinds serves it', async () => expect(await granteeKindChecks.descriptor(subject)).toEqual([]));
    it('validateGrantee accepts its valid inputs, refuses its invalid ones and stays in its own kind', async () =>
      expect(await granteeKindChecks.validation(subject)).toEqual([]));
    it('describe answers every valid grantee with a display string', async () => expect(await granteeKindChecks.describe(subject)).toEqual([]));
    it('the in-memory match equals the SQL fragment over the principal x grantee matrix', async () =>
      expect(await granteeKindChecks.agreement(subject)).toEqual([]));
    it('a grantee of another kind never matches, in memory or in SQL', async () => expect(await granteeKindChecks.otherKinds(subject)).toEqual([]));
    it('the fragment is parameterised and a sub-select binds the caller organization', async () =>
      expect(await granteeKindChecks.sqlSafety(subject)).toEqual([]));
  });
}
