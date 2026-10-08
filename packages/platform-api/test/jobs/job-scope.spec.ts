// =============================================================================
// JobScope (issue #734): a job's tenant work runs inside its organization
// =============================================================================
//
// The row-level-security proof (two organizations, a FORCEd policy, an
// ordinary role) is apps/api/test/jobs/job-org-id.db.spec.ts. This pins the
// shape: one transaction whose FIRST statement is the transaction-local
// `set_config('app.org_id', …, true)`, and a loud refusal for a system job.
// =============================================================================

import { ScopedAccessError } from '../../src/core/index';
import { JobScope } from '../../src/jobs/job-scope';

const ORG = '11111111-1111-4111-8111-aaaaaaaaaaaa';

function fakeClient() {
  const statements: string[] = [];
  const tx = {
    $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      statements.push(`${strings.join('?')} [${values.join(', ')}]`);
      return 1;
    }),
    marker: 'tx',
  };
  // A root client, as runInOrg recognises one: it has `$connect` and `$extends`.
  const client = {
    $connect: jest.fn(),
    $extends: jest.fn(),
    $executeRaw: jest.fn(),
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { client, tx, statements };
}

describe('JobScope.run', () => {
  it("opens one transaction scoped to the job's organization, set_config first", async () => {
    const { client, tx, statements } = fakeClient();
    const scope = new JobScope(client as never);

    const result = await scope.run({ id: 'job-1', orgId: ORG }, async (inner: typeof tx) => {
      expect(inner).toBe(tx);
      expect(statements).toHaveLength(1);
      return 'done';
    });

    expect(result).toBe('done');
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(statements[0]).toContain('set_config');
    expect(statements[0]).toContain(ORG);
    // Transaction-local, never a session-level SET.
    expect(statements[0]).toMatch(/true/);
  });

  it('refuses a system job (orgId null): it keeps the bypass connection', async () => {
    const { client } = fakeClient();
    const scope = new JobScope(client as never);
    const fn = jest.fn();

    await expect(scope.run({ id: 'job-2', orgId: null }, fn)).rejects.toBeInstanceOf(ScopedAccessError);
    await expect(scope.run({ id: 'job-2', orgId: null }, fn)).rejects.toThrow(/system job/);
    expect(fn).not.toHaveBeenCalled();
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it('refuses an orgId that is not a UUID before opening a transaction', async () => {
    const { client } = fakeClient();
    const scope = new JobScope(client as never);

    await expect(scope.run({ id: 'job-3', orgId: 'not-a-uuid' }, async () => 1)).rejects.toBeInstanceOf(ScopedAccessError);
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});
