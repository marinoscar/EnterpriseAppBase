/**
 * PP-14.18: a metric group an app registered renders with its own unit and
 * presentation, with no web code of the platform changed.
 *
 * The reference app's API declares the `activity` group
 * (apps/api/src/platform-extensions/telemetry/activity.metric-group.ts) with a
 * `usd` unit, tiles in an order and colour, a Top 5 table and a computed ratio
 * column. `GET dashboard/metric-groups` serves that presentation and the unit's
 * descriptor; the packaged dashboard draws it. Only the network is mocked (MSW),
 * with the response shapes the API produces.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import TelemetryDashboardPage from '@marinoscar/platform-web/telemetry/ui/dashboard-page';
import { render, mockAdminUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import { dashboardHandlers, mockDashboardMetricGroups, mockDashboardMetrics } from '../../mocks/fixtures/telemetryDashboard';

const API = '*/api/admin/telemetry/dashboard';
const DASHBOARD = '/admin/settings/telemetry/dashboard';

const USD = { id: 'usd', label: 'US dollars', format: 'currency', currency: 'USD', decimals: 2 } as const;

/** What `/metric-groups` serves for the group: the declared presentation and the app unit. */
const ACTIVITY_GROUP = {
  id: 'activity',
  label: 'App activity',
  title: 'App activity',
  order: 70,
  units: [USD],
  presentation: {
    tiles: [{ metric: 'aiSpend', label: 'AI spend', color: 'info' }, { metric: 'authLogins' }],
    series: [],
    tables: [{ metric: 'notificationEvents', topN: 5, sort: 'value-desc' }],
    virtualColumns: [
      { id: 'failureRate', label: 'Failure rate', expression: 'ratio', of: ['failed', 'attempts'], table: 'notificationEvents' },
    ],
  },
};

const seen = '2026-09-27T10:59:30.000Z';

const EVENTS = Array.from({ length: 8 }, (_, index) => ({
  key: `event-${index + 1}`,
  attempts: 10 * (index + 1),
  failed: index,
  lastSeenAt: seen,
}));

const ACTIVITY_METRICS = {
  ...mockDashboardMetrics.queue,
  group: 'activity',
  available: true,
  tiles: [
    { key: 'authLogins', label: 'Sign-ins', value: 42, previous: 40, unit: 'count', sparkline: [1, 2, 3] },
    { key: 'aiSpend', label: 'AI spend (raw label)', value: 1234.5, previous: 1000, unit: 'usd', sparkline: [1, 2, 3] },
    { key: 'hidden', label: 'Not in the presentation', value: 1, previous: 1, unit: 'count', sparkline: [] },
  ],
  series: [],
  tables: [
    {
      key: 'notificationEvents',
      label: 'Notification events',
      columns: [
        { key: 'key', label: 'Event', unit: 'text' },
        { key: 'attempts', label: 'Attempts', unit: 'count' },
        { key: 'failed', label: 'Failed', unit: 'count' },
        { key: 'lastSeenAt', label: 'Last reading', unit: 'timestamp' },
      ],
      rows: EVENTS,
    },
  ],
  skipped: [],
};

function serve() {
  // The first matching handler wins: the group's routes go before the dashboard defaults.
  server.use(
    http.get(`${API}/metric-groups`, () => HttpResponse.json({ data: [...mockDashboardMetricGroups, ACTIVITY_GROUP] })),
    http.get(`${API}/metrics`, ({ request }) => {
      const group = new URL(request.url).searchParams.get('group');
      return group === 'activity'
        ? HttpResponse.json({ data: ACTIVITY_METRICS })
        : HttpResponse.json({ data: mockDashboardMetrics[group as keyof typeof mockDashboardMetrics] ?? mockDashboardMetrics.host });
    }),
    ...dashboardHandlers(),
  );
}

function renderPage() {
  return render(
    <Routes>
      <Route path={DASHBOARD} element={<TelemetryDashboardPage />} />
    </Routes>,
    { wrapperOptions: { user: mockAdminUser, telemetryEnabled: true, aiEnabled: false, route: DASHBOARD } },
  );
}

describe('the reference app activity group on the dashboard (PP-14.18)', () => {
  beforeEach(() => {
    server.resetHandlers();
    window.localStorage.clear();
    serve();
  });

  it('draws the tiles it names, in its order, the spend in the app unit', async () => {
    renderPage();
    const tiles = await screen.findByTestId('metric-tiles-activity', undefined, { timeout: 8_000 });

    const headings = within(tiles)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual(['AI spend', 'Sign-ins']);
    expect(within(tiles).getByTestId('tile-aiSpend')).toHaveTextContent('$1,234.50');
    expect(within(tiles).queryByTestId('tile-hidden')).not.toBeInTheDocument();
  });

  it('draws the Top 5 table with the computed failure rate, and offers All', async () => {
    const user = userEvent.setup();
    renderPage();
    const table = await screen.findByRole('table', { name: 'Notification events' }, { timeout: 8_000 });

    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Event', 'Attempts', 'Failed', 'Last reading', 'Failure rate']);
    // Largest first (value-desc): event-8 leads; five rows and the header.
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(1 + 5);
    expect(rows[1]).toHaveTextContent('event-8');
    expect(rows[1]).toHaveTextContent('8.75%');

    await user.click(within(screen.getByTestId('metric-table-topn-notificationEvents')).getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'All' }));
    expect(within(screen.getByRole('table', { name: 'Notification events' })).getAllByRole('row')).toHaveLength(1 + 8);
  });
});
