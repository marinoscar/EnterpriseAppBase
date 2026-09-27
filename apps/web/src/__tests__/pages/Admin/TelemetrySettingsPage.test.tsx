/**
 * `/admin/settings/telemetry` (issue #537, epic #528).
 *
 * Wire-level: the real hooks run against MSW, so these assertions cover what
 * the page SENDS (the PUT body and its `If-Match`) as well as what it renders.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../mocks/server';
import { render, mockAdminUser, type MockUser } from '../../utils/test-utils';
import {
  mockTelemetryAdminConfig,
  mockTelemetryStatusUnconfigured,
} from '../../mocks/fixtures/telemetry';
import type { TelemetrySettings } from '../../../services/telemetry';
import TelemetrySettingsPage from '../../../pages/Admin/TelemetrySettingsPage';

const API_BASE = '*/api';

const readOnlyAdmin: MockUser = {
  ...mockAdminUser,
  permissions: mockAdminUser.permissions.filter((permission) => permission !== 'telemetry:write'),
};

function renderPage(options: { user?: MockUser; aiEnabled?: boolean } = {}) {
  return render(<TelemetrySettingsPage />, {
    wrapperOptions: {
      user: options.user ?? mockAdminUser,
      aiEnabled: options.aiEnabled ?? true,
      telemetryEnabled: true,
      route: '/admin/settings/telemetry',
    },
  });
}

function capturePut() {
  const calls: { body: TelemetrySettings; ifMatch: string | null }[] = [];
  server.use(
    http.put(`${API_BASE}/admin/telemetry/config`, async ({ request }) => {
      const body = (await request.json()) as TelemetrySettings;
      calls.push({ body, ifMatch: request.headers.get('If-Match') });
      return HttpResponse.json({
        data: { ...mockTelemetryAdminConfig, ...body, version: mockTelemetryAdminConfig.version + 1 },
      });
    }),
  );
  return calls;
}

async function waitForForm() {
  await screen.findByRole('heading', { level: 1, name: 'Telemetry' });
  await screen.findByRole('switch', { name: 'Collect telemetry' });
}

