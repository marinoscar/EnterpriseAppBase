/**
 * The packaged-page slot contract on the Telemetry Dashboard and Settings pages
 * (PP-14.18, PP-14.23): every slot, in the order the contract fixes, and the
 * header props. The markup with NO slot is pinned by the `*.builtin-dom` suites.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import type { PageSlotsBase } from '../../../src/core/index.js';
import TelemetryDashboardPage from '../../../src/telemetry/ui/pages/TelemetryDashboardPage.js';
import TelemetrySettingsPage from '../../../src/telemetry/ui/pages/TelemetrySettingsPage.js';
import { createTestApiError } from '../../../src/testing/index.js';
import { render, mockAdminUser } from '../harness.js';
import { dashboardResponses } from '../fixtures/telemetryDashboard.js';
import {
  mockTelemetryAdminConfig,
  mockTelemetryConnectionStored,
  mockTelemetryStackRunning,
  mockTelemetryStatus,
} from '../fixtures/telemetry.js';

const follows = (a: Element, b: Element): boolean =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

const SLOTS: PageSlotsBase = {
  BeforeContent: () => <p data-testid="before">banner</p>,
  Sections: ({ position }) => <p data-testid={`section-${position}`}>{position}</p>,
  AfterContent: () => <p data-testid="after">end</p>,
};

const SETTINGS_RESPONSES = {
  'GET /admin/telemetry/config': mockTelemetryAdminConfig,
  'GET /admin/telemetry/status': mockTelemetryStatus,
  'GET /admin/telemetry/connection': mockTelemetryConnectionStored,
  'GET /admin/telemetry/stack': mockTelemetryStackRunning,
};

function dashboard(slots?: PageSlotsBase, responses: Record<string, unknown> = {}) {
  return render(
    <Routes>
      <Route path="/d" element={<TelemetryDashboardPage slots={slots} />} />
    </Routes>,
    {
      wrapperOptions: {
        telemetryEnabled: true,
        route: '/d',
        responses: { ...dashboardResponses(), ...responses } as never,
      },
    }
  );
}

describe('TelemetryDashboardPage slots', () => {
  it("draws BeforeContent, Sections (both ends) and AfterContent in the contract order, around the page's own content", async () => {
    dashboard(SLOTS);

    const heading = await screen.findByRole('heading', { level: 1, name: 'Telemetry Dashboard' });
    const tiles = await screen.findByTestId('panel-tiles');
    const order = [
      heading,
      screen.getByTestId('before'),
      screen.getByTestId('section-top'),
      tiles,
      screen.getByTestId('section-bottom'),
      screen.getByTestId('after'),
    ];
    for (let i = 0; i < order.length - 1; i += 1)
      expect(follows(order[i]!, order[i + 1]!)).toBe(true);
  });

  it('replaces the header and hands it the title, the description and the cross link as actions', async () => {
    dashboard({
      Header: ({ title, description, actions }) => (
        <header data-testid="custom-header">
          <h1>{title}</h1>
          <p>{description}</p>
          <div data-testid="header-actions">{actions}</div>
        </header>
      ),
    });

    const header = await screen.findByTestId('custom-header');
    expect(header).toHaveTextContent('Telemetry Dashboard');
    expect(header).toHaveTextContent(/See at a glance whether anything is wrong/);
    expect(
      screen.getByTestId('header-actions').querySelector('a[href$="/explorer"]')
    ).not.toBeNull();
    // The default header is gone, not duplicated.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('draws the slots around the unavailable notice too', async () => {
    dashboard(SLOTS, {
      'GET /admin/telemetry/dashboard/summary': () => {
        throw createTestApiError(409, 'Telemetry is disabled.', 'CONFLICT', {
          reason: 'TELEMETRY_DISABLED',
        });
      },
    });
    await screen.findByTestId('telemetry-unavailable');
    expect(screen.getByTestId('section-top')).toBeInTheDocument();
    expect(screen.getByTestId('section-bottom')).toBeInTheDocument();
  });
});

describe('TelemetrySettingsPage slots', () => {
  function settings(slots?: PageSlotsBase, user = mockAdminUser) {
    return render(<TelemetrySettingsPage slots={slots} />, {
      wrapperOptions: {
        telemetryEnabled: true,
        route: '/admin/settings/telemetry',
        responses: SETTINGS_RESPONSES as never,
        user,
      },
    });
  }

  it('draws the slots in the contract order', async () => {
    settings(SLOTS);

    const heading = await screen.findByRole('heading', { level: 1, name: 'Telemetry' });
    await screen.findByRole('switch', { name: 'Collect telemetry' }, { timeout: 15_000 });
    const connection = await screen.findByRole('heading', { level: 2, name: 'Connection' });
    const order = [
      heading,
      screen.getByTestId('before'),
      screen.getByTestId('section-top'),
      connection,
      screen.getByTestId('section-bottom'),
      screen.getByTestId('after'),
    ];
    for (let i = 0; i < order.length - 1; i += 1)
      expect(follows(order[i]!, order[i + 1]!)).toBe(true);
  });

  it('hands a custom header the read-only flag for a viewer without telemetry:write', async () => {
    const seen: Array<boolean | undefined> = [];
    settings(
      {
        Header: ({ title, readOnly }) => {
          seen.push(readOnly);
          return (
            <h1>
              {title}
              {readOnly ? ' (read-only)' : ''}
            </h1>
          );
        },
      },
      {
        ...mockAdminUser,
        permissions: mockAdminUser.permissions.filter(
          (permission) => permission !== 'telemetry:write'
        ),
      }
    );

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Telemetry (read-only)')
    );
    expect(seen).toContain(true);
  });
});
