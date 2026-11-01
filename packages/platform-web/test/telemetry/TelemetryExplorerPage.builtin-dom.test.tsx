/**
 * The Telemetry Explorer's markup did not move (PP-14.18).
 *
 * The snapshot beside this file (`__snapshots__/`) was RECORDED FROM THE PAGE
 * AS IT WAS BEFORE the slot contract and the `starterQueries` prop (same
 * fixtures, rendered by the old `TelemetryExplorerPage`). CodeMirror is
 * replaced with a textarea (jsdom has no layout), as the page's other tests do.
 * Re-record only for a deliberate change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';

vi.mock('../../src/telemetry/ui/components/SqlEditor.js', async () => {
  const React = await import('react');
  function MockSqlEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    return <textarea aria-label="SQL query" value={value} onChange={(event) => onChange(event.target.value)} />;
  }
  return { default: MockSqlEditor, __esModule: true, React };
});

import TelemetryExplorerPage from '../../src/telemetry/ui/pages/TelemetryExplorerPage.js';
import { render, screen, mockAdminUser } from './harness.js';
import { setViewportWidth, resetViewportWidth } from '../viewport.js';
import { mockTelemetrySchema } from './fixtures/telemetry.js';

function normalize(html: string): string {
  return html
    .replace(/:r[0-9a-z]+:/g, ':rN:')
    .replace(/_r_[0-9a-z]+_/g, '_r_N_')
    .replace(/mui-\d+/g, 'mui-N')
    .replace(/ d="[^"]*"/g, ' d="…"');
}

async function mount(options: { aiEnabled?: boolean } = {}): Promise<string> {
  const { container, unmount } = render(<TelemetryExplorerPage />, {
    wrapperOptions: {
      user: mockAdminUser,
      telemetryEnabled: true,
      aiEnabled: options.aiEnabled ?? false,
      route: '/admin/settings/telemetry/explorer',
      responses: { 'GET /admin/telemetry/schema': mockTelemetrySchema } as never,
    },
  });
  await screen.findByRole('textbox', { name: 'SQL query' });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const html = normalize(container.innerHTML);
  unmount();
  return html;
}

describe('the Telemetry Explorer is unchanged', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => act(() => resetViewportWidth()));

  it('desktop, assistant unavailable', async () => {
    expect(await mount()).toMatchSnapshot();
  });

  it('desktop, assistant available', async () => {
    expect(await mount({ aiEnabled: true })).toMatchSnapshot();
  });

  it('a phone window', async () => {
    act(() => setViewportWidth(390));
    expect(await mount()).toMatchSnapshot();
  });
});
