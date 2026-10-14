import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import { CheckRow, DoctorPage, StatusIcon, doctorSettingsPage } from '../../src/doctor/ui/index.js';
import { createTestApiError, createTestPlatformHost } from '../../src/testing/index.js';
import type { TestApiResponse, TestPlatformHost } from '../../src/testing/index.js';
import { MIXED, check } from './fixtures.js';

afterEach(() => cleanup());

function hostWith(response: TestApiResponse, extra: { formatRelativeTime?: (iso: string) => string } = {}): TestPlatformHost {
  return createTestPlatformHost({
    permissions: ['system_settings:read'],
    responses: { 'GET /admin/doctor': response },
    ...extra,
  });
}

function renderPage(host: TestPlatformHost, page: ReactElement = <DoctorPage />) {
  return render(
    <MemoryRouter>
      <PlatformHostProvider host={host}>{page}</PlatformHostProvider>
    </MemoryRouter>,
  );
}

const headings = (level: number) => screen.getAllByRole('heading', { level }).map((h) => h.textContent);

describe('DoctorPage', () => {
  it('names the page identically to its descriptor card and shows a skeleton while loading', () => {
    renderPage(hostWith(() => new Promise(() => undefined)));

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(doctorSettingsPage.card.title);
    expect(screen.getByText(doctorSettingsPage.card.description)).toBeTruthy();
    expect(screen.getByTestId('doctor-loading')).toBeTruthy();
    expect((screen.getByRole('button', { name: /running checks/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a failed request as an error with a working retry', async () => {
    let fail = true;
    const host = hostWith(() => {
      if (fail) throw createTestApiError(500, 'Boom');
      return MIXED;
    });
    renderPage(host);

    const alert = await screen.findByTestId('doctor-request-error');
    expect(alert.textContent).toContain('Boom');

    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));

    expect(await screen.findByTestId('doctor-verdict')).toBeTruthy();
    expect(screen.queryByTestId('doctor-request-error')).toBeNull();
    expect(host.requests.at(-1)?.path).toBe('/admin/doctor?refresh=true');
  });

  it('renders a mixed report: verdict, counts, ordered sections, remedy, error and settings link', async () => {
    renderPage(hostWith(MIXED));

    const verdict = await screen.findByTestId('doctor-verdict');
    expect(verdict.textContent).toContain('2 problems need attention');
    expect(verdict.getAttribute('aria-live')).toBe('polite');

    expect(screen.getByTestId('doctor-count-pass').textContent).toContain('Pass: 2');
    expect(screen.getByTestId('doctor-count-warn').textContent).toContain('Warning: 1');
    expect(screen.getByTestId('doctor-count-fail').textContent).toContain('Fail: 1');
    expect(screen.getByTestId('doctor-count-skip').textContent).toContain('Skipped: 1');
    expect(screen.getByTestId('doctor-generated').textContent).toContain('1.8 s');

    // Known categories in display order, then the unknown one, title-cased.
    expect(headings(2)).toEqual(['Core', 'Object storage', 'Email', 'Telemetry', 'Fork Widgets']);

    const storageSummary = within(screen.getByTestId('doctor-category-storage')).getAllByRole('button')[0];
    expect(storageSummary?.getAttribute('aria-expanded')).toBe('true');
    const coreSummary = within(screen.getByTestId('doctor-category-core')).getAllByRole('button')[0];
    expect(coreSummary?.getAttribute('aria-expanded')).toBe('false');

    const bucket = screen.getByTestId('doctor-check-storage.bucket');
    expect(within(bucket).getByTestId('doctor-check-status-storage.bucket').textContent).toBe('Fail');
    expect(within(bucket).getByTestId('doctor-check-remedy-storage.bucket').textContent).toContain('Widen the credential policy');
    expect(within(bucket).getByTestId('doctor-check-error-storage.bucket').textContent).toBe(
      'AccessDenied: Access Denied (bucket: uploads)',
    );
    expect(within(bucket).getByRole('link', { name: /open settings for bucket reachable/i }).getAttribute('href')).toBe(
      '/admin/settings/storage',
    );
  });

  it('says all checks passed when every check passes', async () => {
    renderPage(hostWith({ ...MIXED, verdict: 'pass', checks: [check({ id: 'core.database', category: 'core' })] }));

    expect((await screen.findByTestId('doctor-verdict')).textContent).toContain('All checks passed');
  });

  it('filters to warnings and failures with "Problems only"', async () => {
    renderPage(hostWith(MIXED));
    await screen.findByTestId('doctor-verdict');

    fireEvent.click(screen.getByRole('switch', { name: 'Problems only' }));

    expect(headings(2)).toEqual(['Object storage', 'Email']);
    expect(screen.queryByTestId('doctor-check-core.database')).toBeNull();
    expect(screen.queryByTestId('doctor-check-telemetry.capture')).toBeNull();
    expect(screen.getByTestId('doctor-check-storage.bucket')).toBeTruthy();
    // The summary counts still describe the whole run.
    expect(screen.getByTestId('doctor-count-pass').textContent).toContain('Pass: 2');
  });

  it('sends refresh=true when "Run again" is clicked', async () => {
    const host = hostWith(MIXED);
    renderPage(host);
    await screen.findByTestId('doctor-verdict');
    expect(host.requests.map((r) => r.path)).toEqual(['/admin/doctor']);

    fireEvent.click(screen.getByRole('button', { name: 'Run again' }));

    await waitFor(() => expect(host.requests).toHaveLength(2));
    expect(host.requests[1]?.path).toBe('/admin/doctor?refresh=true');
  });

  it('uses the custom category labels and order it is given', async () => {
    renderPage(
      hostWith(MIXED),
      <DoctorPage categories={[{ key: 'fork_widgets', label: 'Widgets' }, { key: 'core', label: 'Platform core' }]} />,
    );
    await screen.findByTestId('doctor-verdict');

    expect(headings(2)).toEqual(['Widgets', 'Platform core', 'Telemetry', 'Storage', 'Email']);
  });

  it('honours slots.Header and sx', async () => {
    function Header({ title, description }: { title: string; description: string }) {
      return <div data-testid="custom-header">{`${title} / ${description}`}</div>;
    }
    renderPage(hostWith(MIXED), <DoctorPage slots={{ Header }} sx={{ marginTop: '7px' }} />);

    expect(screen.getByTestId('custom-header').textContent).toBe(
      `${doctorSettingsPage.card.title} / ${doctorSettingsPage.card.description}`,
    );
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(getComputedStyle(screen.getByTestId('doctor-page')).marginTop).toBe('7px');
    await screen.findByTestId('doctor-verdict');
  });

  it("formats the generated time with the host's formatter", async () => {
    renderPage(hostWith(MIXED, { formatRelativeTime: () => 'a moment ago (host)' }));

    expect((await screen.findByTestId('doctor-generated')).textContent).toContain('a moment ago (host)');
  });

  it('renders the whole report at phone width', async () => {
    window.innerWidth = 375;
    window.dispatchEvent(new Event('resize'));
    renderPage(hostWith(MIXED));

    expect(await screen.findByTestId('doctor-verdict')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Run again' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId('doctor-check-storage.bucket')).toBeTruthy();
  });
});

describe('status colours come from the palette.status tokens', () => {
  const tokenTheme = createTheme({ palette: { status: { ok: '#123456', crit: '#654321' } } as never });

  it('colours the icon with the theme token', () => {
    render(
      <ThemeProvider theme={tokenTheme}>
        <StatusIcon status="pass" />
        <StatusIcon status="fail" />
      </ThemeProvider>,
    );

    expect(getComputedStyle(screen.getByTitle('Pass').closest('svg')!).color).toBe('rgb(18, 52, 86)');
    expect(getComputedStyle(screen.getByTitle('Fail').closest('svg')!).color).toBe('rgb(101, 67, 33)');
  });

  it("falls back to the palette role a token defaults to when the theme sets none", () => {
    const plain = createTheme();
    render(
      <ThemeProvider theme={plain}>
        <MemoryRouter>
          <ul>
            <CheckRow check={check({ id: 'w', category: 'core', status: 'warn' })} />
          </ul>
        </MemoryRouter>
      </ThemeProvider>,
    );

    const warning = plain.palette.warning.main;
    const rgb = `rgb(${[1, 3, 5].map((i) => parseInt(warning.slice(i, i + 2), 16)).join(', ')})`;
    expect(getComputedStyle(screen.getByTitle('Warning').closest('svg')!).color).toBe(rgb);
  });
});

describe('doctorSettingsPage', () => {
  it('describes the card the app registers: path, permission, no feature', () => {
    expect(doctorSettingsPage.id).toBe('doctor');
    expect(doctorSettingsPage.card).toEqual({
      title: 'Doctor',
      description: 'Check the configuration, connectivity and health of every capability, including telemetry capture.',
      path: '/admin/settings/doctor',
      permission: 'system_settings:read',
    });
    expect(doctorSettingsPage.Page).toBe(DoctorPage);
  });
});
