// The user-data reference examples (#743) compile, register and behave.

import {
  categoriesOfScope,
  findUserDataScope,
  registerFactoryResetStep,
  registerOffboardingPrecondition,
  registerPlatformUserData,
  registerUserDataCategory,
  registerUserDataModels,
  registerUserDataScope,
  resolveUserDataModuleOptions,
} from '@marinoscar/platform-api/user-data';

import {
  EXAMPLE_CONTENT_SCOPE_OVERRIDE,
  EXAMPLE_DELEGATE,
  EXAMPLE_FACTORY_RESET_STEP,
  EXAMPLE_LEGACY_JOB_TYPES,
  EXAMPLE_OFFBOARDING_PRECONDITION,
  EXAMPLE_USER_DATA_CATEGORY,
  EXAMPLE_USER_DATA_MODELS,
  EXAMPLE_USER_DATA_SCOPE,
} from './user-data.examples';

describe('user-data reference examples', () => {
  beforeAll(() => {
    registerPlatformUserData();
    registerUserDataCategory(EXAMPLE_USER_DATA_CATEGORY);
    registerUserDataScope(EXAMPLE_USER_DATA_SCOPE);
    registerUserDataScope(EXAMPLE_CONTENT_SCOPE_OVERRIDE);
    registerUserDataModels(EXAMPLE_USER_DATA_MODELS);
    registerFactoryResetStep(EXAMPLE_FACTORY_RESET_STEP);
    registerOffboardingPrecondition(EXAMPLE_OFFBOARDING_PRECONDITION);
  });

  it('a narrow scope selects only its category, with the upper-cased phrase', () => {
    expect(categoriesOfScope(findUserDataScope('transcripts')!)).toEqual(['transcripts']);
    expect(findUserDataScope('transcripts')!.confirmation).toBe('TRANSCRIPTS');
  });

  it('the explicit override replaces the built-in content phrase', () => {
    expect(findUserDataScope('content')!.confirmation).toBe('CONTENT');
    expect(categoriesOfScope(findUserDataScope('content')!)).toContain('transcripts');
  });

  it('the factory reset step deletes finished example jobs and counts them', async () => {
    const tx = { job: { deleteMany: jest.fn(async () => ({ count: 3 })) } };
    await expect(EXAMPLE_FACTORY_RESET_STEP.run(tx, { actorUserId: 'a', jobId: 'j' })).resolves.toEqual({ jobs: 3 });
    expect(tx.job.deleteMany).toHaveBeenCalledWith({ where: { type: { startsWith: 'example.' }, status: { in: ['succeeded', 'failed'] } } });
  });

  it('the precondition blocks while a job of the organization runs', async () => {
    const db = (running: number) => ({ job: { count: jest.fn(async () => running) } });
    await expect(EXAMPLE_OFFBOARDING_PRECONDITION.check({ orgId: 'o' }, db(0))).resolves.toEqual({ passed: true });
    await expect(EXAMPLE_OFFBOARDING_PRECONDITION.check({ orgId: 'o' }, db(2))).resolves.toMatchObject({ passed: false });
  });

  it('the legacy alias maps the old payload, and the module accepts it', () => {
    expect(EXAMPLE_LEGACY_JOB_TYPES[0]!.toPayload({ userId: 'u-1' })).toEqual({ userId: 'u-1', scope: 'everything' });
    expect(resolveUserDataModuleOptions({ datamodel: [], legacyJobTypes: EXAMPLE_LEGACY_JOB_TYPES }).legacyJobTypes).toHaveLength(1);
    expect(EXAMPLE_DELEGATE.payload('u-1')).toEqual({ userId: 'u-1' });
  });
});
