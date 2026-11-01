// The jobs pages render every time in the user's display zone (the core
// store's `getDisplayTimeZone()`), not the machine's, and re-render when the
// zone changes. Expected strings are built with the same Intl fields
// (`toLocaleString`'s) and an explicit zone, so the test holds in any locale
// and on any machine zone.

import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { PlatformHostProvider, setPreferredTimeZone } from '../../src/core/index.js';
import { formatDateTime } from '../../src/jobs/headless/index.js';
import { JobsPage } from '../../src/jobs/ui/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import type { TestPlatformHost } from '../../src/testing/index.js';
import { job } from './harness.js';

// 2026-01-15 18:30 UTC: 03:30 on the 16th in Tokyo, 12:30 in Costa Rica.
const CREATED_AT = '2026-01-15T18:30:00.000Z';
const inZone = (iso: string, timeZone: string) => new Date(iso).toLocaleString(undefined, { timeZone });

const STATS = {
  total: 1,
  byStatus: { pending: 1, running: 0, succeeded: 0, failed: 0 },
  byType: [{ type: 'image.thumbnail', label: 'Thumbnail', total: 1, byStatus: { pending: 1, running: 0, succeeded: 0, failed: 0 } }],
  scheduled: 0,
  stuckRunning: 0,
  stuckThresholdMinutes: 30,
  generatedAt: CREATED_AT,
};

function renderAt(ui: ReactElement, host: TestPlatformHost) {
  return render(
    <MemoryRouter initialEntries={['/page']}>
      <ThemeProvider theme={createTheme()}>
        <PlatformHostProvider host={host}>
          <Routes>
            <Route path="/page" element={ui} />
          </Routes>
        </PlatformHostProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

afterEach(() => setPreferredTimeZone(null));

describe('formatDateTime of the jobs slice', () => {
  it("renders toLocaleString's fields in the display zone", () => {
    setPreferredTimeZone('UTC');
    expect(formatDateTime(CREATED_AT)).toBe(inZone(CREATED_AT, 'UTC'));
    setPreferredTimeZone('Asia/Tokyo');
    expect(formatDateTime(CREATED_AT)).toBe(inZone(CREATED_AT, 'Asia/Tokyo'));
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('not a date')).toBe('—');
  });
});

describe('JobsPage in the display time zone', () => {
  it("lists each job's Created time in Tokyo, then in Costa Rica after a zone change", async () => {
    setPreferredTimeZone('Asia/Tokyo');
    const host = createTestPlatformHost({
      permissions: ['jobs:read'],
      responses: {
        'GET /admin/jobs': { items: [job({ createdAt: CREATED_AT })], total: 1, page: 1, pageSize: 20, totalPages: 1 },
        'GET /admin/jobs/stats': STATS,
      },
    });
    renderAt(<JobsPage />, host);

    const table = await screen.findByRole('table', { name: 'Jobs' });
    expect(await within(table).findByText(inZone(CREATED_AT, 'Asia/Tokyo'))).toBeInTheDocument();
    expect(within(table).queryByText(inZone(CREATED_AT, 'UTC'))).not.toBeInTheDocument();

    act(() => setPreferredTimeZone('America/Costa_Rica'));
    expect(await within(table).findByText(inZone(CREATED_AT, 'America/Costa_Rica'))).toBeInTheDocument();
    expect(within(table).queryByText(inZone(CREATED_AT, 'Asia/Tokyo'))).not.toBeInTheDocument();
  });
});
