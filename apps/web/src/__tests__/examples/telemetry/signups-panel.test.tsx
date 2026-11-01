/**
 * PP-14.18: an app's own Telemetry Dashboard card, from two registrations and no
 * platform edit.
 *
 * The reference app's API registers the `signups` panel
 * (apps/api/src/platform-extensions/telemetry/signups.dashboard-panel.ts) and
 * `GET …/dashboard/panels` lists it; the app's web registers the VIEW that draws
 * its payload (`registerSignupsPanelView`, called from `main.tsx`). The packaged
 * dashboard draws the card around it. Only the network is mocked (MSW).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import TelemetryDashboardPage from '@marinoscar/platform-web/telemetry/ui/dashboard-page';
import { getDashboardPanelView } from '@marinoscar/platform-web/telemetry/ui/dashboard-panels';
import { render, mockAdminUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import { dashboardHandlers, mockDashboardPanels } from '../../mocks/fixtures/telemetryDashboard';
import {
  registerSignupsPanelView,
  SIGNUPS_PANEL_ID,
  type SignupsPayload,
} from '../../../platform-extensions/telemetry/SignupsPanelView.example';

const API = '*/api/admin/telemetry/dashboard';
const DASHBOARD = '/admin/settings/telemetry/dashboard';

const SIGNUPS_META = { id: 'signups', label: 'Sign-ins', order: 30, builtin: false };

const PAYLOAD: SignupsPayload = {
  available: true,
  total: 1234,
  bucketSeconds: 60,
  buckets: [
    { t: '2026-09-27T10:00:00.000Z', signIns: 3 },
    { t: '2026-09-27T10:01:00.000Z', signIns: 5 },
  ],
  sql: 'SELECT 1',
};

function serve(payload: SignupsPayload) {
  // The first matching handler wins: the app's panel routes go before the dashboard defaults.
  server.use(
    http.get(`${API}/panels`, () => HttpResponse.json({ data: [...mockDashboardPanels, SIGNUPS_META] })),
    http.get(`${API}/panels/${SIGNUPS_PANEL_ID}`, () => HttpResponse.json({ data: { payload } })),
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

describe('the reference app signups panel view (PP-14.18)', () => {
  beforeEach(() => {
    server.resetHandlers();
    registerSignupsPanelView();
  });

  it('registers a view for the id the API registered', () => {
    expect(getDashboardPanelView(SIGNUPS_PANEL_ID)).toBeDefined();
  });

  it('draws the app card inside the platform frame, from the served payload', async () => {
    serve(PAYLOAD);
    renderPage();

    const card = await screen.findByTestId('panel-signups', undefined, { timeout: 5_000 });
    expect(await within(card).findByTestId('signups-view', undefined, { timeout: 5_000 })).toHaveTextContent('1,234');
    expect(within(card).getByText('Sign-ins')).toBeInTheDocument();
  });

  it('draws the empty line when the store has no sign-in data', async () => {
    serve({ available: false, total: 0, bucketSeconds: 60, buckets: [] });
    renderPage();

    const card = await screen.findByTestId('panel-signups', undefined, { timeout: 5_000 });
    expect(await within(card).findByTestId('signups-empty', undefined, { timeout: 5_000 })).toBeInTheDocument();
  });
});
