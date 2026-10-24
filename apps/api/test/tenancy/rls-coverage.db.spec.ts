// =============================================================================
// Real-Postgres tripwire: row-level security covers every org table, and no
// table has org_id unexplained (issue #725 PP-6.5)
// =============================================================================
//
// Against the live catalogue of the migrated test database (read only; the
// negative control creates its fixture table inside a transaction that is rolled
// back):
//
//   - every model registered `org` has relrowsecurity AND relforcerowsecurity
//     and a policy named in RLS_POLICIES (the package's list);
//   - every policy in pg_policies is listed (the allow-list is exact);
//   - no table has an `org_id` column unless its model is `org`, `org-optional`
//     or declares `orgReference`;
//   - a fixture table with org_id and no policy FAILS the same rule.
//
// The pure rule is ./rls-coverage.ts (unit-tested with fixtures in
// rls-coverage.spec.ts).
// =============================================================================

import { Prisma } from '@prisma/client';
import { RLS_POLICIES } from '@marinoscar/platform-db';
import { modelOwnershipRegistry } from '@marinoscar/platform-api/core';
import { checkRls } from '@marinoscar/platform-api/identity/testing';

import '../../src/prisma/ownership';
import { createDbClient, resolveDbSuite } from '../jobs/db-test-support';
import { checkRlsCoverage, type CatalogTable } from './rls-coverage';

const { describeWithDb } = resolveDbSuite('rls-coverage.db.spec');

const tableOf = (model: string): string | undefined => {
  const found = Prisma.dmmf.datamodel.models.find((m) => m.name === model);
  return found ? (found.dbName ?? found.name) : undefined;
};

describeWithDb('row-level security coverage (live catalogue)', () => {
  const client = createDbClient();

  afterAll(() => client.$disconnect());

  async function catalogue(): Promise<CatalogTable[]> {
    const rows = await client.$queryRaw<
      Array<{ table: string; enabled: boolean; forced: boolean; has_org_id: boolean; policies: string[] }>
    >`
      SELECT c.relname AS "table", c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
             EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped) AS has_org_id,
             coalesce((SELECT array_agg(p.polname::text) FROM pg_policy p WHERE p.polrelid = c.oid), ARRAY[]::text[]) AS policies
      FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
      ORDER BY c.relname`;
    return rows.map((r) => ({ table: r.table, enabled: r.enabled, forced: r.forced, hasOrgId: r.has_org_id, policies: r.policies }));
  }

  const input = async () => ({
    ownership: modelOwnershipRegistry.list(),
    tableOf,
    listedPolicies: RLS_POLICIES.map((p) => p.name),
    catalogue: await catalogue(),
  });

  it('passes: every org model is enabled, forced and protected by a listed policy; no org_id is unexplained', async () => {
    expect(checkRlsCoverage(await input())).toEqual([]);
  });

  // The identity conformance suite's db-tier check (#727): every org table
  // (RLS_POLICIES' tables) is enabled AND forced with one of its policies.
  it('passes the identity conformance rls check', async () => {
    const policies: Record<string, string[]> = {};
    for (const policy of RLS_POLICIES) (policies[policy.table] ??= []).push(policy.name);
    const live = await catalogue();
    await expect(
      checkRls({ policies, inspect: async (tables) => live.filter((entry) => tables.includes(entry.table)) }),
    ).resolves.toEqual([]);
  });

  it('has exactly the listed policies in pg_policies (the allow-list is exact)', async () => {
    const live = await client.$queryRaw<Array<{ tablename: string; policyname: string }>>`
      SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname`;
    expect(live.map((p) => `${p.tablename}/${p.policyname}`)).toEqual(
      RLS_POLICIES.map((p) => `${p.table}/${p.name}`).sort(),
    );
  });

  it('FAILS for a fixture table with org_id but no policy (negative control, rolled back)', async () => {
    const rollback = new Error('rollback');
    let problems: string[] = [];

    await client
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe('CREATE TABLE rls_fixture_leaky (id uuid PRIMARY KEY, org_id uuid NOT NULL)');
        const base = await input();
        const rows = await tx.$queryRaw<Array<{ table: string }>>`SELECT relname AS "table" FROM pg_class WHERE relname = 'rls_fixture_leaky'`;
        expect(rows).toHaveLength(1);
        problems = checkRlsCoverage({
          ...base,
          catalogue: [...base.catalogue, { table: 'rls_fixture_leaky', enabled: false, forced: false, hasOrgId: true, policies: [] }],
        });
        throw rollback;
      })
      .catch((error: unknown) => {
        if (error !== rollback) throw error;
      });

    expect(problems).toEqual([
      'rls_fixture_leaky: has an org_id column but no model classifies it org, org-optional or orgReference',
    ]);
    const left = await client.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_class WHERE relname = 'rls_fixture_leaky'`;
    expect(left[0]!.n).toBe(0);
  });
});
