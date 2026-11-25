// =============================================================================
// PP-14.19, proved from the app: an app job reason (`import`), no migration
// =============================================================================

import { jobReasonSchema } from '@marinoscar/platform-contract/jobs';

import { IMPORT_JOB_REASON } from '../../../src/platform-extensions/jobs/import.job-reason';

type Sandbox = { jobs: typeof import('@marinoscar/platform-api/jobs') };

function load(register: boolean): Sandbox {
  let sandbox!: Sandbox;
  jest.isolateModules(() => {
    jest.doMock('../../../src/app-registrations/jobs', () => ({
      APP_JOB_REASONS: register ? [require('../../../src/platform-extensions/jobs/import.job-reason').IMPORT_JOB_REASON] : [],
      APP_NODE_SPAN_ATTRIBUTES: [],
      APP_RETENTION_POLICIES: [],
    }));
    // The app's own wiring path: platform/jobs/jobs.config.ts registers the arrays at import.
    require('../../../src/platform/jobs/jobs.config');
    sandbox = { jobs: require('@marinoscar/platform-api/jobs') };
  });

  return sandbox;
}

describe('the app lists IMPORT_JOB_REASON in APP_JOB_REASONS', () => {
  const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'job-1', ...data }));
  const service = (jobs: Sandbox['jobs']) => new jobs.JobsService({ job: { create, findFirst: jest.fn() } } as never);

  beforeEach(() => create.mockClear());

  it('enqueues with reason "import", and the wire accepts it (a pattern, not an enum)', async () => {
    const { jobs } = load(true);

    await service(jobs).enqueue({ type: 'app.import.run', reason: 'import', skipDedup: true });

    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ reason: 'import' }) });
    expect(jobReasonSchema.safeParse('import').success).toBe(true);
  });

  it('labels it for the admin list, and still labels the platform’s three', () => {
    const { jobs } = load(true);

    expect(jobs.jobReasonLabel('import')).toBe(IMPORT_JOB_REASON.label);
    expect(jobs.listJobReasons().map((reason) => reason.id)).toEqual(['upload', 'rerun', 'backfill', 'import']);
  });

  it('refuses the same reason when the app did not list it: a typo is a bug, not a new reason', async () => {
    const { jobs } = load(false);

    await expect(service(jobs).enqueue({ type: 'app.import.run', reason: 'import', skipDedup: true })).rejects.toThrow(/Unknown job reason "import"/);
    expect(create).not.toHaveBeenCalled();
    expect(jobs.jobReasonLabel('import')).toBe('import');
  });

  it('keeps the shipped app’s reasons exactly the platform’s three', () => {
    const { jobs } = load(false);

    expect(jobs.listJobReasons().map((reason) => reason.id)).toEqual(['upload', 'rerun', 'backfill']);
  });
});
