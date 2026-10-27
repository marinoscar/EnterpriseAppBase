// Test harness of the email slice's page tests (PP-14.8): the page inside a
// memory router and a test platform host whose viewer holds the given
// permissions and an address. `useEmailSettings` is mocked per test.

import { render as rtlRender } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';
import { vi } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import type { PlatformWebHost } from '../../src/core/index.js';
import type { UseEmailSettingsReturn } from '../../src/email/headless/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';

export const WRITE_PERMISSIONS = ['system_settings:read', 'system_settings:write'] as const;
export const READ_ONLY_PERMISSIONS = ['system_settings:read'] as const;

/** `render` inside a memory router and a test platform host (viewer: `admin@example.test`). */
export function render(ui: ReactElement, permissions: readonly string[] = WRITE_PERMISSIONS): RenderResult {
  const base = createTestPlatformHost({ permissions });
  const host: PlatformWebHost = { ...base, viewer: { ...base.viewer, email: 'admin@example.test' } };
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <MemoryRouter initialEntries={['/']}>
        <PlatformHostProvider host={host}>{children}</PlatformHostProvider>
      </MemoryRouter>
    );
  }
  return rtlRender(ui, { wrapper: Wrapper });
}

/** What `useEmailSettings` returns, with every action a spy. */
export function hookReturn(overrides: Partial<UseEmailSettingsReturn> = {}): UseEmailSettingsReturn {
  return {
    settings: null,
    isLoading: false,
    loadError: null,
    isSaving: false,
    saveError: null,
    isTesting: false,
    testResult: null,
    save: vi.fn().mockResolvedValue(true),
    sendTest: vi.fn().mockResolvedValue(undefined),
    clearTestResult: vi.fn(),
    clearSaveError: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  };
}
