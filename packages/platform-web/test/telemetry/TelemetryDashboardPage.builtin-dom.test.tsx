/**
 * The Telemetry Dashboard's markup did not move (PP-14.18).
 *
 * The snapshot beside this file (`__snapshots__/`) was RECORDED FROM THE PAGE
 * AS IT WAS BEFORE the slot contract, the dashboard panel registry and the
 * presentation-driven metric sections (same fixtures, rendered by the old
 * `TelemetryDashboardPage`), so passing means the page an administrator sees
 * is, element for element and class for class, the one they had: the six
 * platform groups render from their own `presentation` exactly as they did
 * from the web's `SECTION_SPECS`, and a page given no slot adds nothing.
 * Re-record only for a deliberate change.
 *
 * Volatile text is pinned: the clock (`Date` only, timers stay real), the
 * fixtures' load-time timestamps and the React-generated ids, which depend on
 * how many components used `useId` before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import TelemetryDashboardPage from '../../src/telemetry/ui/pages/TelemetryDashboardPage.js';
import { render, screen, mockAdminUser } from './harness.js';
import { setViewportWidth, resetViewportWidth } from '../viewport.js';
import { dashboardResponses } from './fixtures/telemetryDashboard.js';

const ROUTE = '/admin/settings/telemetry/dashboard';

/** Generated ids (`:r1:`, `mui-12`, `_r_3_`) depend on mount order across the file. */
function normalize(html: string): string {
  return html
    .replace(/:r[0-9a-z]+:/g, ':rN:')
    .replace(/_r_[0-9a-z]+_/g, '_r_N_')
    .replace(/mui-\d+/g, 'mui-N')
    .replace(/(?:clip|mask|gradient)-?[A-Za-z]*-?\d+/g, 'defs-N')
    // The fixtures stamp their timestamps when the module loads, before the fake clock is set.
    .replace(/[A-Z][a-z]{2} \d{1,2}, 20\d\d,? \d\d:\d\d:\d\d [AP]M/g, '<time>')
    // Icon outlines are long and say nothing about the structure being pinned.
    .replace(/ d="[^"]*"/g, ' d="…"');
}

async function mount(options: { search?: string; aiEnabled?: boolean; responses?: Record<string, unknown> } = {}): Promise<string> {
  const { container, unmount } = render(
    <Routes>
      <Route path={ROUTE} element={<TelemetryDashboardPage />} />
    </Routes>,
    {
      wrapperOptions: {
        user: mockAdminUser,
        telemetryEnabled: true,
        aiEnabled: options.aiEnabled ?? false,
        route: `${ROUTE}${options.search ?? ''}`,
        responses: { ...dashboardResponses(), ...(options.responses ?? {}) } as never,
      },
    },
  );
  await screen.findByRole('table', { name: 'Uptime targets' }, { timeout: 15_000 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const html = normalize(container.innerHTML);
  unmount();
  return html;
}

// Each render waits for six sections' requests and a full MUI charts tree: allow a loaded runner.
const RENDER_TIMEOUT_MS = 120_000;

describe('the Telemetry Dashboard is unchanged', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => resetViewportWidth());
  });

  it('desktop: verdict, tiles, panels, the six platform sections', async () => {
    expect(await mount()).toMatchSnapshot();
  }, RENDER_TIMEOUT_MS);

  it('desktop with the assistant available', async () => {
    expect(await mount({ aiEnabled: true })).toMatchSnapshot();
  }, RENDER_TIMEOUT_MS);

  it('a tablet window', async () => {
    act(() => setViewportWidth(900));
    expect(await mount({ search: '?range=6h' })).toMatchSnapshot();
  }, RENDER_TIMEOUT_MS);

  it('a phone window', async () => {
    act(() => setViewportWidth(390));
    expect(await mount()).toMatchSnapshot();
  }, RENDER_TIMEOUT_MS);
});
