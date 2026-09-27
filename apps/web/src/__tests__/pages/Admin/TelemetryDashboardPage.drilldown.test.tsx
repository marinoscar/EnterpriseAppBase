/**
 * Telemetry Dashboard drill-down (issue #579, epic #576): the panel actions
 * ("Open in Explorer", "Ask assistant"), the events' "View trace" link and
 * the cross-links. Wire-level against MSW with the #577 fixtures; the explorer
 * route is a probe that shows what the dashboard handed it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { server } from '../../mocks/server';
import { resetViewportWidth, setViewportWidth } from '../../setup';
import { render, mockAdminUser } from '../../utils/test-utils';
import {
  dashboardHandlers,
  mockDashboardApiSeries,
  mockDashboardEventsPage1,
  mockDashboardSummary,
  mockDashboardTopErrors,
  mockDashboardTopRoutes,
} from '../../mocks/fixtures/telemetryDashboard';
import TelemetryDashboardPage from '../../../pages/Admin/TelemetryDashboardPage';
import { http, HttpResponse } from 'msw';

const DASHBOARD = '/admin/settings/telemetry/dashboard';
const EXPLORER = '/admin/settings/telemetry/explorer';

function ExplorerProbe() {
  const location = useLocation();
  return (
    <output data-testid="explorer-probe">{JSON.stringify({ search: location.search, state: location.state ?? null })}</output>
  );
}

function handedSql(): string | null {
  const probe = JSON.parse(screen.getByTestId('explorer-probe').textContent ?? '{}') as {
    state: { sql?: string } | null;
  };
  return probe.state?.sql ?? null;
}

function renderPage(options: { aiEnabled?: boolean; search?: string } = {}) {
  return render(
    <Routes>
      <Route path={DASHBOARD} element={<TelemetryDashboardPage />} />
      <Route path={EXPLORER} element={<ExplorerProbe />} />
    </Routes>,
    {
      wrapperOptions: {
        user: mockAdminUser,
        telemetryEnabled: true,
        aiEnabled: options.aiEnabled ?? false,
        route: `${DASHBOARD}${options.search ?? ''}`,
      },
    },
  );
}

describe('TelemetryDashboardPage drill-down (#579)', () => {
  beforeEach(() => {
    server.use(...dashboardHandlers());
  });

  afterEach(() => {
    act(() => resetViewportWidth());
  });

  describe('Open in Explorer', () => {
    it.each([
      ['panel-tiles', (mockDashboardSummary.sql as string[])[0]],
      ['panel-api', mockDashboardApiSeries.sql as string],
      ['panel-top-routes', mockDashboardTopRoutes.sql as string],
      ['panel-top-errors', mockDashboardTopErrors.sql as string],
      ['panel-events', mockDashboardEventsPage1.sql as string],
    ])('%s hands its API-reported SQL to the explorer', async (panelId, expected) => {
      const user = userEvent.setup();
      renderPage();
      const panel = await screen.findByTestId(panelId);
      const action = within(panel).getByRole('button', { name: 'Open in Explorer' });
      await waitFor(() => expect(action).toBeEnabled());

      await user.click(action);
      expect(await screen.findByTestId('explorer-probe')).toBeInTheDocument();
      expect(handedSql()).toBe(expected);
    });

    it('the log timeline hands over its SQL too', async () => {
      const user = userEvent.setup();
      renderPage();
      const panel = await screen.findByTestId('panel-logs');
      const action = within(panel).getByRole('button', { name: 'Open in Explorer' });
      await waitFor(() => expect(action).toBeEnabled());
      await user.click(action);
      expect(handedSql()).toBe('SELECT /* logs */ 1');
    });

    it('is disabled until the panel has SQL to hand over', async () => {
      server.use(http.get('*/api/admin/telemetry/dashboard/timeseries', () => new Promise(() => {})));
      renderPage();
      const panel = await screen.findByTestId('panel-api');
      expect(within(panel).getByRole('button', { name: 'Open in Explorer' })).toBeDisabled();
    });

    it('on phones sits in the ⋮ menu of the active Top problems view', async () => {
      act(() => setViewportWidth(390));
      const user = userEvent.setup();
      renderPage();
      const panel = await screen.findByTestId('panel-top');
      await within(panel).findByRole('list', { name: 'Top routes' });
      await user.click(within(panel).getByRole('button', { name: 'Errors' }));
      await within(panel).findByRole('list', { name: 'Top errors' });

      await user.click(within(panel).getByRole('button', { name: 'Top problems actions' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Open in Explorer' }));
      expect(await screen.findByTestId('explorer-probe')).toBeInTheDocument();
      expect(handedSql()).toBe(mockDashboardTopErrors.sql);
    });
  });
});
