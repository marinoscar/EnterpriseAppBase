/**
 * The Worker Nodes page's markup did not move (PP-14.23).
 *
 * `WorkersPage` gained the page-slot contract (`PageSlotsBase`, `TableSlots`,
 * `VitalsPanel`). The snapshot beside this file (`__snapshots__/`) was RECORDED
 * FROM THE PAGE AS IT WAS BEFORE THAT CHANGE (the same fixtures, rendered by the
 * old page), so passing means the page an administrator sees with no slot passed
 * is, element for element and class for class, the one they had.
 *
 * The only normalisation is React's generated ids (`_r_1f_`). Re-record only for
 * a deliberate change of the page.
 */
import { act, render, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import { WorkersPage } from '../../src/nodes/ui/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import { credential, node } from './harness.js';
import { fullVitals } from './vitals-fixtures.js';

const NOW = new Date('2026-01-01T00:06:00.000Z');

const NODES = [
  node({ lastVitals: fullVitals, lastVitalsAt: '2026-01-01T00:05:00.000Z' }),
  node({
    id: '33333333-3333-4333-8333-333333333333',
    name: 'worker-b',
    hostname: 'build-box-02',
    health: 'stale',
    status: 'disabled',
  }),
];

const html = (root: Element): string => root.innerHTML.replace(/_r_[0-9a-z]+_/g, '_rX_');

async function mount(permissions: readonly string[]): Promise<string> {
  const host = createTestPlatformHost({
    permissions,
    responses: { 'GET /admin/nodes': NODES, 'GET /admin/nodes/credentials': [credential()] },
  });
  const { container, unmount } = render(
    <MemoryRouter initialEntries={['/page']}>
      <ThemeProvider theme={createTheme()}>
        <PlatformHostProvider host={host}>
          <WorkersPage />
        </PlatformHostProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(container.textContent).toContain('worker-b'));
  await waitFor(() => expect(container.textContent).toContain('nod_1a2b'));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  const out = html(container);
  unmount();
  return out;
}

describe("the worker nodes page's markup is unchanged", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('a full administrator', async () => {
    expect(await mount(['nodes:read', 'nodes:write'])).toMatchSnapshot();
  });

  it('a read-only viewer', async () => {
    expect(await mount(['nodes:read'])).toMatchSnapshot();
  });
});
