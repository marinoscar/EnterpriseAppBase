// The three packaged jobs pages without the reference app (issue #854): over a
// test platform host (the default `createJobsApi(host.api)` client), the
// fallback MUI table and spinner, the viewer's permissions and the header
// slot. The reference app's suites (apps/web/src/__tests__/pages/Admin/) cover
// the same pages through its own DataTable.

import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { PlatformHostProvider } from '../../src/core/index.js';
import { JobInsightsPage, JobsPage, WorkersPage } from '../../src/jobs/ui/index.js';
import type { JobsPageHeaderProps } from '../../src/jobs/ui/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import type { TestPlatformHost } from '../../src/testing/index.js';
import { credential, job, node } from './harness.js';

const STATS = {
  total: 2,
  byStatus: { pending: 0, running: 1, succeeded: 0, failed: 1 },
  byType: [{ type: 'image.thumbnail', label: 'Thumbnail', total: 2, byStatus: { pending: 0, running: 1, succeeded: 0, failed: 1 } }],
  scheduled: 0,
  stuckRunning: 0,
  stuckThresholdMinutes: 30,
  generatedAt: '2026-01-01T00:01:00.000Z',
};

const INSIGHTS = {
  windowDays: 7,
  generatedAt: '2026-01-08T00:00:00.000Z',
  concurrency: 4,
  live: { total: 2, byStatus: STATS.byStatus, byType: STATS.byType, scheduled: 0, rateLimited: 0, retried: 0 },
  history: {
    windowStart: '2026-01-01T00:00:00.000Z',
    throughputSince: '2026-01-07T23:00:00.000Z',
    overall: { samples: 0, avgMs: null, p50Ms: null, p95Ms: null, throughputPerMin: 0 },
    byType: [],
  },
  eta: [],
  lifetime: [],
};

