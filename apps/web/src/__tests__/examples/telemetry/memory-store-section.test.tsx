/**
 * PP-14.11: a telemetry store an app registered shows up on the admin telemetry
 * page with no web code.
 *
 * The reference app's API registers `memory`
 * (apps/api/src/platform-extensions/telemetry/memory-store.ts) with
 * `registerTelemetryStore`; a deployment selects it with
 * `TelemetryModule.forRoot({ store: 'memory' })`. `GET /admin/telemetry/config`
 * then names it, `GET /admin/telemetry/store` describes it, and the packaged
 * page draws a generated Store section from that descriptor instead of the
 * GreptimeDB Connection form. Nothing is mocked but the network (MSW), so the
 * test proves the wire: an edit saves as `{ settings, secrets }` with the store
 * row's version as `If-Match`.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import TelemetrySettingsPage from '@marinoscar/platform-web/telemetry/ui/settings-page';
import { render, mockAdminUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import {
  mockTelemetryAdminConfigMemoryStore,
  mockTelemetryStatus,
  mockTelemetryStoreMemory,
} from '../../mocks/fixtures/telemetry';

const API_BASE = '*/api';

interface Captured {
  path: string;
  body: Record<string, unknown>;
  ifMatch: string | null;
}

describe('memory on the admin telemetry page (PP-14.11)', () => {
  let captured: Captured[];

  beforeEach(() => {
    server.resetHandlers();
    captured = [];
    server.use(
      http.get(`${API_BASE}/admin/telemetry/config`, () => HttpResponse.json({ data: mockTelemetryAdminConfigMemoryStore })),
      http.get(`${API_BASE}/admin/telemetry/status`, () =>
        HttpResponse.json({ data: { ...mockTelemetryStatus, database: 'memory', version: 'in-memory telemetry store 1.0' } }),
      ),
      http.get(`${API_BASE}/admin/telemetry/store`, () => HttpResponse.json({ data: mockTelemetryStoreMemory })),
      http.put(`${API_BASE}/admin/telemetry/store`, async ({ request }) => {
        const body = (await request.json()) as { settings: Record<string, unknown> };
        captured.push({ path: new URL(request.url).pathname, body, ifMatch: request.headers.get('If-Match') });
        return HttpResponse.json({
          data: { ...mockTelemetryStoreMemory, settings: { ...mockTelemetryStoreMemory.settings, ...body.settings }, version: 1 },
        });
      }),
    );
  });

  async function renderPage() {
    const user = userEvent.setup();
    render(<TelemetrySettingsPage />, {
      wrapperOptions: { user: mockAdminUser, aiEnabled: true, telemetryEnabled: true, route: '/admin/settings/telemetry' },
    });
    const section = await screen.findByRole('region', { name: 'Store' });
    await within(section).findByLabelText('Database');
    return { user, section };
  }

  it('replaces the GreptimeDB Connection and services sections with a generated Store section', async () => {
    const { section } = await renderPage();

    expect(within(section).getByText('In-memory (example)', { selector: 'strong' })).toBeInTheDocument();
    expect(within(section).getByRole('switch', { name: /Enabled/ })).toBeChecked();
    expect(within(section).getByLabelText('Database')).toHaveValue('memory');
    expect(within(section).getByLabelText('Latency ms')).toHaveValue(0);
    expect(screen.queryByRole('region', { name: 'Connection' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Telemetry services' })).not.toBeInTheDocument();
    expect(await screen.findByText('in-memory telemetry store 1.0')).toBeInTheDocument();
  });

  it('saves an edited setting as { settings, secrets } with the store row\'s version', async () => {
    const { user, section } = await renderPage();

    const latency = within(section).getByLabelText('Latency ms');
    await user.clear(latency);
    await user.type(latency, '250');
    await user.click(within(section).getByRole('button', { name: 'Save store' }));

    await waitFor(() => expect(captured).toHaveLength(1));
    expect(captured[0]).toMatchObject({
      path: '/api/admin/telemetry/store',
      ifMatch: '0',
      body: { settings: { enabled: true, database: 'memory', latencyMs: 250 }, secrets: {} },
    });
    expect(await screen.findByText('Telemetry store saved')).toBeInTheDocument();
  });

  it('keeps the store read-only without telemetry:write', async () => {
    const user = userEvent.setup();
    render(<TelemetrySettingsPage />, {
      wrapperOptions: {
        user: { ...mockAdminUser, permissions: mockAdminUser.permissions.filter((p) => p !== 'telemetry:write') },
        aiEnabled: true,
        telemetryEnabled: true,
        route: '/admin/settings/telemetry',
      },
    });
    const section = await screen.findByRole('region', { name: 'Store' });

    expect(await within(section).findByLabelText('Database')).toBeDisabled();
    expect(within(section).getByRole('button', { name: 'Save store' })).toBeDisabled();
    void user;
  });
});
