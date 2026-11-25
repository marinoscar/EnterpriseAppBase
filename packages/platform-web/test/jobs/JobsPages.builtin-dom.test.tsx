/**
 * The Jobs and Job Insights pages' markup did not move (PP-14.23).
 *
 * Both pages gained the page-slot contract (`PageSlotsBase`, `TableSlots`,
 * `Filters`). The snapshot beside this file (`__snapshots__/`) was RECORDED
 * FROM THE PAGES AS THEY WERE BEFORE THAT CHANGE (the same fixtures, rendered by
 * the old pages), so passing means the page an administrator sees with no slot
 * passed is, element for element and class for class, the one they had.
 *
 * The only normalisation is React's generated ids (`_r_1f_`), which depend on
 * render order. Re-record only for a deliberate change of the page.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

import { PlatformHostProvider } from '../../src/core/index.js';
import { JobInsightsPage, JobsPage } from '../../src/jobs/ui/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import { job } from './harness.js';

const NOW = new Date('2026-03-02T12:00:00.000Z');

const BY_STATUS = { pending: 1, running: 1, succeeded: 5, failed: 2 };
const BY_TYPE = [
  { type: 'image.thumbnail', label: 'Thumbnail', total: 9, byStatus: BY_STATUS },
  { type: 'report.build', label: 'Report', total: 3, byStatus: { pending: 0, running: 0, succeeded: 3, failed: 0 } },
];

const STATS = {
  total: 9,
  byStatus: BY_STATUS,
  byType: BY_TYPE,
  scheduled: 1,
  stuckRunning: 1,
  stuckThresholdMinutes: 30,
  generatedAt: '2026-03-02T11:59:00.000Z',
};

const JOBS = [
  job({ id: 'job-1', status: 'failed', lastError: 'boom', attempts: 3 }),
  job({ id: 'job-2', status: 'running', startedAt: '2026-03-02T11:58:00.000Z', claimedByNodeId: null }),
  job({ id: 'job-3', status: 'succeeded', type: 'report.build', typeLabel: 'Report', finishedAt: '2026-03-02T11:00:00.000Z' }),
];

const INSIGHTS = {
  windowDays: 7,
  generatedAt: '2026-03-02T11:59:00.000Z',
  concurrency: 4,
  live: { total: 9, byStatus: BY_STATUS, byType: BY_TYPE, scheduled: 1, rateLimited: 1, retried: 2 },
  history: {
    windowStart: '2026-02-23T12:00:00.000Z',
    throughputSince: '2026-03-02T11:00:00.000Z',
    overall: { samples: 8, avgMs: 1500, p50Ms: 1200, p95Ms: 4000, throughputPerMin: 0.2 },
    byType: [
      { type: 'image.thumbnail', label: 'Thumbnail', samples: 5, avgMs: 1000, p50Ms: 900, p95Ms: 3000, throughputPerMin: 0.1 },
    ],
  },
  eta: [
    { type: 'image.thumbnail', label: 'Thumbnail', pending: 1, running: 1, remaining: 2, avgMs: 1000, estimatedMs: 500, basis: 'live' },
    { type: 'report.build', label: 'Report', pending: 0, running: 0, remaining: 0, avgMs: null, estimatedMs: null, basis: 'none' },
  ],
  lifetime: [
    { type: 'image.thumbnail', label: 'Thumbnail', succeeded: 50, failed: 5, total: 55, avgMs: 1100, durationSamples: 50 },
  ],
};

const html = (root: Element): string => root.innerHTML.replace(/_r_[0-9a-z]+_/g, '_rX_');

async function mount(
  page: ReactElement,
  permissions: readonly string[],
  ready: string,
): Promise<string> {
  const host = createTestPlatformHost({
    permissions,
    responses: {
      'GET /admin/jobs': { items: JOBS, total: JOBS.length, page: 1, pageSize: 20, totalPages: 1 },
      'GET /admin/jobs/stats': STATS,
      'GET /admin/jobs/insights': INSIGHTS,
    },
  });
  const { container, unmount } = render(
    <MemoryRouter initialEntries={['/page']}>
      <ThemeProvider theme={createTheme()}>
        <PlatformHostProvider host={host}>{page}</PlatformHostProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
  await screen.findByText(ready);
  await waitFor(() => expect(container.textContent).toContain('Thumbnail'));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  const out = html(container);
  unmount();
  return out;
}

describe("the jobs pages' markup is unchanged", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('the Jobs page, a full administrator', async () => {
    expect(await mount(<JobsPage />, ['jobs:read', 'jobs:write'], 'Job insights')).toMatchSnapshot();
  });

  it('the Jobs page, a read-only viewer', async () => {
    expect(await mount(<JobsPage />, ['jobs:read'], 'Job insights')).toMatchSnapshot();
  });

  it('the Job Insights page, a full administrator', async () => {
    expect(await mount(<JobInsightsPage />, ['jobs:read', 'jobs:write'], 'By job type')).toMatchSnapshot();
  });

  it('the Job Insights page, a read-only viewer', async () => {
    expect(await mount(<JobInsightsPage />, ['jobs:read'], 'By job type')).toMatchSnapshot();
  });
});
