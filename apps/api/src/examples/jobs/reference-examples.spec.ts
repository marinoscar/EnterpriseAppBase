// The jobs slice's two small reference examples (#734): a label registered
// for a handler-less type, and an ambient organization scope the queue reads
// when `orgId` is omitted.

import { JobsService, jobTypeLabel, type JobsPrisma } from '@marinoscar/platform-api/jobs';

import { ambientOrgScope, runWithOrg } from './ambient-org-scope.example';
import { RETIRED_EXAMPLE_JOB_TYPE, registerExampleJobTypeLabels } from './job-type-labels.example';

const ORG = '11111111-1111-4111-8111-aaaaaaaaaaaa';

describe('jobs reference examples', () => {
  it('labels a type no handler registers', () => {
    expect(jobTypeLabel(RETIRED_EXAMPLE_JOB_TYPE)).toBe(RETIRED_EXAMPLE_JOB_TYPE);
    registerExampleJobTypeLabels();
    expect(jobTypeLabel(RETIRED_EXAMPLE_JOB_TYPE)).toBe('Legacy export (retired)');
  });

  it('fills an omitted orgId from the ambient scope, and never replaces an explicit null', async () => {
    const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'job', ...data }));
    const jobs = new JobsService({ job: { create, findFirst: jest.fn() } } as unknown as JobsPrisma, undefined, undefined, ambientOrgScope);

    await runWithOrg(ORG, async () => {
      await jobs.enqueue({ type: 'example.echo', reason: 'upload', skipDedup: true });
      await jobs.enqueue({ type: 'example.echo', reason: 'backfill', skipDedup: true, orgId: null });
    });
    await jobs.enqueue({ type: 'example.echo', reason: 'upload', skipDedup: true });

    expect(create.mock.calls.map((call) => call[0].data.orgId)).toEqual([ORG, null, null]);
  });
});
