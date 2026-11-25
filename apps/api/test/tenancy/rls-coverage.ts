// =============================================================================
// The row-level-security coverage rule, as a pure function (issue #725)
// =============================================================================
//
// `rls-coverage.db.spec.ts` feeds it the live catalogue; `rls-coverage.spec.ts`
// feeds it fixtures, including the negative control the story asks for: a table
// with an `org_id` column and no policy MUST come back as a problem.
//
// NOT A `*.spec.ts` FILE, so Jest never runs it as a suite.
// =============================================================================

import type { ModelOwnershipDef } from '@marinoscar/platform-api/core';

/** What the catalogue says about one table. */
export interface CatalogTable {
  /** The table name. */
  table: string;
  /** `relrowsecurity`. */
  enabled: boolean;
  /** `relforcerowsecurity`. */
  forced: boolean;
  /** Whether it has an `org_id` column. */
  hasOrgId: boolean;
  /** Names of the policies on it. */
  policies: string[];
}

export interface CoverageInput {
  /** Every model's classification. */
  ownership: readonly ModelOwnershipDef[];
  /** Prisma model name to table name. */
  tableOf: (model: string) => string | undefined;
  /** `RLS_POLICIES` names (the package's list plus the app's). */
  listedPolicies: readonly string[];
  /** The live (or fixture) catalogue. */
  catalogue: readonly CatalogTable[];
}

/**
 * Every way the coverage rule can fail:
 *
 * - an `org` model whose table lacks `relrowsecurity` or `relforcerowsecurity`;
 * - an `org` model whose table has no policy named in `RLS_POLICIES`;
 * - a table with an `org_id` column that no `org` / `org-optional` model, and
 *   no `orgReference`, accounts for ("no unregistered table has an org_id
 *   column");
 * - a table that forces row-level security although no `org` model owns it.
 */
export function checkRlsCoverage(input: CoverageInput): string[] {
  const problems: string[] = [];
  const byTable = new Map(input.catalogue.map((t) => [t.table, t]));
  const orgTables = new Set<string>();
  const accountedForOrgId = new Set<string>();

  for (const def of input.ownership) {
    const table = input.tableOf(def.model);
    if (table === undefined) {
      problems.push(`${def.model}: no table`);
      continue;
    }
    if (def.kind === 'org') orgTables.add(table);
    if (def.kind === 'org' || def.kind === 'org-optional' || def.orgReference !== undefined) accountedForOrgId.add(table);

    if (def.kind !== 'org') continue;

    const live = byTable.get(table);
    if (!live) {
      problems.push(`${def.model}: table ${table} does not exist`);
      continue;
    }
    if (!live.hasOrgId) problems.push(`${table}: an org model has no org_id column`);
    if (!live.enabled) problems.push(`${table}: relrowsecurity is false`);
    if (!live.forced) problems.push(`${table}: relforcerowsecurity is false`);
    if (!live.policies.some((name) => input.listedPolicies.includes(name))) {
      problems.push(`${table}: no policy named in RLS_POLICIES (has: ${live.policies.join(', ') || 'none'})`);
    }
  }

  for (const live of input.catalogue) {
    if (live.hasOrgId && !accountedForOrgId.has(live.table)) {
      problems.push(`${live.table}: has an org_id column but no model classifies it org, org-optional or orgReference`);
    }
    if (live.forced && !orgTables.has(live.table)) {
      problems.push(`${live.table}: forces row-level security but no org model owns it`);
    }
  }

  return problems;
}
