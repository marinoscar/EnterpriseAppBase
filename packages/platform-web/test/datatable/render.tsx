// The DataTable suites' render helper: Testing Library's `render` inside a
// platform host whose transport is `testApi`, a plain object whose methods
// resolve to nothing. A suite that cares about the preference routes spies on
// `testApi.get` / `testApi.patch`.
import { render as rtlRender } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import { PlatformHostProvider } from '../../src/core/index.js';
import type { PlatformApiClient } from '../../src/core/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';

/** The transport every rendered table talks to. */
export const testApi = {
  get: async () => undefined,
  post: async () => undefined,
  put: async () => undefined,
  patch: async () => undefined,
  delete: async () => undefined,
} as unknown as PlatformApiClient;

const host = { ...createTestPlatformHost(), api: testApi };

function Wrapper({ children }: { children: ReactNode }): ReactElement {
  return <PlatformHostProvider host={host}>{children}</PlatformHostProvider>;
}

/** `render` under the test host. */
export function render(ui: ReactElement): RenderResult {
  return rtlRender(ui, { wrapper: Wrapper });
}