describe('TelemetrySettingsPage', () => {
  it('renders the status card: chips, version, retention in force and the table list', async () => {
    renderPage();
    await waitForForm();

    const status = screen.getByRole('region', { name: 'Status' });
    await within(status).findByText('Reachable');
    expect(within(status).getByText('Configured')).toBeInTheDocument();
    expect(within(status).getByText('PostgreSQL 16.3 GreptimeDB 1.2.1')).toBeInTheDocument();
    expect(within(status).getByText(/30 days \(30days\)/)).toBeInTheDocument();
    const tables = within(status).getByRole('table', { name: 'Telemetry tables' });
    expect(within(tables).getByText('opentelemetry_traces')).toBeInTheDocument();
    expect(within(tables).getByText((12345).toLocaleString())).toBeInTheDocument();
  });

  it('explains how to fix an unconfigured store', async () => {
    server.use(
      http.get(`${API_BASE}/admin/telemetry/status`, () =>
        HttpResponse.json({ data: mockTelemetryStatusUnconfigured }),
      ),
    );
    renderPage();
    await waitForForm();

    expect(await screen.findByTestId('telemetry-not-configured')).toHaveTextContent(
      /GreptimeDB not configured — start the telemetry overlay/,
    );
  });

  it('sets retentionDays from a preset and saves with If-Match', async () => {
    const calls = capturePut();
    const user = userEvent.setup();
    renderPage();
    await waitForForm();

    const saveButton = screen.getByRole('button', { name: 'Save Changes' });
    expect(saveButton).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '90 days' }));
    expect(screen.getByRole('button', { name: '90 days' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(saveButton);

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].ifMatch).toBe(String(mockTelemetryAdminConfig.version));
    expect(calls[0].body.retentionDays).toBe(90);
    // The full namespace is sent back (full replace), provenance excluded.
    expect(calls[0].body).toEqual({
      enabled: true,
      retentionDays: 90,
      query: { maxRows: 10000, timeoutSeconds: 30 },
      assistant: {
        enabled: true,
        provider: 'openai',
        modelId: 'gpt-5-mini',
        shareResults: false,
        maxResultRowsToModel: 100,
        maxSteps: 8,
      },
    });
    expect(await screen.findByText('Telemetry settings saved')).toBeInTheDocument();
  });

  it('validates a custom retention between 1 and 3650 days', async () => {
    const calls = capturePut();
    const user = userEvent.setup();
    renderPage();
    await waitForForm();

    await user.click(screen.getByRole('button', { name: 'Custom' }));
    const field = screen.getByLabelText('Retention (days)');
    await user.clear(field);
    await user.type(field, '5000');

    expect(screen.getByText('Must be from 1 to 3650.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();

    await user.clear(field);
    await user.type(field, '45');
    expect(screen.queryByText('Must be from 1 to 3650.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body.retentionDays).toBe(45);
  });

  it('validates the query limits', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForForm();

    const timeout = screen.getByLabelText('Query timeout (seconds)');
    await user.clear(timeout);
    await user.type(timeout, '121');
    expect(screen.getByText('Must be from 1 to 120.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  });

  it('offers a reload when the save is refused with 409', async () => {
    server.use(
      http.put(`${API_BASE}/admin/telemetry/config`, () =>
        HttpResponse.json({ code: 'CONFLICT', message: 'Version mismatch' }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await waitForForm();

    await user.click(screen.getByRole('switch', { name: 'Collect telemetry' }));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    const conflict = await screen.findByTestId('telemetry-conflict');
    expect(conflict).toHaveTextContent(/changed by someone else/);
    await user.click(within(conflict).getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.queryByTestId('telemetry-conflict')).not.toBeInTheDocument());
    // Reloaded: the form is back to the server's values.
    expect(await screen.findByRole('switch', { name: 'Collect telemetry' })).toBeChecked();
  });

  it('is read-only without telemetry:write', async () => {
    renderPage({ user: readOnlyAdmin });
    await waitForForm();

    expect(screen.getByTestId('telemetry-read-only-notice')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Collect telemetry' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Enable the telemetry assistant' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '90 days' })).toBeDisabled();
    expect(screen.getByLabelText('Maximum rows per query')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  });

  it('explains that the assistant will not run while AI is off, linking to the AI page', async () => {
    renderPage({ aiEnabled: false });
    await waitForForm();

    const alert = screen.getByTestId('telemetry-ai-off');
    expect(within(alert).getByRole('link', { name: 'AI settings' })).toHaveAttribute(
      'href',
      '/admin/settings/ai',
    );
    // Still editable.
    expect(screen.getByRole('switch', { name: 'Enable the telemetry assistant' })).toBeEnabled();
  });

  it('shows no AI-off notice while AI is on', async () => {
    renderPage({ aiEnabled: true });
    await waitForForm();
    expect(screen.queryByTestId('telemetry-ai-off')).not.toBeInTheDocument();
  });

  it('warns when retention cannot be applied', async () => {
    server.use(
      http.get(`${API_BASE}/admin/telemetry/config`, () =>
        HttpResponse.json({ data: { ...mockTelemetryAdminConfig, retentionApplicable: false } }),
      ),
    );
    renderPage();
    await waitForForm();
    expect(screen.getByTestId('retention-not-applicable')).toBeInTheDocument();
  });

  it('lists enabled catalogue models in the assistant model picker and saves the choice', async () => {
    const calls = capturePut();
    const user = userEvent.setup();
    renderPage();
    await waitForForm();

    await user.click(screen.getByRole('combobox', { name: /model/i }));
    const listbox = await screen.findByRole('listbox');
    await user.click(within(listbox).getByText('Not set'));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body.assistant.provider).toBeNull();
    expect(calls[0].body.assistant.modelId).toBeNull();
  });
});
