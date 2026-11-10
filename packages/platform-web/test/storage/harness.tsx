// Test harness of the storage slice's page tests (PP-14.7, #925): the page
// inside a memory router and a test platform host whose viewer holds the given
// permissions. `useStorageConfig` is mocked per test (see the page suites).

import { render as rtlRender } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import { PlatformHostProvider } from '../../src/core/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';

export const WRITE_PERMISSIONS = ['storage_config:read', 'storage_config:write'] as const;
export const READ_ONLY_PERMISSIONS = ['storage_config:read'] as const;

/** `render` inside a memory router and a test platform host. */
export function render(ui: ReactElement, permissions: readonly string[] = WRITE_PERMISSIONS): RenderResult {
  const host = createTestPlatformHost({ permissions });
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <MemoryRouter initialEntries={['/']}>
        <PlatformHostProvider host={host}>{children}</PlatformHostProvider>
      </MemoryRouter>
    );
  }
  return rtlRender(ui, { wrapper: Wrapper });
}
