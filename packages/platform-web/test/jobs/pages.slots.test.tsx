// The packaged-page slot contract on the Jobs and Job Insights pages (PP-14.23):
// every slot, in the order the contract fixes; the old `Header` props still
// arrive; and `Filters` reaches the request. The markup with NO slot is pinned
// by `JobsPages.builtin-dom.test.tsx`.

import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { PlatformHostProvider } from '../../src/core/index.js';
import { JobInsightsPage, JobsPage } from '../../src/jobs/ui/index.js';
import type { JobsPageHeaderProps, JobsPageSlots } from '../../src/jobs/ui/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import type { TestPlatformHost } from '../../src/testing/index.js';
import { job } from './harness.js';

const STATS = {
  total: 1,
  byStatus: { pending: 0, running: 0, succeeded: 0, failed: 1 },
  byType: [{ type: 'image.thumbnail', label: 'Thumbnail', total: 1, byStatus: { pending: 0, running: 0, succeeded: 0, failed: 1 } }],
  scheduled: 0,
  stuckRunning: 0,
  stuckThresholdMinutes: 30,
  generatedAt: '2026-01-01T00:01:00.000Z',
};

const INSIGHTS = {
  windowDays: 7,
  generatedAt: '2026-01-08T00:00:00.000Z',
  concurrency: 4,
  live: { total: 1, byStatus: STATS.byStatus, byType: STATS.byType, scheduled: 0, rateLimited: 0, retried: 0 },
  history: {
    windowStart: '2026-01-01T00:00:00.000Z',
    throughputSince: '2026-01-07T23:00:00.000Z',
    overall: { samples: 1, avgMs: 1000, p50Ms: 1000, p95Ms: 1000, throughputPerMin: 0.1 },
    byType: [{ type: 'image.thumbnail', label: 'Thumbnail', samples: 1, avgMs: 1000, p50Ms: 1000, p95Ms: 1000, throughputPerMin: 0.1 }],
  },
  eta: [],
  lifetime: [],
};

function hostWith(permissions: string[]): TestPlatformHost {
  return createTestPlatformHost({
    permissions,
    responses: {
      'GET /admin/jobs': { items: [job({ status: 'failed', lastError: 'boom' })], total: 1, page: 1, pageSize: 20, totalPages: 1 },
      'GET /admin/jobs/stats': STATS,
      'GET /admin/jobs/insights': INSIGHTS,
    },
  });
}

