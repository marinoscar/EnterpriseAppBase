import { recordTenancyMode } from '../auth/tenancy-mode';
import { MissingOrgScopeError, orgIdFromPayload, resolveJobOrgId, resolveOrgId } from './org-scope';

// =============================================================================
// Resolving the organization tenant work runs in (issue #725)
// =============================================================================

const DEFAULT_ORG = '00000000-0000-4000-8000-0000000000d0';

function prismaWithDefault(id: string | null) {
  return { organization: { findFirst: jest.fn().mockResolvedValue(id === null ? null : { id }) } } as never;
}

describe('orgIdFromPayload', () => {
  it('reads a non-empty string orgId and nothing else', () => {
    expect(orgIdFromPayload({ orgId: 'org-1', other: 1 })).toBe('org-1');
    expect(orgIdFromPayload({ orgId: '' })).toBeUndefined();
    expect(orgIdFromPayload({ orgId: 7 })).toBeUndefined();
    expect(orgIdFromPayload({})).toBeUndefined();
    expect(orgIdFromPayload(null)).toBeUndefined();
    expect(orgIdFromPayload('orgId')).toBeUndefined();
  });
});

describe('resolveOrgId', () => {
  afterEach(() => recordTenancyMode('single'));

  it('returns a given organization without reading the database, in either mode', async () => {
    for (const mode of ['single', 'multi'] as const) {
      recordTenancyMode(mode);
      const prisma = prismaWithDefault(DEFAULT_ORG);

      await expect(resolveOrgId(prisma, 'org-given', 'ctx')).resolves.toBe('org-given');
      expect((prisma as { organization: { findFirst: jest.Mock } }).organization.findFirst).not.toHaveBeenCalled();
    }
  });

  it('single mode: work with no organization belongs to the default organization', async () => {
    recordTenancyMode('single');
    const prisma = prismaWithDefault(DEFAULT_ORG);

    await expect(resolveOrgId(prisma, undefined, 'ctx')).resolves.toBe(DEFAULT_ORG);
    await expect(resolveOrgId(prisma, null, 'ctx')).resolves.toBe(DEFAULT_ORG);
    await expect(resolveOrgId(prisma, '', 'ctx')).resolves.toBe(DEFAULT_ORG);
    expect((prisma as { organization: { findFirst: jest.Mock } }).organization.findFirst).toHaveBeenCalledWith({
      where: { isDefault: true },
      select: { id: true },
    });
  });

  it('single mode without a default organization fails with a named error, not a guess', async () => {
    recordTenancyMode('single');

    await expect(resolveOrgId(prismaWithDefault(null), undefined, 'Job 9 (x)')).rejects.toThrow(MissingOrgScopeError);
    await expect(resolveOrgId(prismaWithDefault(null), undefined, 'Job 9 (x)')).rejects.toThrow(/default organization does not exist/);
  });

  it('multi mode: work with no organization FAILS rather than guess, and never reads the default organization', async () => {
    recordTenancyMode('multi');
    const prisma = prismaWithDefault(DEFAULT_ORG);

    await expect(resolveOrgId(prisma, undefined, 'Job 9 (ai.response.run)')).rejects.toThrow(MissingOrgScopeError);
    await expect(resolveOrgId(prisma, undefined, 'Job 9 (ai.response.run)')).rejects.toThrow(/Job 9 \(ai\.response\.run\).*TENANCY_MODE=multi/);
    expect((prisma as { organization: { findFirst: jest.Mock } }).organization.findFirst).not.toHaveBeenCalled();
  });
});

describe('resolveJobOrgId', () => {
  afterEach(() => recordTenancyMode('single'));

  it("uses the payload's orgId, whatever the mode", async () => {
    recordTenancyMode('multi');
    await expect(resolveJobOrgId(prismaWithDefault(DEFAULT_ORG), { id: 'j', type: 't', payload: { orgId: 'org-p' } })).resolves.toBe('org-p');
  });

  it('a pre-#725 payload (no orgId) runs in the default organization in single mode and fails in multi mode', async () => {
    const job = { id: 'job-1', type: 'storage.object.process', payload: { objectId: 'o' } };

    recordTenancyMode('single');
    await expect(resolveJobOrgId(prismaWithDefault(DEFAULT_ORG), job)).resolves.toBe(DEFAULT_ORG);

    recordTenancyMode('multi');
    await expect(resolveJobOrgId(prismaWithDefault(DEFAULT_ORG), job)).rejects.toThrow(/Job job-1 \(storage\.object\.process\)/);
  });
});
