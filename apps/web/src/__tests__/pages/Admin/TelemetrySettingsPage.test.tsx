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
  mockTelemetryConnectionEnvironment,
  mockTelemetryConnectionNone,
  mockTelemetryConnectionStored,
  mockTelemetryStatusUnconfigured,
} from '../../mocks/fixtures/telemetry';
import type {
  TelemetryConnection,
  TelemetryConnectionInput,
  TelemetrySettings,
} from '../../../services/telemetry';
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

    const alert = await screen.findByTestId('telemetry-not-configured');
    expect(alert).toHaveTextContent(/GreptimeDB not configured/);
    // Actionable: it points at the Connection section, and still says the
    // server itself has to be deployed.
    expect(within(alert).getByRole('link', { name: 'Connection' })).toHaveAttribute(
      'href',
      '#telemetry-connection',
    );
    expect(alert).toHaveTextContent(/appctl deploy update --group observability/);
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

  describe('Connection section (#558)', () => {
    function serveConnection(connection: TelemetryConnection) {
      server.use(
        http.get(`${API_BASE}/admin/telemetry/connection`, () =>
          HttpResponse.json({ data: connection }),
        ),
      );
    }

    function captureConnectionPut(response: TelemetryConnection = mockTelemetryConnectionStored) {
      const calls: { body: TelemetryConnectionInput; ifMatch: string | null }[] = [];
      server.use(
        http.put(`${API_BASE}/admin/telemetry/connection`, async ({ request }) => {
          const body = (await request.json()) as TelemetryConnectionInput;
          calls.push({ body, ifMatch: request.headers.get('If-Match') });
          return HttpResponse.json({
            data: { ...response, source: 'stored', version: response.version + 1 },
          });
        }),
      );
      return calls;
    }

    async function connectionSection() {
      await waitForForm();
      const section = screen.getByRole('region', { name: 'Connection' });
      await within(section).findByLabelText('Host (optional)');
      return section;
    }

    it.each([
      [mockTelemetryConnectionStored, 'Saved in admin settings'],
      [mockTelemetryConnectionEnvironment, 'Deployment default (environment)'],
      [mockTelemetryConnectionNone, 'Not configured'],
    ])('shows the source chip for %#', async (connection, label) => {
      serveConnection(connection);
      renderPage();
      const section = await connectionSection();
      expect(within(section).getByTestId('telemetry-connection-source')).toHaveTextContent(label);
    });

    it('fills the fields, never a password, and describes the saved one by its hint', async () => {
      renderPage();
      const section = await connectionSection();

      // The stored host is automatic: the field is empty and names the effective host.
      const host = within(section).getByLabelText('Host (optional)');
      expect(host).toHaveValue('');
      expect(host).toHaveAttribute('placeholder', 'Automatic: greptimedb');
      expect(
        within(section).getByText(
          'Automatic: greptimedb — the GreptimeDB service deployed next to this app. Set a host only for an external GreptimeDB.',
        ),
      ).toBeInTheDocument();
      expect(within(section).getByLabelText('PostgreSQL port')).toHaveValue(4003);
      expect(within(section).getByLabelText('Database')).toHaveValue('public');
      expect(within(section).getByLabelText('Reader user')).toHaveValue('readonly');
      expect(within(section).getByLabelText('Admin user (optional)')).toHaveValue('admin');
      const readerPassword = within(section).getByLabelText('Reader password');
      expect(readerPassword).toHaveAttribute('type', 'password');
      expect(readerPassword).toHaveValue('');
      expect(within(section).getByText(/Saved \(••••x9fQ\) — leave blank to keep it/)).toBeInTheDocument();
    });

    it('defaults the port and database when nothing is configured', async () => {
      serveConnection({ ...mockTelemetryConnectionNone, pgPort: 0, database: '' });
      renderPage();
      const section = await connectionSection();
      expect(within(section).getByLabelText('PostgreSQL port')).toHaveValue(4003);
      expect(within(section).getByLabelText('Database')).toHaveValue('public');
      expect(within(section).getByTestId('telemetry-connection-none')).toBeInTheDocument();
    });

    it('saves with the connection If-Match and does not send blank passwords', async () => {
      const calls = captureConnectionPut();
      const user = userEvent.setup();
      renderPage();
      const section = await connectionSection();

      const host = within(section).getByLabelText('Host (optional)');
      await user.clear(host);
      await user.type(host, '  greptime.internal  ');
      await user.click(within(section).getByRole('button', { name: 'Save connection' }));

      await waitFor(() => expect(calls).toHaveLength(1));
      // The connection's own version (3) — not /config's (7).
      expect(calls[0].ifMatch).toBe(String(mockTelemetryConnectionStored.version));
      // A custom host is sent trimmed.
      expect(calls[0].body).toEqual({
        host: 'greptime.internal',
        pgPort: 4003,
        database: 'public',
        readerUser: 'readonly',
        adminUser: 'admin',
      });
      expect('readerPassword' in calls[0].body).toBe(false);
      expect('adminPassword' in calls[0].body).toBe(false);
      expect(await screen.findByText('Telemetry connection saved')).toBeInTheDocument();
    });

    it('sends host null for a blank (automatic) host', async () => {
      const calls = captureConnectionPut();
      const user = userEvent.setup();
      renderPage();
      const section = await connectionSection();

      await user.click(within(section).getByRole('button', { name: 'Save connection' }));

      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0].body.host).toBeNull();
      expect('host' in calls[0].body).toBe(true);
    });

    it('sends host null when a custom host is cleared', async () => {
      serveConnection({
        ...mockTelemetryConnectionStored,
        host: 'greptime.internal',
        effectiveHost: 'greptime.internal',
        hostMode: 'custom',
      });
      const calls = captureConnectionPut();
      const user = userEvent.setup();
      renderPage();
      const section = await connectionSection();

      const host = within(section).getByLabelText('Host (optional)');
      expect(host).toHaveValue('greptime.internal');
      expect(within(section).getByText(/^Leave blank for automatic — /)).toBeInTheDocument();
      await user.clear(host);
      await user.click(within(section).getByRole('button', { name: 'Save connection' }));

      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0].body.host).toBeNull();
    });

    it('prefills the deployment default host from the environment', async () => {
      serveConnection(mockTelemetryConnectionEnvironment);
      renderPage();
      const section = await connectionSection();
      expect(within(section).getByLabelText('Host (optional)')).toHaveValue('greptimedb');
    });

    it('rejects a host with a scheme, port or path', async () => {
      const user = userEvent.setup();
      renderPage();
      const section = await connectionSection();

      await user.type(within(section).getByLabelText('Host (optional)'), 'http://greptime:4003');
      expect(
        within(section).getByText('Host name or IP address only — no scheme, port or path.'),
      ).toBeInTheDocument();
      expect(within(section).getByRole('button', { name: 'Test connection' })).toBeDisabled();
    });

    it('sends a typed password and null for a blank admin user', async () => {
      const calls = captureConnectionPut();
      const user = userEvent.setup();
      renderPage();
      const section = await connectionSection();

      await user.type(within(section).getByLabelText('Reader password'), 's3cret');
      await user.clear(within(section).getByLabelText('Admin user (optional)'));
      expect(within(section).getByLabelText('Admin password')).toBeDisabled();
      await user.click(within(section).getByRole('button', { name: 'Save connection' }));

      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0].body.readerPassword).toBe('s3cret');
      expect(calls[0].body.adminUser).toBeNull();
      expect('adminPassword' in calls[0].body).toBe(false);
    });

    it('requires passwords when saving over the deployment default', async () => {
      serveConnection(mockTelemetryConnectionEnvironment);
      const calls = captureConnectionPut(mockTelemetryConnectionEnvironment);
      const user = userEvent.setup();
      renderPage();
      const section = await connectionSection();

      expect(
        within(section).getAllByText(/deployment default password is never copied/).length,
      ).toBeGreaterThan(0);
      await user.click(within(section).getByRole('button', { name: 'Save connection' }));

      expect(
        await within(section).findByText(/Required — no reader password is saved/),
      ).toBeInTheDocument();
      expect(within(section).getByText(/Required with an admin user/)).toBeInTheDocument();
      expect(calls).toHaveLength(0);

      await user.type(within(section).getByLabelText('Reader password'), 'reader-pw');
      await user.type(within(section).getByLabelText('Admin password'), 'admin-pw');
      await user.click(within(section).getByRole('button', { name: 'Save connection' }));
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0].ifMatch).toBe('0');
      expect(calls[0].body).toMatchObject({ readerPassword: 'reader-pw', adminPassword: 'admin-pw' });
    });

    it('does not require an admin password without an admin user', async () => {
      serveConnection(mockTelemetryConnectionNone);
      const calls = captureConnectionPut(mockTelemetryConnectionNone);
      const user = userEvent.setup();
      renderPage();
      const section = await connectionSection();

      // No host typed: automatic is enough.
      await user.type(within(section).getByLabelText('Reader user'), 'readonly');
      await user.type(within(section).getByLabelText('Reader password'), 'pw');
      await user.click(within(section).getByRole('button', { name: 'Save connection' }));

      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0].body.adminUser).toBeNull();
      expect(calls[0].body.host).toBeNull();
    });

    it('refreshes the telemetry config and status after a save', async () => {
      captureConnectionPut();
      let configGets = 0;
      let statusGets = 0;
      server.use(
        http.get(`${API_BASE}/admin/telemetry/config`, () => {
          configGets += 1;
          return HttpResponse.json({ data: mockTelemetryAdminConfig });
        }),
        http.get(`${API_BASE}/admin/telemetry/status`, () => {
          statusGets += 1;
          return HttpResponse.json({ data: mockTelemetryStatusUnconfigured });
        }),
      );
      const user = userEvent.setup();
      renderPage();
      const section = await connectionSection();
      const [configBefore, statusBefore] = [configGets, statusGets];

      await user.click(within(section).getByRole('button', { name: 'Save connection' }));
      await waitFor(() => expect(configGets).toBeGreaterThan(configBefore));
      await waitFor(() => expect(statusGets).toBeGreaterThan(statusBefore));
    });

    it('offers a reload when the save is refused with 409', async () => {
      server.use(
        http.put(`${API_BASE}/admin/telemetry/connection`, () =>
          HttpResponse.json({ code: 'CONFLICT', message: 'Version mismatch' }, { status: 409 }),
        ),
      );
      const user = userEvent.setup();
      renderPage();
      const section = await connectionSection();

      await user.click(within(section).getByRole('button', { name: 'Save connection' }));
      const conflict = await within(section).findByTestId('telemetry-connection-conflict');
      await user.click(within(conflict).getByRole('button', { name: 'Reload' }));
      await waitFor(() =>
        expect(screen.queryByTestId('telemetry-connection-conflict')).not.toBeInTheDocument(),
      );
    });

    it('renders per-role test results and sends the candidate without blank passwords', async () => {
      const bodies: TelemetryConnectionInput[] = [];
      server.use(
        http.post(`${API_BASE}/admin/telemetry/connection/test`, async ({ request }) => {
          bodies.push((await request.json()) as TelemetryConnectionInput);
          return HttpResponse.json({
            data: {
              host: 'greptimedb',
              reader: { success: true, latencyMs: 12, version: 'PostgreSQL 16.3 GreptimeDB 1.2.1' },
              admin: { success: false, latencyMs: 8, error: 'password authentication failed' },
            },
          });
        }),
      );
      const user = userEvent.setup();
      renderPage();
      const section = await connectionSection();

      await user.click(within(section).getByRole('button', { name: 'Test connection' }));
      const result = await within(section).findByTestId('telemetry-connection-test-result');
      // The host actually probed — the deployment host, as the candidate's is automatic.
      expect(result).toHaveTextContent('Tested greptimedb');
      expect(within(result).getByText('Reader login connected')).toBeInTheDocument();
      expect(within(result).getByText(/PostgreSQL 16\.3 GreptimeDB 1\.2\.1 · 12 ms/)).toBeInTheDocument();
      expect(within(result).getByText('Admin login failed')).toBeInTheDocument();
      expect(within(result).getByText(/password authentication failed/)).toBeInTheDocument();
      expect(bodies).toHaveLength(1);
      expect(bodies[0].host).toBeNull();
      expect('readerPassword' in bodies[0]).toBe(false);
    });

    it('shows the admin probe as skipped', async () => {
      server.use(
        http.post(`${API_BASE}/admin/telemetry/connection/test`, () =>
          HttpResponse.json({
            data: {
              host: 'greptime.internal',
              reader: { success: false, latencyMs: 30, error: 'connection refused' },
              admin: { skipped: true },
            },
          }),
        ),
      );
      const user = userEvent.setup();
      renderPage();
      const section = await connectionSection();

      await user.click(within(section).getByRole('button', { name: 'Test connection' }));
      const result = await within(section).findByTestId('telemetry-connection-test-result');
      expect(within(result).getByText('Reader login failed')).toBeInTheDocument();
      expect(within(result).getByText(/connection refused/)).toBeInTheDocument();
      expect(within(result).getByText('Admin login skipped')).toBeInTheDocument();
      expect(result).toHaveTextContent('Tested greptime.internal');
    });

    it('reverts with DELETE after confirmation', async () => {
      const deletes: (string | null)[] = [];
      server.use(
        http.delete(`${API_BASE}/admin/telemetry/connection`, ({ request }) => {
          deletes.push(request.headers.get('If-Match'));
          return HttpResponse.json({ data: mockTelemetryConnectionEnvironment });
        }),
      );
      const user = userEvent.setup();
      renderPage();
      const section = await connectionSection();

      await user.click(within(section).getByRole('button', { name: 'Revert to deployment default' }));
      const dialog = await screen.findByRole('dialog', { name: 'Revert to the deployment default?' });
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(deletes).toHaveLength(0);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      await user.click(within(section).getByRole('button', { name: 'Revert to deployment default' }));
      const again = await screen.findByRole('dialog', { name: 'Revert to the deployment default?' });
      await user.click(within(again).getByRole('button', { name: 'Revert' }));

      await waitFor(() => expect(deletes).toEqual([String(mockTelemetryConnectionStored.version)]));
      await waitFor(() =>
        expect(within(section).getByTestId('telemetry-connection-source')).toHaveTextContent(
          'Deployment default (environment)',
        ),
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      // Nothing stored any more, so there is nothing to revert.
      expect(
        within(section).getByRole('button', { name: 'Revert to deployment default' }),
      ).toBeDisabled();
    });

    it('cannot revert while nothing is stored', async () => {
      serveConnection(mockTelemetryConnectionEnvironment);
      renderPage();
      const section = await connectionSection();
      expect(
        within(section).getByRole('button', { name: 'Revert to deployment default' }),
      ).toBeDisabled();
    });

    it('disables every connection control without telemetry:write', async () => {
      renderPage({ user: readOnlyAdmin });
      const section = await connectionSection();

      for (const label of [
        'Host (optional)',
        'PostgreSQL port',
        'Database',
        'Reader user',
        'Reader password',
        'Admin user (optional)',
        'Admin password',
      ]) {
        expect(within(section).getByLabelText(label)).toBeDisabled();
      }
      for (const name of ['Test connection', 'Save connection', 'Revert to deployment default']) {
        expect(within(section).getByRole('button', { name })).toBeDisabled();
      }
    });
  });
});
