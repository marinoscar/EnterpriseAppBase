/**
 * `useRoles` (PP-14.15): reads `GET /api/roles` once per scope and splits the
 * assignable roles from the rest; a failed read leaves nothing to offer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useRoles } from '../../src/identity/headless/index.js';
import { BUILTIN_ROLES, answerWithBuiltinRoles, fakeIdentityApi } from './harness.js';

const service = fakeIdentityApi();

describe('useRoles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    answerWithBuiltinRoles(service);
  });

  it('reads the roles of its scope and offers the assignable ones', async () => {
    vi.mocked(service.getRoles).mockResolvedValue([
      ...BUILTIN_ROLES.filter((role) => role.scope === 'org'),
      { id: 'robot', label: 'Robot', description: 'Managed by the app', scope: 'org', assignable: false },
    ]);
    const { result } = renderHook(() => useRoles('org', { api: service }));

    await waitFor(() => expect(result.current.roles).toHaveLength(4));

    expect(service.getRoles).toHaveBeenCalledTimes(1);
    expect(service.getRoles).toHaveBeenCalledWith('org');
    expect(result.current.assignable.map((role) => role.id)).toEqual(['contributor', 'viewer', 'org_admin']);
    expect(result.current.labelOf('org_admin')).toBe('Administrator');
    expect(result.current.labelOf('robot')).toBe('Robot');
    expect(result.current.labelOf('removed-role')).toBe('removed-role');
    expect(result.current.error).toBeNull();
  });

  it('reads nothing while disabled', () => {
    const { result } = renderHook(() => useRoles('org', { api: service, enabled: false }));

    expect(service.getRoles).not.toHaveBeenCalled();
    expect(result.current.roles).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('offers nothing it has not been vouched for when the read fails', async () => {
    vi.mocked(service.getRoles).mockRejectedValue(new Error('Forbidden'));
    const { result } = renderHook(() => useRoles('system', { api: service }));

    await waitFor(() => expect(result.current.error).toBe('Forbidden'));

    expect(result.current.roles).toEqual([]);
    expect(result.current.assignable).toEqual([]);
  });

  it('reads again when the scope changes', async () => {
    vi.mocked(service.getRoles).mockImplementation(async (scope) => BUILTIN_ROLES.filter((role) => role.scope === scope));
    const { result, rerender } = renderHook(({ scope }: { scope: 'system' | 'org' }) => useRoles(scope, { api: service }), {
      initialProps: { scope: 'system' as 'system' | 'org' },
    });
    await waitFor(() => expect(result.current.roles.map((role) => role.id)).toEqual(['admin']));

    rerender({ scope: 'org' });

    await waitFor(() => expect(result.current.roles.map((role) => role.id)).toEqual(['contributor', 'viewer', 'org_admin']));
  });
});
