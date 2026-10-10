// The user-data registries and the three request services (#743).

import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { registerUserOwnedModels } from '../../src/core/index';
import { parsePrismaSchema } from '../../src/testing/index';
import {
  FactoryResetService,
  OrgOffboardingService,
  UserDataPlanService,
  UserDataService,
  categoriesOfScope,
  findUserDataScope,
  registerOffboardingPrecondition,
  registerPlatformUserData,
  registerUserDataModels,
  registerUserDataScope,
  resolveUserDataModuleOptions,
  resolvedUserDataScopes,
} from '../../src/user-data/index';
import { createFakeDb } from './fake-db';

const USER = '00000000-0000-4000-8000-0000000000a1';
const ORG = '00000000-0000-4000-8000-0000000000e1';
const datamodel = parsePrismaSchema(`
model User { id String @id }
model Notification {
  id String @id
  userId String
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
model Job { id String @id }
`);

let preconditionPasses = true;
beforeAll(() => {
  registerUserOwnedModels([{ model: 'Notification', ownerField: 'userId', purge: 'delete', export: 'include', rationale: 'r' }]);
  registerPlatformUserData();
  registerUserDataScope({ id: 'content', label: 'Content', description: 'd', categories: 'content', confirmation: 'CONTENT', layer: 'danger', overrideBuiltIn: true });
  registerOffboardingPrecondition({ id: 'recent-export', label: 'Recent export', check: async () => (preconditionPasses ? { passed: true } : { passed: false, message: 'no export' }) });
});

describe('registries', () => {
  it('refuses a built-in scope id without overrideBuiltIn, and an override of a non-built-in', () => {
    expect(() => registerUserDataScope({ id: 'everything', label: 'x', description: 'x', categories: 'all', confirmation: 'X', layer: 'danger' })).toThrow(/built-in/);
    expect(() =>
      registerUserDataScope({ id: 'notes', label: 'x', description: 'x', categories: ['other'], confirmation: 'X', layer: 'specific', overrideBuiltIn: true }),
    ).toThrow(/only for a built-in/);
  });

  it('lets an explicit override replace the built-in content scope (kvox keeps its phrase)', () => {
    expect(findUserDataScope('content')?.confirmation).toBe('CONTENT');
    expect(resolvedUserDataScopes().filter((scope) => scope.id === 'content')).toHaveLength(1);
    expect(findUserDataScope('everything')?.confirmation).toBe('DELETE MY DATA');
  });

  it('resolves content to the content categories, excluding credentials and settings', () => {
    const content = categoriesOfScope({ categories: 'content' });
    expect(content).toEqual(expect.arrayContaining(['files', 'notifications', 'ai', 'other']));
    expect(content).not.toContain('credentials');
    expect(content).not.toContain('settings');
    expect(categoriesOfScope({ categories: 'all' })).toEqual(expect.arrayContaining(['credentials', 'settings']));
  });

  it('refuses a kept model with a category and a second storage-object model', () => {
    expect(() => registerUserDataModels([{ model: 'Thing', keep: 'why', category: 'files' }])).toThrow();
    expect(() => registerUserDataModels([{ model: 'Blob', storageObjects: true }])).toThrow(/only one model/);
  });
});

function services(env: { deploymentMode?: 'self-hosted' | 'saas'; tenancyMode?: 'single' | 'multi' } = {}) {
  const fake = createFakeDb({
    user: [{ id: USER }],
    notification: [{ id: 'n1', userId: USER }],
    job: [{ id: 'j-other', type: 'user.data.purge', subjectType: 'user', subjectId: 'someone-else', status: 'pending', payload: {} }],
    organization: [{ id: ORG, name: 'Acme', slug: 'acme', isDefault: false }, { id: 'def', name: 'Default', slug: 'default', isDefault: true }],
    membership: [],
    invite: [],
  });
  const options = resolveUserDataModuleOptions({ datamodel });
  const plans = new UserDataPlanService(options);
  const jobs = { enqueue: jest.fn(async (input: any) => ({ id: 'job-1', status: 'pending', ...input })) };
  const audit = { record: jest.fn(async () => undefined) };
  const environment = { deploymentMode: () => env.deploymentMode ?? 'self-hosted', tenancyMode: () => env.tenancyMode ?? 'multi' };
  return {
    fake,
    jobs,
    audit,
    user: new UserDataService(fake as any, plans, jobs as any, audit),
    factory: new FactoryResetService(fake as any, environment, plans, jobs as any, audit, options),
    offboard: new OrgOffboardingService(fake as any, environment, plans, jobs as any, audit),
  };
}

