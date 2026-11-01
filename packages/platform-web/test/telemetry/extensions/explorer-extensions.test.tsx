/**
 * The Telemetry Explorer's slots and its `starterQueries` prop (PP-14.18,
 * PP-14.23). CodeMirror is replaced with a textarea (jsdom has no layout).
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

vi.mock('../../../src/telemetry/ui/components/SqlEditor.js', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea
      aria-label="SQL query"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

import type { PageSlotsBase } from '../../../src/core/index.js';
import { STARTER_QUERIES } from '../../../src/telemetry/headless/index.js';
import type { StarterQuery } from '../../../src/telemetry/headless/index.js';
import TelemetryExplorerPage from '../../../src/telemetry/ui/pages/TelemetryExplorerPage.js';
import { render } from '../harness.js';
import { mockTelemetrySchema } from '../fixtures/telemetry.js';

const follows = (a: Element, b: Element): boolean =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

function explorer(props: { slots?: PageSlotsBase; starterQueries?: readonly StarterQuery[] } = {}) {
  return render(<TelemetryExplorerPage {...props} />, {
    wrapperOptions: {
      telemetryEnabled: true,
      route: '/admin/settings/telemetry/explorer',
      responses: { 'GET /admin/telemetry/schema': mockTelemetrySchema } as never,
    },
  });
}

const MINE: StarterQuery = {
  id: 'signups',
  title: 'Sign-ups (24h)',
  sql: 'SELECT count(*) AS n FROM app_auth_logins_total',
};

describe('TelemetryExplorerPage slots', () => {
  it('draws BeforeContent, Sections (both ends) and AfterContent in the contract order', async () => {
    explorer({
      slots: {
        BeforeContent: () => <p data-testid="before">banner</p>,
        Sections: ({ position }) => <p data-testid={`section-${position}`}>{position}</p>,
        AfterContent: () => <p data-testid="after">end</p>,
      },
    });
    const heading = await screen.findByRole('heading', { level: 1, name: 'Telemetry Explorer' });
    const toolbar = screen.getByRole('toolbar', { name: 'Query toolbar' });
    const order = [
      heading,
      screen.getByTestId('before'),
      screen.getByTestId('section-top'),
      toolbar,
      screen.getByTestId('section-bottom'),
      screen.getByTestId('after'),
    ];
    for (let i = 0; i < order.length - 1; i += 1)
      expect(follows(order[i]!, order[i + 1]!)).toBe(true);
  });

  it('replaces the header', async () => {
    explorer({
      slots: {
        Header: ({ title, actions }) => (
          <header data-testid="h">
            <h1>{title}</h1>
            {actions}
          </header>
        ),
      },
    });
    expect(await screen.findByTestId('h')).toHaveTextContent('Telemetry Explorer');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

describe('the starterQueries prop', () => {
  it('defaults to the built-in starter queries, the first seeding the editor', async () => {
    const user = userEvent.setup();
    explorer();
    expect(
      ((await screen.findByRole('textbox', { name: 'SQL query' })) as HTMLTextAreaElement).value
    ).toBe(STARTER_QUERIES[0]!.sql);
    await user.click(screen.getByRole('button', { name: /starter/i }));
    expect(within(await screen.findByRole('menu')).getAllByRole('menuitem')).toHaveLength(
      STARTER_QUERIES.length
    );
  });

  it('adds an app query to the built-in ones, and loads it into the editor when picked', async () => {
    const user = userEvent.setup();
    explorer({ starterQueries: [...STARTER_QUERIES, MINE] });
    await screen.findByRole('textbox', { name: 'SQL query' });
    await user.click(screen.getByRole('button', { name: /starter/i }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(STARTER_QUERIES.length + 1);
    await user.click(within(menu).getByRole('menuitem', { name: 'Sign-ups (24h)' }));
    expect((screen.getByRole('textbox', { name: 'SQL query' }) as HTMLTextAreaElement).value).toBe(
      MINE.sql
    );
  });

  it("replaces the built-in ones when given only the app's, which then seeds the editor", async () => {
    const user = userEvent.setup();
    explorer({ starterQueries: [MINE] });
    expect(
      ((await screen.findByRole('textbox', { name: 'SQL query' })) as HTMLTextAreaElement).value
    ).toBe(MINE.sql);
    await user.click(screen.getByRole('button', { name: /starter/i }));
    expect(
      within(await screen.findByRole('menu'))
        .getAllByRole('menuitem')
        .map((item) => item.textContent)
    ).toEqual(['Sign-ups (24h)']);
  });

  it('says so, and starts with an empty editor, when there are none', async () => {
    const user = userEvent.setup();
    explorer({ starterQueries: [] });
    expect(
      ((await screen.findByRole('textbox', { name: 'SQL query' })) as HTMLTextAreaElement).value
    ).toBe('');
    await user.click(screen.getByRole('button', { name: /starter/i }));
    expect(await screen.findByRole('menuitem', { name: 'No starter queries' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });
});
