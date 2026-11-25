// `usePermissions` resolution order (issue #997, local host mode): the
// AuthContext first, then the PlatformHost viewer, else an error naming both.

import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import { AuthContext, usePermissions } from '../../src/identity/headless/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import { USER, authValue } from './harness.js';

describe('usePermissions: fallback order', () => {
  it('reads the AuthContext user when one is mounted', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthContext.Provider value={authValue({ user: { ...USER, permissions: ['a:read'], roles: [{ name: 'admin' }] } })}>
        {children}
      </AuthContext.Provider>
    );
    const { result } = renderHook(() => usePermissions(), { wrapper });
    expect(result.current.hasPermission('a:read')).toBe(true);
    expect(result.current.hasPermission('b:read')).toBe(false);
    expect(result.current.isAdmin).toBe(true);
  });

  it('prefers the AuthContext over the PlatformHost viewer when both are mounted', () => {
    const host = createTestPlatformHost({ permissions: ['host:only'] });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthContext.Provider value={authValue({ user: { ...USER, permissions: ['auth:only'] } })}>
        <PlatformHostProvider host={host}>{children}</PlatformHostProvider>
      </AuthContext.Provider>
    );
    const { result } = renderHook(() => usePermissions(), { wrapper });
    expect(result.current.hasPermission('auth:only')).toBe(true);
    expect(result.current.hasPermission('host:only')).toBe(false);
  });

  it('falls back to the PlatformHost viewer without an AuthContext', () => {
    const host = createTestPlatformHost({ permissions: ['reports:read', 'notes:read'] });
    const wrapper = ({ children }: { children: ReactNode }) => <PlatformHostProvider host={host}>{children}</PlatformHostProvider>;
    const { result } = renderHook(() => usePermissions(), { wrapper });
    expect(result.current.hasPermission('reports:read')).toBe(true);
    expect(result.current.hasPermission('admin:read')).toBe(false);
    expect(result.current.hasAnyPermission('admin:read', 'notes:read')).toBe(true);
    expect(result.current.hasAllPermissions('reports:read', 'notes:read')).toBe(true);
    expect(result.current.hasAllPermissions('reports:read', 'admin:read')).toBe(false);
  });

  it('throws an error naming both the AuthProvider and the PlatformHostProvider when neither is mounted', () => {
    const quiet = console.error;
    console.error = () => undefined;
    try {
      const { result } = renderHook(() => {
        try {
          return usePermissions();
        } catch (error) {
          return error as Error;
        }
      });
      expect(result.current).toBeInstanceOf(Error);
      const message = (result.current as Error).message;
      expect(message).toMatch(/AuthProvider/);
      expect(message).toMatch(/PlatformHostProvider/);
    } finally {
      console.error = quiet;
    }
  });
});
