// Render helpers for the sharing slice's tests (issue #731).

import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { PlatformHostProvider } from '../../src/core/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import type { TestApiResponse, TestPlatformHost } from '../../src/testing/index.js';
import { ME } from './fixtures.js';

export function makeHost(
  responses: Record<string, TestApiResponse>,
  permissions: readonly string[] = ['groups:read', 'groups:write', 'sharing:read', 'sharing:write'],
): TestPlatformHost {
  return createTestPlatformHost({ permissions, userId: ME, responses });
}

export let currentPath = '';
function PathProbe() {
  currentPath = useLocation().pathname;
  return null;
}

/** Renders `element` at `path` (matched by `pattern`) inside a host and a router that records where it navigates. */
export function renderRoute(host: TestPlatformHost, element: ReactElement, path = '/', pattern = '*') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PlatformHostProvider host={host}>
        <PathProbe />
        <Routes>
          <Route path={pattern} element={element} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
      </PlatformHostProvider>
    </MemoryRouter>,
  );
}
