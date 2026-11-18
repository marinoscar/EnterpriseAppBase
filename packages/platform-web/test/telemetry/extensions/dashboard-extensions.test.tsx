/**
 * An app's metric group and dashboard panel, rendered by the packaged dashboard
 * with no web code of the platform changed (PP-14.18): a group's served
 * presentation (a coloured tile in the app's own `usd` unit, a Top 5 table with a
 * computed ratio column), and a panel the API lists whose view the app registered.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import {
  MetricUnitFormatsContext,
  metricUnitFormatsOf,
} from '../../../src/telemetry/headless/index.js';
import type {
  DashboardMetricGroupMeta,
  DashboardMetrics,
} from '../../../src/telemetry/headless/index.js';
import TelemetryDashboardPage from '../../../src/telemetry/ui/pages/TelemetryDashboardPage.js';
import { MetricSection } from '../../../src/telemetry/ui/components/dashboard/metrics/MetricSections.js';
import { registerPlatformDashboardPanelViews } from '../../../src/telemetry/ui/components/dashboard/panels/builtinPanelViews.js';
import {
  registerDashboardPanelView,
  resetDashboardPanelViewsForTests,
  type DashboardPanelViewProps,
} from '../../../src/telemetry/ui/components/dashboard/panels/dashboardPanelViews.js';
import { createTestApiError } from '../../../src/testing/index.js';
import type { TestApiRequest } from '../../../src/testing/index.js';
import { render } from '../harness.js';
import {
  dashboardResponses,
  mockDashboardMetricGroups,
  mockDashboardMetrics,
} from '../fixtures/telemetryDashboard.js';

const NOW = Date.parse('2026-09-27T11:00:00.000Z');
const ROUTE = '/admin/settings/telemetry/dashboard';

const USD = {
  id: 'usd',
  label: 'US dollars',
  format: 'currency',
  currency: 'USD',
  decimals: 2,
} as const;

const ACTIVITY_GROUP: DashboardMetricGroupMeta = {
  id: 'activity',
  label: 'App activity',
  title: 'App activity',
  order: 70,
  units: [USD],
  presentation: {
    tiles: [
      { metric: 'aiSpend', label: 'AI spend', color: 'warn' },
      { metric: 'signIns', color: 'crit' },
    ],
    series: [],
    tables: [{ metric: 'features', topN: 5 }],
    virtualColumns: [
      {
        id: 'failRate',
        label: 'Failure rate',
        expression: 'ratio',
        of: ['failed', 'total'],
        table: 'features',
      },
    ],
  },
};

function tile(key: string, label: string, value: number, unit: string) {
  return { key, label, value, previous: value, unit, sparkline: [1, 2] };
}

const FEATURES = Array.from({ length: 8 }, (_, i) => ({
  key: `feature-${i + 1}`,
  failed: i,
  total: 100,
  lastSeenAt: '2026-09-27T10:59:30.000Z',
}));

const ACTIVITY_DATA: DashboardMetrics = {
  ...mockDashboardMetrics.queue,
  group: 'activity',
  tiles: [
    tile('aiSpend', 'AI spend (raw)', 1234.5, 'usd'),
    tile('signIns', 'Sign-ins', 42, 'count'),
    tile('hidden', 'Not in the presentation', 1, 'count'),
  ],
  series: [],
  tables: [
    {
      key: 'features',
      label: 'Features',
      columns: [
        { key: 'key', label: 'Feature', unit: 'text' },
        { key: 'failed', label: 'Failed', unit: 'count' },
        { key: 'total', label: 'Total', unit: 'count' },
        { key: 'lastSeenAt', label: 'Last reading', unit: 'timestamp' },
      ],
      rows: FEATURES,
    },
  ],
  skipped: [],
};

const resource = {
  data: ACTIVITY_DATA,
  error: null,
  isLoading: false,
  isRefreshing: false,
  fetchedAt: NOW,
  reload: () => undefined,
};

beforeEach(() => {
  window.localStorage.clear();
});

describe("a metric group's served presentation", () => {
  function renderActivity() {
    return render(
      <MetricUnitFormatsContext.Provider value={metricUnitFormatsOf([ACTIVITY_GROUP])}>
        <MetricSection
          group="activity"
          title="App activity"
          resource={resource}
          layout="desktop"
          spanMs={3_600_000}
          now={NOW}
          actions={[]}
          presentation={ACTIVITY_GROUP.presentation}
        />
      </MetricUnitFormatsContext.Provider>
    );
  }

  it('draws only the tiles it names, in its order, with its label and a theme colour', () => {
    renderActivity();
    const tiles = screen.getByTestId('metric-tiles-activity');
    expect(
      within(tiles)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent)
    ).toEqual(['AI spend', 'Sign-ins']);
    expect(within(tiles).queryByTestId('tile-hidden')).not.toBeInTheDocument();
    // The value is in the app's own unit, formatted from the descriptor the API served.
    expect(within(tiles).getByTestId('tile-aiSpend')).toHaveTextContent(/\$1,234\.50/);
    // The colour is a theme token resolved by the web, not a colour the presentation carried.
    const value = within(within(tiles).getByTestId('tile-aiSpend')).getByText(/\$1,234\.50/);
    expect(getComputedStyle(value).color).not.toBe('');
    expect(getComputedStyle(value).color).not.toBe(
      getComputedStyle(within(within(tiles).getByTestId('tile-signIns')).getByText('42')).color
    );
  });

  it('draws the Top 5 table with a computed ratio column, and offers All', async () => {
    const user = userEvent.setup();
    renderActivity();
    const table = screen.getByRole('table', { name: 'Features' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
    ).toEqual(['Feature', 'Failed', 'Total', 'Last reading', 'Failure rate']);
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 5);
    expect(within(table).getByRole('row', { name: /feature-4/ })).toHaveTextContent('3%');
    expect(screen.getByTestId('metric-table-shown-features')).toHaveTextContent('Showing 5 of 8');

    await user.click(
      within(screen.getByTestId('metric-table-topn-features')).getByRole('combobox')
    );
    await user.click(await screen.findByRole('option', { name: 'All' }));
    expect(
      within(screen.getByRole('table', { name: 'Features' })).getAllByRole('row')
    ).toHaveLength(1 + 8);
  });

  it('draws no chart when it says series: []', () => {
    renderActivity();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('falls back to the defaults for a group without a presentation: every tile and every table', () => {
    render(
      <MetricSection
        group="activity"
        title="App activity"
        resource={resource}
        layout="desktop"
        spanMs={3_600_000}
        now={NOW}
        actions={[]}
      />
    );
    expect(
      within(screen.getByTestId('metric-tiles-activity')).getAllByRole('heading', { level: 3 })
    ).toHaveLength(3);
    expect(screen.getByRole('table', { name: 'Features' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('table', { name: 'Features' })).getAllByRole('row')
    ).toHaveLength(1 + 8);
  });
});

describe('a dashboard panel the app registered', () => {
  beforeEach(() => {
    resetDashboardPanelViewsForTests();
    registerPlatformDashboardPanelViews();
  });

  afterEach(() => {
    resetDashboardPanelViewsForTests();
  });

  const PANELS = [
    { id: 'api', label: 'API requests', order: 10, builtin: true },
    { id: 'logs', label: 'Log severity', order: 20, builtin: true },
    { id: 'signups', label: 'Sign-ups', order: 100, builtin: false },
    { id: 'orphan', label: 'No view for me', order: 110, builtin: false },
  ];

  function renderDashboard(overrides: Record<string, unknown> = {}) {
    const base = dashboardResponses();
    return render(
      <Routes>
        <Route path={ROUTE} element={<TelemetryDashboardPage />} />
      </Routes>,
      {
        wrapperOptions: {
          telemetryEnabled: true,
          route: ROUTE,
          responses: {
            ...base,
            'GET /admin/telemetry/dashboard/metric-groups': [
              ...mockDashboardMetricGroups,
              ACTIVITY_GROUP,
            ],
            'GET /admin/telemetry/dashboard/metrics': (request: TestApiRequest) =>
              request.path.includes('group=activity')
                ? ACTIVITY_DATA
                : base['GET /admin/telemetry/dashboard/metrics']!(request),
            'GET /admin/telemetry/dashboard/panels': PANELS,
            'GET /admin/telemetry/dashboard/panels/signups': {
              id: 'signups',
              generatedAt: '2026-09-27T11:00:00.000Z',
              payload: { total: 17 },
            },
            ...overrides,
          } as never,
        },
      }
    );
  }

  it('draws the view for a listed panel, after the events feed and before the metric sections', async () => {
    registerDashboardPanelView<{ total: number }>(
      'signups',
      ({ payload }: DashboardPanelViewProps<{ total: number }>) => (
        <p data-testid="signups-view">{payload.total} sign-ups</p>
      )
    );
    renderDashboard();

    const region = await screen.findByRole('region', { name: 'Sign-ups' }, { timeout: 15_000 });
    expect(await within(region).findByTestId('signups-view')).toHaveTextContent('17 sign-ups');
    await screen.findByRole('region', { name: 'Infrastructure' });
    const order = screen
      .getAllByRole('region')
      .map((element) => element.getAttribute('data-testid'));
    expect(order.indexOf('panel-events')).toBeLessThan(order.indexOf('panel-signups'));
    expect(order.indexOf('panel-signups')).toBeLessThan(order.indexOf('panel-metrics-host'));
  });

  it('still draws the platform api and logs panels, first', async () => {
    renderDashboard();
    await screen.findByRole('region', { name: 'API requests' });
    await screen.findByRole('region', { name: 'Log severity' });
    const order = screen
      .getAllByRole('region')
      .map((element) => element.getAttribute('data-testid'));
    expect(order.indexOf('panel-api')).toBeLessThan(order.indexOf('panel-logs'));
    expect(order.indexOf('panel-logs')).toBeLessThan(order.indexOf('panel-events'));
  });

  it('skips a listed panel with no registered view, and draws nothing for a view the API does not list', async () => {
    registerDashboardPanelView('signups', () => <p>x</p>);
    registerDashboardPanelView('unlisted', () => <p data-testid="unlisted-view">never</p>);
    renderDashboard();

    await screen.findByRole('region', { name: 'Sign-ups' }, { timeout: 15_000 });
    expect(screen.queryByRole('region', { name: 'No view for me' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('unlisted-view')).not.toBeInTheDocument();
  });

  it("shows a failing panel's own error with Retry, and the rest of the page keeps working", async () => {
    registerDashboardPanelView('signups', () => <p>never</p>);
    renderDashboard({
      'GET /admin/telemetry/dashboard/panels/signups': () => {
        throw createTestApiError(
          500,
          'The dashboard panel could not be read.',
          'INTERNAL_SERVER_ERROR',
          {
            reason: 'TELEMETRY_PANEL_FAILED',
          }
        );
      },
    });

    const region = await screen.findByRole('region', { name: 'Sign-ups' }, { timeout: 15_000 });
    expect(await within(region).findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'API requests' })).toBeInTheDocument();
  });

  it('offers "Open in Explorer" only when the payload names the statement it ran', async () => {
    registerDashboardPanelView('signups', () => <p>view</p>);
    renderDashboard({
      'GET /admin/telemetry/dashboard/panels/signups': {
        id: 'signups',
        generatedAt: '2026-09-27T11:00:00.000Z',
        payload: { total: 1, sql: 'SELECT 1' },
      },
    });
    const region = await screen.findByRole('region', { name: 'Sign-ups' }, { timeout: 15_000 });
    expect(await within(region).findByRole('button', { name: 'Open in Explorer' })).toBeEnabled();
  });

  it('draws an app group section from its presentation inside the page', async () => {
    renderDashboard();
    const region = await screen.findByRole('region', { name: 'App activity' }, { timeout: 15_000 });
    const tiles = await within(region).findByTestId('metric-tiles-activity');
    expect(within(tiles).getByTestId('tile-aiSpend')).toHaveTextContent(/\$1,234\.50/);
    expect(within(region).queryByTestId('tile-hidden')).not.toBeInTheDocument();
    expect(await within(region).findByRole('table', { name: 'Features' })).toBeInTheDocument();
  });
});
