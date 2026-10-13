// The Doctor page's slots and the per-check renderer registry (PP-14.23). The
// markup with no slot and no renderer registered is pinned by
// `DoctorPage.builtin-dom.test.tsx`.

import { cleanup, render, screen, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { PlatformHostProvider } from '../../src/core/index.js';
import { getDoctorCheckRenderer, registerDoctorCheckRenderer } from '../../src/doctor/headless/index.js';
import type { DoctorCheckRendererProps } from '../../src/doctor/headless/index.js';
import { CheckRow, DoctorPage } from '../../src/doctor/ui/index.js';
import type { DoctorPageHeaderProps } from '../../src/doctor/ui/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import { MIXED, check } from './fixtures.js';

const REPORT = {
  ...MIXED,
  checks: [
    ...MIXED.checks,
    check({ id: 'example.capability', category: 'example', label: 'Example capability', data: { configured: true, enabled: false } }),
  ],
};

function renderPage(page: ReactElement) {
  const host = createTestPlatformHost({ permissions: ['system_settings:read'], responses: { 'GET /admin/doctor': REPORT } });
  return render(
    <MemoryRouter>
      <ThemeProvider theme={createTheme()}>
        <PlatformHostProvider host={host}>{page}</PlatformHostProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

const follows = (a: Element, b: Element): boolean => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

function Facts({ check: row }: DoctorCheckRendererProps) {
  return (
    <dl aria-label={`Facts of ${row.id}`}>
      <dt>configured</dt>
      <dd>{String(row.data?.configured)}</dd>
    </dl>
  );
}

afterEach(() => cleanup());

describe('registerDoctorCheckRenderer', () => {
  it('draws the registered component inside the row of its check, and only that one', async () => {
    const unregister = registerDoctorCheckRenderer('example.capability', Facts);
    try {
      renderPage(<DoctorPage />);

      const row = await screen.findByTestId('doctor-check-example.capability');
      const facts = within(row).getByLabelText('Facts of example.capability');
      expect(within(facts).getByText('true')).toBeInTheDocument();
      expect(screen.queryByLabelText('Facts of core.database')).not.toBeInTheDocument();
    } finally {
      unregister();
    }
  });

  it('draws the renderer after the remedy and error and before the settings link', async () => {
    const unregister = registerDoctorCheckRenderer('storage.bucket', ({ check: row }) => <p data-testid="facts">facts of {row.id}</p>);
    try {
      renderPage(<DoctorPage />);

      const row = await screen.findByTestId('doctor-check-storage.bucket');
      const facts = within(row).getByTestId('facts');
      expect(follows(within(row).getByTestId('doctor-check-error-storage.bucket'), facts)).toBe(true);
      expect(follows(facts, within(row).getByRole('link', { name: /open settings/i }))).toBe(true);
    } finally {
      unregister();
    }
  });

  it('a later registration replaces the earlier one, and unregister removes only its own', () => {
    const A = () => <p>a</p>;
    const B = () => <p>b</p>;
    const offA = registerDoctorCheckRenderer('x.y', A);
    const offB = registerDoctorCheckRenderer('x.y', B);
    expect(getDoctorCheckRenderer('x.y')).toBe(B);
    offA();
    expect(getDoctorCheckRenderer('x.y')).toBe(B);
    offB();
    expect(getDoctorCheckRenderer('x.y')).toBeUndefined();
  });

  it('draws the row as it always was once the renderer is removed', async () => {
    registerDoctorCheckRenderer('example.capability', Facts)();
    renderPage(<DoctorPage />);

    await screen.findByTestId('doctor-check-example.capability');
    expect(screen.queryByLabelText('Facts of example.capability')).not.toBeInTheDocument();
  });
});

describe('DoctorPage slots', () => {
  it('CheckRowActions draws an action in every row, with the check', async () => {
    renderPage(<DoctorPage slots={{ CheckRowActions: ({ check: row }) => <button type="button">Runbook for {row.id}</button> }} />);

    const row = await screen.findByTestId('doctor-check-storage.bucket');
    expect(within(row).getByRole('button', { name: 'Runbook for storage.bucket' })).toBeInTheDocument();
    // Every visible row (the categories with a problem start expanded).
    expect(screen.getByTestId('doctor-check-email.smtp')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Runbook for email.smtp' })).toBeInTheDocument();
  });

  it('draws the base slots in the contract order and keeps the Header props', async () => {
    const seen: DoctorPageHeaderProps[] = [];
    const Header = (props: DoctorPageHeaderProps) => {
      seen.push(props);
      return <h1>{props.title} custom</h1>;
    };
    renderPage(
      <DoctorPage
        slots={{
          Header,
          BeforeContent: () => <p data-testid="before">banner</p>,
          Sections: ({ position }) => <p data-testid={`section-${position}`}>{position}</p>,
          AfterContent: () => <p data-testid="after">end</p>,
        }}
      />,
    );

    await screen.findByTestId('doctor-verdict');
    const order = [
      screen.getByRole('heading', { level: 1, name: /custom$/ }),
      screen.getByTestId('before'),
      screen.getByTestId('section-top'),
      screen.getByTestId('doctor-verdict'),
      screen.getByTestId('section-bottom'),
      screen.getByTestId('after'),
    ];
    for (let i = 0; i < order.length - 1; i += 1) expect(follows(order[i]!, order[i + 1]!)).toBe(true);
    expect(seen[0]).toMatchObject({ actions: null });
    expect(typeof seen[0]?.title).toBe('string');
  });

  it('renders CheckRow with an Actions slot directly', () => {
    const row = check({ id: 'a.b', category: 'core' });
    render(
      <MemoryRouter>
        <ul>
          <CheckRow check={row} Actions={({ check: c }) => <button type="button">act {c.id}</button>} />
        </ul>
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'act a.b' })).toBeInTheDocument();
  });
});