describe('UserDataService', () => {
  it('summarizes categories with counts and scopes with phrases', async () => {
    const summary = await services().user.summary(USER);
    expect(summary.categories.find((c) => c.id === 'notifications')).toMatchObject({ count: 1, bytes: null });
    expect(summary.scopes.map((s) => s.id)).toEqual(expect.arrayContaining(['everything', 'content']));
  });

  it('checks the phrase as a literal and the scope, then enqueues one purge per user', async () => {
    const { user, jobs, audit } = services();
    await expect(user.requestDeletion(USER, { scope: 'everything', confirmation: 'delete my data' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(user.requestDeletion(USER, { scope: 'nope', confirmation: 'X' })).rejects.toBeInstanceOf(BadRequestException);
    expect(jobs.enqueue).not.toHaveBeenCalled();
    await expect(user.requestDeletion(USER, { scope: 'everything', confirmation: 'DELETE MY DATA' })).resolves.toEqual({ jobId: 'job-1', status: 'pending' });
    expect(jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'user.data.purge', subjectType: 'user', subjectId: USER, payload: { userId: USER, scope: 'everything' }, orgId: null }),
    );
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'user_data.purge.requested' }));
  });

  it("answers 404 for another user's job", async () => {
    await expect(services().user.status(USER, 'j-other')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('FactoryResetService', () => {
  it('is disabled in saas mode with the documented code, and says so in the summary', async () => {
    const { factory, jobs } = services({ deploymentMode: 'saas' });
    await expect(factory.request(USER)).rejects.toBeInstanceOf(ForbiddenException);
    await factory.request(USER).catch((error: ForbiddenException) => {
      expect((error.getResponse() as any).details.reason).toBe('FACTORY_RESET_DISABLED_IN_SAAS');
    });
    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect((await factory.summary(USER)).disabledReason).toBe('FACTORY_RESET_DISABLED_IN_SAAS');
  });

  it('enqueues one reset per deployment (no subject)', async () => {
    const { factory, jobs } = services();
    await factory.request(USER);
    expect(jobs.enqueue).toHaveBeenCalledWith({ type: 'admin.factory_reset', reason: 'rerun', payload: { actorUserId: USER }, orgId: null });
  });
});

describe('OrgOffboardingService', () => {
  it('answers 409 in single-organization mode', async () => {
    const { offboard } = services({ tenancyMode: 'single' });
    await expect(offboard.request(USER, ORG, { confirmation: 'acme' })).rejects.toBeInstanceOf(ConflictException);
    await expect(offboard.summary(ORG)).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses the default organization and a wrong slug', async () => {
    const { offboard } = services();
    await expect(offboard.request(USER, 'def', { confirmation: 'default' })).rejects.toBeInstanceOf(ConflictException);
    await expect(offboard.request(USER, ORG, { confirmation: 'ACME' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks on a failing precondition unless skipExport gives a reason, which the audit records', async () => {
    preconditionPasses = false;
    const { offboard, jobs, audit } = services();
    await expect(offboard.request(USER, ORG, { confirmation: 'acme' })).rejects.toBeInstanceOf(ConflictException);
    expect(jobs.enqueue).not.toHaveBeenCalled();
    await offboard.request(USER, ORG, { confirmation: 'acme', userDisposition: 'purge', skipExport: { reason: 'customer exported it' } });
    expect(jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'org.offboard', subjectType: 'organization', subjectId: ORG, payload: { orgId: ORG, actorUserId: USER, userDisposition: 'purge' } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'org.offboard.requested', meta: expect.objectContaining({ orgId: ORG, skippedPreconditions: 'recent-export', skipReason: 'customer exported it' }) }),
    );
    preconditionPasses = true;
  });
});