function renderAt(ui: ReactElement, host: TestPlatformHost) {
  return render(
    <MemoryRouter initialEntries={['/page']}>
      <ThemeProvider theme={createTheme()}>
        <PlatformHostProvider host={host}>
          <Routes>
            <Route path="/page" element={ui} />
            <Route path="/" element={<p>home</p>} />
            <Route path="/elsewhere" element={<p>elsewhere</p>} />
            <Route path="/admin/settings/jobs/insights" element={<p>insights route</p>} />
          </Routes>
        </PlatformHostProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

function CustomHeader({ title, readOnly }: JobsPageHeaderProps) {
  return <h1>{`${title} custom${readOnly ? ' ro' : ''}`}</h1>;
}

describe('JobsPage', () => {
  const responses = {
    'GET /admin/jobs': { items: [job({ status: 'failed', lastError: 'boom' })], total: 1, page: 1, pageSize: 20, totalPages: 1 },
    'GET /admin/jobs/stats': STATS,
    'POST /admin/jobs/job-1/retry': job(),
  };

  it('lists the queue through the host transport and the fallback table', async () => {
    const host = createTestPlatformHost({ permissions: ['jobs:read', 'jobs:write'], responses });
    renderAt(<JobsPage />, host);

    expect(screen.getByRole('heading', { level: 1, name: 'Jobs' })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Jobs' });
    await waitFor(() => expect(within(table).getByText('Thumbnail')).toBeInTheDocument());
    expect(host.requests.map((request) => `${request.method} ${request.path}`)).toEqual(
      expect.arrayContaining(['GET /admin/jobs?page=1&pageSize=20', 'GET /admin/jobs/stats']),
    );
    // The filter-only columns have no header in the fallback.
    expect(within(table).queryByText('Backoff')).not.toBeInTheDocument();
  });

  it('retries a job from its row action', async () => {
    const host = createTestPlatformHost({ permissions: ['jobs:read', 'jobs:write'], responses });
    renderAt(<JobsPage />, host);

    await userEvent.click(await screen.findByRole('button', { name: 'Retry job' }));
    await waitFor(() =>
      expect(host.requests.some((request) => request.method === 'POST' && request.path === '/admin/jobs/job-1/retry')).toBe(true),
    );
  });

  it('asks before deleting, in the fallback table too', async () => {
    const host = createTestPlatformHost({
      permissions: ['jobs:read', 'jobs:write'],
      responses: { ...responses, 'DELETE /admin/jobs/job-1': undefined },
    });
    renderAt(<JobsPage />, host);

    await userEvent.click(await screen.findByRole('button', { name: 'Delete job' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete this job?')).toBeInTheDocument();
    expect(host.requests.some((request) => request.method === 'DELETE')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(host.requests.some((request) => request.method === 'DELETE')).toBe(true));
  });

  it('is read-only without jobs:write, and replaces the header through the slot', async () => {
    const host = createTestPlatformHost({ permissions: ['jobs:read'], responses });
    renderAt(<JobsPage slots={{ Header: CustomHeader }} />, host);

    expect(screen.getByRole('heading', { level: 1, name: 'Jobs custom ro' })).toBeInTheDocument();
    await screen.findByRole('table', { name: 'Jobs' });
    expect(screen.queryByRole('button', { name: 'Retry all failed' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry job' })).not.toBeInTheDocument();
  });

  it('navigates to the insights path it is given', async () => {
    const host = createTestPlatformHost({ permissions: ['jobs:read'], responses });
    renderAt(<JobsPage insightsPath="/elsewhere" />, host);

    await userEvent.click(screen.getByRole('button', { name: 'Job insights' }));
    expect(await screen.findByText('elsewhere')).toBeInTheDocument();
  });

  it('redirects a viewer without jobs:read to the fallback path', async () => {
    const host = createTestPlatformHost({ permissions: [], responses });
    renderAt(<JobsPage fallbackPath="/elsewhere" />, host);
    expect(await screen.findByText('elsewhere')).toBeInTheDocument();
  });
});

describe('JobInsightsPage', () => {
  it('renders the analytics from the host transport', async () => {
    const host = createTestPlatformHost({ permissions: ['jobs:read'], responses: { 'GET /admin/jobs/insights': INSIGHTS } });
    renderAt(<JobInsightsPage />, host);

    expect(await screen.findByRole('heading', { level: 1, name: 'Job Insights' })).toBeInTheDocument();
    expect(screen.getByText(/\(read-only\)/)).toBeInTheDocument();
    expect(host.requests[0]).toMatchObject({ method: 'GET', path: '/admin/jobs/insights?windowDays=7' });
  });

  it('redirects a viewer without jobs:read', async () => {
    const host = createTestPlatformHost({ permissions: [], responses: { 'GET /admin/jobs/insights': INSIGHTS } });
    renderAt(<JobInsightsPage />, host);
    expect(await screen.findByText('home')).toBeInTheDocument();
  });
});

describe('WorkersPage', () => {
  const responses = {
    'GET /admin/nodes': [node()],
    'GET /admin/nodes/credentials': [credential()],
  };

  it('renders the fleet and the credentials', async () => {
    const host = createTestPlatformHost({ permissions: ['nodes:read', 'nodes:write'], responses });
    renderAt(<WorkersPage />, host);

    expect(screen.getByRole('heading', { level: 1, name: 'Worker Nodes' })).toBeInTheDocument();
    const fleet = await screen.findByRole('table', { name: 'Worker nodes' });
    await waitFor(() => expect(within(fleet).getByText('worker-a')).toBeInTheDocument());
    expect(await screen.findByText('nod_1a2b…')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Delete node' })).toHaveLength(1);
  });

  it('offers no write action without nodes:write', async () => {
    const host = createTestPlatformHost({ permissions: ['nodes:read'], responses });
    renderAt(<WorkersPage />, host);

    await screen.findByRole('table', { name: 'Worker nodes' });
    expect(screen.queryByRole('button', { name: 'Delete node' })).not.toBeInTheDocument();
    expect(screen.getByText(/\(read-only\)/)).toBeInTheDocument();
  });

  it('redirects a viewer without nodes:read', async () => {
    const host = createTestPlatformHost({ permissions: ['jobs:read'], responses });
    renderAt(<WorkersPage />, host);
    expect(await screen.findByText('home')).toBeInTheDocument();
  });
});
