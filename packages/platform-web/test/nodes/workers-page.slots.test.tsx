// The packaged-page slot contract on the Worker Nodes page (PP-14.23): the base
// slots, the table slots and `VitalsPanel`. The markup with NO slot is pinned by
// `WorkersPage.builtin-dom.test.tsx`.

import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { PlatformHostProvider } from '../../src/core/index.js';
import { WorkersPage } from '../../src/nodes/ui/index.js';
import type { NodesPageHeaderProps, WorkersPageSlots } from '../../src/nodes/ui/index.js';
import { createTestPlatformHost } from '../../src/testing/index.js';
import { credential, node } from './harness.js';
import { fullVitals } from './vitals-fixtures.js';

function renderPage(ui: ReactElement, permissions = ['nodes:read', 'nodes:write']) {
  const host = createTestPlatformHost({
    permissions,
    responses: {
      'GET /admin/nodes': [node({ lastVitals: fullVitals, lastVitalsAt: '2026-01-01T00:05:00.000Z' })],
      'GET /admin/nodes/credentials': [credential()],
    },
  });
  return render(
    <MemoryRouter initialEntries={['/page']}>
      <ThemeProvider theme={createTheme()}>
        <PlatformHostProvider host={host}>{ui}</PlatformHostProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

const follows = (a: Element, b: Element): boolean => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('WorkersPage slots', () => {
  it('draws BeforeContent, Sections (both ends) and AfterContent in the contract order', async () => {
    const slots: WorkersPageSlots = {
      BeforeContent: () => <p data-testid="before">banner</p>,
      Sections: ({ position }) => <p data-testid={`section-${position}`}>{position}</p>,
      AfterContent: () => <p data-testid="after">end</p>,
    };
    renderPage(<WorkersPage slots={slots} />);

    const fleet = await screen.findByRole('table', { name: 'Worker nodes' });
    const order = [
      screen.getByRole('heading', { level: 1, name: 'Worker Nodes' }),
      screen.getByTestId('before'),
      screen.getByTestId('section-top'),
      fleet,
      screen.getByTestId('section-bottom'),
      screen.getByTestId('after'),
    ];
    for (let i = 0; i < order.length - 1; i += 1) expect(follows(order[i]!, order[i + 1]!)).toBe(true);
  });

  it('hands the Header its old props plus actions: null', async () => {
    const seen: NodesPageHeaderProps[] = [];
    const Header = (props: NodesPageHeaderProps) => {
      seen.push(props);
      return <h1>{props.title} custom</h1>;
    };
    renderPage(<WorkersPage slots={{ Header }} />, ['nodes:read']);

    expect(await screen.findByRole('heading', { level: 1, name: 'Worker Nodes custom' })).toBeInTheDocument();
    expect(seen[0]).toMatchObject({ title: 'Worker Nodes', readOnly: true, actions: null });
  });

  it('adds a column, a row action cell, a detail cell and a toolbar', async () => {
    renderPage(
      <WorkersPage
        slots={{
          Columns: (base) => [...base, { id: 'rack', label: 'Rack', priority: 'secondary', render: (row) => `rack-${row.name}` }],
          RowActions: ({ row }) => <button type="button">Drain {row.name}</button>,
          DetailPanel: ({ row }) => <span>cli {row.cliVersion}</span>,
          Toolbar: () => <button type="button">Drain all</button>,
        }}
      />,
    );

    const fleet = await screen.findByRole('table', { name: 'Worker nodes' });
    await waitFor(() => expect(within(fleet).getByText('rack-worker-a')).toBeInTheDocument());
    expect(within(fleet).getByRole('columnheader', { name: 'Rack' })).toBeInTheDocument();
    expect(within(fleet).getByRole('button', { name: 'Drain worker-a' })).toBeInTheDocument();
    expect(within(fleet).getByText('cli 1.4.0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Drain all' })).toBeInTheDocument();
    // The built-in row actions are untouched.
    expect(within(fleet).getByRole('button', { name: 'View vitals' })).toBeInTheDocument();
    expect(within(fleet).getByRole('button', { name: 'Delete node' })).toBeInTheDocument();
  });

  it('draws VitalsPanel after the vitals in the dialog, with the node', async () => {
    renderPage(<WorkersPage slots={{ VitalsPanel: ({ node: n }) => <p>forecast for {n.name}</p> }} />);

    await userEvent.click(await screen.findByRole('button', { name: 'View vitals' }));

    const dialog = await screen.findByRole('dialog');
    const panel = within(dialog).getByRole('region', { name: 'Additional vitals' });
    expect(within(panel).getByText('forecast for worker-a')).toBeInTheDocument();
    expect(follows(within(dialog).getByRole('table', { name: 'Node counters' }), panel)).toBe(true);
  });

  it('draws no extra region in the dialog without the slot', async () => {
    renderPage(<WorkersPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'View vitals' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('region', { name: 'Additional vitals' })).not.toBeInTheDocument();
  });
});
