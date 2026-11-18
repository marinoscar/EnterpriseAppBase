import type { ModelOwnershipDef } from '@marinoscar/platform-api/core';

import { checkRlsCoverage, type CatalogTable } from './rls-coverage';

// The rule itself, against fixtures (the live catalogue is rls-coverage.db.spec.ts).

const ownership: ModelOwnershipDef[] = [
  { model: 'Doc', kind: 'org', rationale: 'x' },
  { model: 'Audit', kind: 'org-optional', rationale: 'x' },
  { model: 'Member', kind: 'system', orgReference: 'orgId', rationale: 'x' },
  { model: 'Note', kind: 'user', rationale: 'x' },
];
const tableOf = (model: string): string | undefined => ({ Doc: 'docs', Audit: 'audits', Member: 'members', Note: 'notes' })[model];
const good: CatalogTable[] = [
  { table: 'docs', enabled: true, forced: true, hasOrgId: true, policies: ['docs_org_isolation'] },
  { table: 'audits', enabled: false, forced: false, hasOrgId: true, policies: [] },
  { table: 'members', enabled: false, forced: false, hasOrgId: true, policies: [] },
  { table: 'notes', enabled: false, forced: false, hasOrgId: false, policies: [] },
];
const run = (catalogue: CatalogTable[], listed = ['docs_org_isolation']) =>
  checkRlsCoverage({ ownership, tableOf, listedPolicies: listed, catalogue });

describe('checkRlsCoverage', () => {
  it('passes when every org model is enabled, forced and protected by a listed policy', () => {
    expect(run(good)).toEqual([]);
  });

  it('FAILS for a fixture table with org_id but no policy (the story\'s negative control)', () => {
    const problems = run([...good, { table: 'leaky', enabled: false, forced: false, hasOrgId: true, policies: [] }]);
    expect(problems).toEqual(['leaky: has an org_id column but no model classifies it org, org-optional or orgReference']);
  });

  it('fails an org model whose table does not enable, force or have a listed policy', () => {
    expect(run([{ ...good[0]!, enabled: false }, ...good.slice(1)])).toEqual(['docs: relrowsecurity is false']);
    expect(run([{ ...good[0]!, forced: false }, ...good.slice(1)])).toEqual(['docs: relforcerowsecurity is false']);
    expect(run([{ ...good[0]!, policies: ['other'] }, ...good.slice(1)])).toEqual([
      'docs: no policy named in RLS_POLICIES (has: other)',
    ]);
    expect(run(good, [])).toEqual(['docs: no policy named in RLS_POLICIES (has: docs_org_isolation)']);
  });

  it('fails an org model with no org_id column and a model with no table', () => {
    expect(run([{ ...good[0]!, hasOrgId: false }, ...good.slice(1)])).toEqual(['docs: an org model has no org_id column']);
    expect(checkRlsCoverage({ ownership, tableOf: () => undefined, listedPolicies: [], catalogue: [] })).toHaveLength(4);
  });

  it('fails a table that forces row-level security although no org model owns it (it would deny everything)', () => {
    expect(run([...good, { table: 'notes2', enabled: true, forced: true, hasOrgId: false, policies: [] }])).toEqual([
      'notes2: forces row-level security but no org model owns it',
    ]);
  });
});
