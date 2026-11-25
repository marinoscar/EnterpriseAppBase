// Moved from the reference app (apps/web/src/__tests__, issue #727): the
// app's mocked service module is now a fake identity client handed to the hook.
/**
 * `useOrgMembers`, `useOrgInvites` and `useOrganizations` (#726): each lists,
 * writes through the identity client, re-reads with the last query
 * after a write, and surfaces (and rethrows) the API's refusal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOrgInvites, useOrgMembers, useOrganizations } from '../../src/identity/headless/index.js';
import type { OrgInvite, OrgMember, Organization } from '../../src/identity/headless/index.js';
import { fakeIdentityApi } from './harness.js';


const service = fakeIdentityApi();

const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 20, totalPages: 1 });

const member: OrgMember = {
  userId: 'u-1',
  email: 'one@example.com',
  displayName: 'One',
  role: 'viewer',
  status: 'active',
  lastActiveAt: null,
  joinedAt: '2026-01-01T00:00:00Z',
};

describe('useOrgMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(service.getOrgMembers).mockResolvedValue(page([member]));
  });

  it('lists the members', async () => {
    const { result } = renderHook(() => useOrgMembers(service));
    await act(() => result.current.fetchMembers({ search: 'one' }));

    expect(service.getOrgMembers).toHaveBeenCalledWith({ search: 'one' });
    expect(result.current.members).toEqual([member]);
    expect(result.current.total).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it('updates a member, then re-reads with the last query', async () => {
    vi.mocked(service.updateOrgMember).mockResolvedValue({ ...member, role: 'contributor' });
    const { result } = renderHook(() => useOrgMembers(service));
    await act(() => result.current.fetchMembers({ search: 'one' }));

    await act(() => result.current.updateMember('u-1', { roleName: 'contributor' }));

    expect(service.updateOrgMember).toHaveBeenCalledWith('u-1', { roleName: 'contributor' });
    expect(service.getOrgMembers).toHaveBeenLastCalledWith({ search: 'one' });
  });

  it("surfaces and rethrows the API's refusal (the last-admin rule)", async () => {
    vi.mocked(service.removeOrgMember).mockRejectedValue(new Error('This would leave the organization without an active administrator.'));
    const { result } = renderHook(() => useOrgMembers(service));

    await act(async () => {
      await expect(result.current.removeMember('u-1')).rejects.toThrow('without an active administrator');
    });

    expect(result.current.error).toContain('without an active administrator');
  });

  it('keeps fetchMembers stable across renders', async () => {
    const { result, rerender } = renderHook(() => useOrgMembers(service));
    const first = result.current.fetchMembers;
    await act(() => result.current.fetchMembers({ status: 'suspended' }));
    rerender();
    expect(result.current.fetchMembers).toBe(first);
  });
});

describe('useOrgInvites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(service.getOrgInvites).mockResolvedValue(page([]));
  });

  it('invites, then re-reads; revokes, then re-reads', async () => {
    vi.mocked(service.createOrgInvite).mockResolvedValue({} as OrgInvite);
    vi.mocked(service.revokeOrgInvite).mockResolvedValue(undefined);
    const { result } = renderHook(() => useOrgInvites(service));
    await act(() => result.current.fetchInvites({ status: 'pending' }));

    await act(() => result.current.inviteMember({ email: 'new@example.com', roleName: 'viewer' }));
    await act(() => result.current.revokeInvite('i-1'));

    expect(service.createOrgInvite).toHaveBeenCalledWith({ email: 'new@example.com', roleName: 'viewer' });
    expect(service.revokeOrgInvite).toHaveBeenCalledWith('i-1');
    expect(service.getOrgInvites).toHaveBeenCalledTimes(3);
    expect(service.getOrgInvites).toHaveBeenLastCalledWith({ status: 'pending' });
  });

  it('reports a failed load and empties the list', async () => {
    vi.mocked(service.getOrgInvites).mockRejectedValue(new Error('Forbidden'));
    const { result } = renderHook(() => useOrgInvites(service));
    await act(() => result.current.fetchInvites());

    expect(result.current.error).toBe('Forbidden');
    expect(result.current.invites).toEqual([]);
  });
});

describe('useOrganizations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(service.getOrganizations).mockResolvedValue(page([]));
  });

  it('creates and renames, re-reading after each', async () => {
    vi.mocked(service.createOrganization).mockResolvedValue({} as Organization);
    vi.mocked(service.renameOrganization).mockResolvedValue({} as Organization);
    const { result } = renderHook(() => useOrganizations(service));

    await act(() => result.current.createOrg({ name: 'Beta', slug: 'beta', firstAdminEmail: 'first@example.com' }));
    await act(() => result.current.renameOrg('org-b', 'Beta Inc'));

    expect(service.createOrganization).toHaveBeenCalledWith({ name: 'Beta', slug: 'beta', firstAdminEmail: 'first@example.com' });
    expect(service.renameOrganization).toHaveBeenCalledWith('org-b', 'Beta Inc');
    expect(service.getOrganizations).toHaveBeenCalledTimes(2);
  });

  it('surfaces the single-org refusal', async () => {
    vi.mocked(service.createOrganization).mockRejectedValue(new Error('This deployment runs in single-organization mode'));
    const { result } = renderHook(() => useOrganizations(service));

    await act(async () => {
      await expect(
        result.current.createOrg({ name: 'Beta', slug: 'beta', firstAdminEmail: 'first@example.com' }),
      ).rejects.toThrow('single-organization');
    });
    expect(result.current.error).toContain('single-organization');
  });
});