function renderPage(ui: ReactElement, host: TestPlatformHost) {
  return render(
    <MemoryRouter initialEntries={['/page']}>
      <ThemeProvider theme={createTheme()}>
        <PlatformHostProvider host={host}>{ui}</PlatformHostProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

const follows = (a: Element, b: Element): boolean => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('JobsPage slots', () => {
  it('draws BeforeContent, Sections (both ends) and AfterContent in the contract order', async () => {
    const slots: JobsPageSlots = {
      BeforeContent: () => <p data-testid="before">banner</p>,
      Sections: ({ position }) => <p data-testid={`section-${position}`}>{position}</p>,
      AfterContent: () => <p data-testid="after">end</p>,
    };
    renderPage(<JobsPage slots={slots} />, hostWith(['jobs:read', 'jobs:write']));

    const table = await screen.findByRole('table', { name: 'Jobs' });
    const heading = screen.getByRole('heading', { level: 1, name: 'Jobs' });
    const order = [heading, screen.getByTestId('before'), screen.getByTestId('section-top'), table, screen.getByTestId('section-bottom'), screen.getByTestId('after')];
    for (let i = 0; i < order.length - 1; i += 1) expect(follows(order[i]!, order[i + 1]!)).toBe(true);
  });

  it('hands the Header its old props plus actions: null', async () => {
    const seen: JobsPageHeaderProps[] = [];
    const Header = (props: JobsPageHeaderProps) => {
      seen.push(props);
      return <h1>{props.title} custom</h1>;
    };
    renderPage(<JobsPage slots={{ Header }} />, hostWith(['jobs:read']));

    expect(await screen.findByRole('heading', { level: 1, name: 'Jobs custom' })).toBeInTheDocument();
    expect(seen[0]).toMatchObject({ title: 'Jobs', readOnly: true, actions: null });
    expect(typeof seen[0]?.description).toBe('string');
  });

  it('adds a column, a "More actions" cell and a Details cell, and runs Columns last', async () => {
    const slots: JobsPageSlots = {
      Columns: (base) => [...base, { id: 'owner', label: 'Owner', priority: 'secondary', render: () => 'ops-team' }],
      RowActions: ({ row }) => <button type="button">Open ticket for {row.id}</button>,
      DetailPanel: ({ row }) => <span>attempts {row.attempts}</span>,
    };
    renderPage(<JobsPage slots={slots} />, hostWith(['jobs:read', 'jobs:write']));

    const table = await screen.findByRole('table', { name: 'Jobs' });
    await waitFor(() => expect(within(table).getByText('Thumbnail')).toBeInTheDocument());
    expect(within(table).getByRole('columnheader', { name: 'Owner' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'More actions' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Details' })).toBeInTheDocument();
    expect(within(table).getByText('ops-team')).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'Open ticket for job-1' })).toBeInTheDocument();
    expect(within(table).getByText('attempts 0')).toBeInTheDocument();
    // The built-in actions are untouched.
    expect(within(table).getByRole('button', { name: 'Retry job' })).toBeInTheDocument();
  });

  it('draws Toolbar in the row of queue-wide buttons', async () => {
    renderPage(<JobsPage slots={{ Toolbar: () => <button type="button">Export to BI</button> }} />, hostWith(['jobs:read', 'jobs:write']));

    const toolbar = await screen.findByRole('button', { name: 'Export to BI' });
    expect(follows(screen.getByRole('button', { name: 'Reset stuck' }), toolbar)).toBe(true);
    expect(follows(toolbar, screen.getByRole('button', { name: 'Job insights' }))).toBe(true);
  });

  it('sends the extra filters a Filters slot sets, and the export replays them', async () => {
    const ORG = '0b0f0c2e-6a4e-4a0e-9d7b-0c2f2f3f4a5b';
    const host = hostWith(['jobs:read']);
    function Filters({ value, onChange }: { value: { orgId?: string }; onChange: (next: { orgId?: string }) => void }) {
      return (
        <button type="button" onClick={() => onChange({ orgId: ORG })}>
          {value.orgId ? 'org selected' : 'pick org'}
        </button>
      );
    }
    renderPage(<JobsPage slots={{ Filters }} />, host);

    await userEvent.click(await screen.findByRole('button', { name: 'pick org' }));

    expect(await screen.findByRole('button', { name: 'org selected' })).toBeInTheDocument();
    await waitFor(() => expect(host.requests.some((request) => request.path.includes(`orgId=${ORG}`))).toBe(true));
    // Back to the first page whenever the filter changes.
    expect(host.requests.filter((request) => request.path.includes(`orgId=${ORG}`)).every((request) => request.path.includes('page=1'))).toBe(true);
  });

  it('keeps a viewer without jobs:read out whatever the slots', async () => {
    renderPage(<JobsPage slots={{ BeforeContent: () => <p>leak</p> }} />, hostWith([]));
    await waitFor(() => expect(screen.queryByText('leak')).not.toBeInTheDocument());
  });
});

describe('JobInsightsPage slots', () => {
  it('draws the base slots around the analytics', async () => {
    renderPage(
      <JobInsightsPage
        slots={{
          BeforeContent: () => <p data-testid="before">banner</p>,
          Sections: ({ position }) => <p data-testid={`section-${position}`}>{position}</p>,
          AfterContent: () => <p data-testid="after">end</p>,
        }}
      />,
      hostWith(['jobs:read']),
    );

    const types = await screen.findByRole('table', { name: 'Job types' });
    const order = [screen.getByRole('heading', { level: 1 }), screen.getByTestId('before'), screen.getByTestId('section-top'), types, screen.getByTestId('section-bottom'), screen.getByTestId('after')];
    for (let i = 0; i < order.length - 1; i += 1) expect(follows(order[i]!, order[i + 1]!)).toBe(true);
  });

  it('adds columns and per-row cells to the per-type table', async () => {
    renderPage(
      <JobInsightsPage
        slots={{
          Columns: (base) => [...base, { id: 'cost', label: 'Cost', priority: 'secondary', render: (row) => `$${row.samples}` }],
          RowActions: ({ row }) => <button type="button">Tune {row.type}</button>,
          Toolbar: () => <button type="button">Download report</button>,
        }}
      />,
      hostWith(['jobs:read']),
    );

    const types = await screen.findByRole('table', { name: 'Job types' });
    expect(within(types).getByRole('columnheader', { name: 'Cost' })).toBeInTheDocument();
    expect(within(types).getByRole('button', { name: 'Tune image.thumbnail' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download report' })).toBeInTheDocument();
  });

  it('lets a Filters slot pick another window', async () => {
    const host = hostWith(['jobs:read']);
    renderPage(
      <JobInsightsPage
        slots={{
          Filters: ({ windowDays, onWindowDaysChange }) => (
            <button type="button" onClick={() => onWindowDaysChange(30)}>
              window {windowDays}
            </button>
          ),
        }}
      />,
      host,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'window 7' }));
    await waitFor(() => expect(host.requests.some((request) => request.path.includes('windowDays=30'))).toBe(true));
  });
});
