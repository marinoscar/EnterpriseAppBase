/**
 * PP-14.23: an app adds a per-row action to the packaged Worker Nodes page
 * through `slots.RowActions`, with no package edit.
 *
 * `apps/web/src/platform-extensions/nodes/CopyHostnameAction.example.tsx` is the
 * example. This renders the REAL packaged page
 * (`@marinoscar/platform-web/nodes/ui`) through the app's own DataTable over MSW
 * responses for the two routes it reads, passes the slot, and asserts the action
 * is drawn for each node from the row the page holds, in an extra "More actions"
 * column, and works. It also pins that the page without the slot draws no such
 * action.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { WorkersPage } from '@marinoscar/platform-web/nodes/ui';
import { installLayoutStubs, resetContainerWidth, setInitialContainerWidth } from '@marinoscar/platform-web/datatable/testing';
import { render, mockAdminUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import { CopyHostnameAction } from '../../../platform-extensions/nodes/CopyHostnameAction.example';

const API_BASE = '*/api';

const NODE = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'worker-a',
  hostname: 'build-box-01',
  platform: 'linux-x64',
  cliVersion: '1.4.0',
  eligibleTypes: ['image.thumbnail'],
  concurrency: 4,
  status: 'online',
  health: 'healthy',
  capabilities: null,
  registeredAt: '2026-01-01T00:00:00.000Z',
  lastHeartbeatAt: new Date().toISOString(),
  owner: { id: 'u1', email: 'ops@example.com', name: 'Ops' },
  jobCounts: { running: 1, pending: 2, succeeded: 30, failed: 3, total: 36 },
  lastVitals: null,
  lastVitalsAt: null,
};

function renderPage(withSlot: boolean) {
  setInitialContainerWidth(1400);
  return render(<WorkersPage slots={withSlot ? { RowActions: CopyHostnameAction } : undefined} />, {
    wrapperOptions: { user: { ...mockAdminUser, permissions: ['nodes:read', 'nodes:write'] } },
  });
}

describe('the Worker Nodes page with an app RowActions slot (PP-14.23)', () => {
  beforeAll(() => installLayoutStubs());
  beforeEach(() => {
    server.resetHandlers();
    resetContainerWidth(1400);
    server.use(
      http.get(`${API_BASE}/admin/nodes`, () => HttpResponse.json({ data: [NODE] })),
      http.get(`${API_BASE}/admin/nodes/credentials`, () => HttpResponse.json({ data: [] })),
    );
  });

  it('draws the action for each node in a "More actions" column and copies the hostname', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderPage(true);

    const table = await screen.findByTestId('admin-worker-nodes-table');
    expect(await within(table).findByText('worker-a')).toBeInTheDocument();
    await userEvent.click(await within(table).findByRole('button', { name: 'Copy host of worker-a' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('build-box-01'));
    expect(await within(table).findByRole('button', { name: 'Copy host of worker-a' })).toHaveTextContent('Copied');
    expect(within(table).getByRole('columnheader', { name: 'More actions' })).toBeInTheDocument();
  });

  it('draws no such action without the slot', async () => {
    renderPage(false);

    const table = await screen.findByTestId('admin-worker-nodes-table');
    await within(table).findByText('worker-a');
    expect(within(table).queryByRole('button', { name: /Copy host/ })).not.toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'More actions' })).not.toBeInTheDocument();
  });
});
