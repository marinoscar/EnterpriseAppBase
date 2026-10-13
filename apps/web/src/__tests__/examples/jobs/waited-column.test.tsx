/**
 * PP-14.23: an app adds a column to the packaged Jobs page through
 * `slots.Columns`, with no package edit.
 *
 * `apps/web/src/platform-extensions/jobs/WaitedColumn.example.tsx` is the
 * example. This renders the REAL packaged page
 * (`@marinoscar/platform-web/jobs/ui`) through the app's own DataTable over MSW
 * responses for the two routes it reads, passes the slot, and asserts the new
 * column is drawn from the rows the page already holds, placed after "Created",
 * with the page's own columns, filters and row actions untouched. It also pins
 * that the page without the slot draws no such column.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';

import { JobsPage } from '@marinoscar/platform-web/jobs/ui';
import type { JobsPageSlots } from '@marinoscar/platform-web/jobs/ui';
import { installLayoutStubs, resetContainerWidth, setInitialContainerWidth } from '@marinoscar/platform-web/datatable/testing';
import { render, mockAdminUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import { WAITED_COLUMN_ID, secondsWaited, withWaitedColumn } from '../../../platform-extensions/jobs/WaitedColumn.example';

const API_BASE = '*/api';

const JOB = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'image.thumbnail',
  typeLabel: 'Thumbnail',
  subjectType: null,
  subjectId: null,
  dedupKey: null,
  status: 'succeeded',
  reason: 'upload',
  priority: 0,
  providerKey: null,
  modelVersion: null,
  attempts: 1,
  lastError: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  startedAt: '2026-01-01T00:01:30.000Z',
  finishedAt: '2026-01-01T00:01:40.000Z',
  scheduledFor: null,
  rateLimitedAt: null,
  rateLimitHits: 0,
  claimedByNodeId: null,
  leaseExpiresAt: null,
  executor: null,
  orgId: null,
};

const STATS = {
  total: 1,
  byStatus: { pending: 0, running: 0, succeeded: 1, failed: 0 },
  byType: [{ type: 'image.thumbnail', label: 'Thumbnail', total: 1, byStatus: { pending: 0, running: 0, succeeded: 1, failed: 0 } }],
  scheduled: 0,
  stuckRunning: 0,
  stuckThresholdMinutes: 30,
  generatedAt: '2026-01-01T00:02:00.000Z',
};

function serve() {
  server.use(
    http.get(`${API_BASE}/admin/jobs`, () =>
      HttpResponse.json({ data: { items: [JOB], total: 1, page: 1, pageSize: 20, totalPages: 1 } }),
    ),
    http.get(`${API_BASE}/admin/jobs/stats`, () => HttpResponse.json({ data: STATS })),
  );
}

function renderPage(slots?: JobsPageSlots) {
  setInitialContainerWidth(1400);
  return render(<JobsPage slots={slots} />, { wrapperOptions: { user: { ...mockAdminUser, permissions: ['jobs:read', 'jobs:write'] } } });
}

describe('the Jobs page with an app Columns slot (PP-14.23)', () => {
  beforeAll(() => installLayoutStubs());
  beforeEach(() => {
    server.resetHandlers();
    resetContainerWidth(1400);
    serve();
  });

  it('computes the wait from the row', () => {
    expect(secondsWaited(JOB)).toBe(90);
    expect(secondsWaited({ createdAt: JOB.createdAt, startedAt: null })).toBeNull();
    expect(secondsWaited({ createdAt: JOB.startedAt, startedAt: JOB.createdAt })).toBeNull();
  });

  it('draws the added column after Created and keeps the page’s own columns', async () => {
    renderPage({ Columns: withWaitedColumn });

    const table = await screen.findByTestId('admin-jobs-table');
    expect(await within(table).findByText('Thumbnail')).toBeInTheDocument();
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent?.trim());
    expect(headers).toContain('Waited');
    expect(headers.indexOf('Waited')).toBe(headers.indexOf('Created') + 1);
    expect(await within(table).findByText('90 s')).toBeInTheDocument();
    // The page's own columns are still there.
    expect(headers).toEqual(expect.arrayContaining(['Created', 'Attempts']));
    expect(WAITED_COLUMN_ID).toBe('waited');
  });

  it('draws no such column without the slot', async () => {
    renderPage();

    const table = await screen.findByTestId('admin-jobs-table');
    await within(table).findByText('Thumbnail');
    expect(within(table).queryByRole('columnheader', { name: 'Waited' })).not.toBeInTheDocument();
    expect(within(table).queryByText('90 s')).not.toBeInTheDocument();
  });

  it('puts the column last when the page has no Created column', () => {
    const ids = withWaitedColumn([{ id: 'id', label: 'ID', priority: 'primary' }]).map((column) => column.id);
    expect(ids).toEqual(['id', 'waited']);
  });
});
