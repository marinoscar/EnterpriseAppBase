/**
 * The Doctor page's markup did not move (PP-14.23).
 *
 * `DoctorPage` gained the page-slot contract (`PageSlotsBase`, `CheckRowActions`)
 * and `CheckRow` the check-renderer registry. The snapshot beside this file
 * (`__snapshots__/`) was RECORDED FROM THE PAGE AS IT WAS BEFORE THAT CHANGE (the
 * same fixtures, rendered by the old page), so passing means the page an
 * administrator sees with no slot passed and no renderer registered is, element
 * for element and class for class, the one they had.
 *
 * The only normalisation is React's generated ids (`_r_1f_`). Re-record only for
 * a deliberate change of the page.
 */
import { act, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import { DoctorPage } from '../../src/doctor/ui/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import { MIXED, check } from './fixtures.js';

const NOW = new Date('2026-03-02T12:00:00.000Z');

// A fixed `generatedAt` (the shared MIXED report uses `new Date()`), and one
// check that carries `data` (which the old page never rendered).
const REPORT = {
  ...MIXED,
  generatedAt: '2026-03-02T11:59:00.000Z',
  checks: [
    ...MIXED.checks,
    check({ id: 'fork.data', category: 'fork_widgets', label: 'Widget facts', data: { configured: true, count: 3 } }),
  ],
};

const html = (root: Element): string => root.innerHTML.replace(/_r_[0-9a-z]+_/g, '_rX_');

async function mount(): Promise<string> {
  const host = createTestPlatformHost({
    permissions: ['system_settings:read'],
    responses: { 'GET /admin/doctor': REPORT },
  });
  const { container, unmount } = render(
    <MemoryRouter>
      <ThemeProvider theme={createTheme()}>
        <PlatformHostProvider host={host}>
          <DoctorPage />
        </PlatformHostProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
  await screen.findByTestId('doctor-verdict');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  const out = html(container);
  unmount();
  return out;
}

describe("the doctor page's markup is unchanged", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('a mixed report', async () => {
    const out = await mount();
    expect(out).toContain('Widget facts');
    expect(out).toMatchSnapshot();
  });
});
