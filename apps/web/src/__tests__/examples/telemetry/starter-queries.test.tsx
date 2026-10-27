/**
 * PP-14.18: the Telemetry Explorer offers the app's own starter queries through
 * its `starterQueries` prop, with no change to the platform page.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { STARTER_QUERIES } from '@marinoscar/platform-web/telemetry/headless';
import TelemetryExplorerPage from '@marinoscar/platform-web/telemetry/ui/explorer-page';
import { render, mockAdminUser } from '../../utils/test-utils';
import { APP_STARTER_QUERIES } from '../../../platform-extensions/telemetry/starterQueries.example';

// The page lazy-loads its CodeMirror editor (a chunk jsdom cannot run); the
// packaged module is replaced by a textarea at its built path.
vi.mock('../../../../../../packages/platform-web/dist/telemetry/ui/components/SqlEditor.js', () => {
  function MockSqlEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    return <textarea aria-label="SQL query" value={value} onChange={(event) => onChange(event.target.value)} />;
  }
  return { default: MockSqlEditor };
});

function renderPage(starterQueries?: typeof APP_STARTER_QUERIES) {
  return render(<TelemetryExplorerPage starterQueries={starterQueries} />, {
    wrapperOptions: {
      user: mockAdminUser,
      aiEnabled: false,
      telemetryEnabled: true,
      route: '/admin/settings/telemetry/explorer',
    },
  });
}

describe('the explorer starter queries prop (PP-14.18)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('keeps the platform list first and adds the app query', async () => {
    const user = userEvent.setup();
    renderPage(APP_STARTER_QUERIES);
    await screen.findByRole('textbox', { name: 'SQL query' });

    await user.click(screen.getByRole('button', { name: 'Starter queries' }));
    const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent);
    expect(items).toEqual(APP_STARTER_QUERIES.map((query) => query.title));
    expect(items.slice(0, STARTER_QUERIES.length)).toEqual(STARTER_QUERIES.map((query) => query.title));
  });

  it('seeds the editor with the app query when it is chosen', async () => {
    const user = userEvent.setup();
    renderPage(APP_STARTER_QUERIES);
    const textarea = (await screen.findByRole('textbox', { name: 'SQL query' })) as HTMLTextAreaElement;

    await user.click(screen.getByRole('button', { name: 'Starter queries' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign-ins by outcome (24h)' }));

    expect(textarea.value).toBe(APP_STARTER_QUERIES.find((query) => query.id === 'app-sign-ins-by-outcome')?.sql);
  });

  it("offers the platform's list when the prop is left out", async () => {
    const user = userEvent.setup();
    renderPage(undefined);
    await screen.findByRole('textbox', { name: 'SQL query' });

    await user.click(screen.getByRole('button', { name: 'Starter queries' }));
    expect(await screen.findAllByRole('menuitem')).toHaveLength(STARTER_QUERIES.length);
  });
});
