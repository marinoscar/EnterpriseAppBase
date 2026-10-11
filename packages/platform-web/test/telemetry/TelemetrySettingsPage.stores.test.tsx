/**
 * The telemetry settings page for a store that is not GreptimeDB (PP-14.11).
 *
 * `GET /admin/telemetry/config` says which store the deployment uses
 * (`store`). For `greptime` the page is the one recorded in
 * `TelemetrySettingsPage.builtin-dom.test.tsx`. For any other registered store
 * the Connection and Telemetry services sections give way to a Store section,
 * a generated form over the descriptor `GET /admin/telemetry/store` serves, with
 * write-only secrets and an `If-Match` on every save.
 */
import { describe, expect, it } from 'vitest';
import { userEvent } from '@testing-library/user-event';

import TelemetrySettingsPage from '../../src/telemetry/ui/pages/TelemetrySettingsPage.js';
import { createTestApiError } from '../../src/testing/index.js';
import type { TestApiRequest } from '../../src/testing/index.js';
import { render, screen, waitFor, within, mockAdminUser } from './harness.js';
import type { MockUser } from './harness.js';
import {
  mockTelemetryAdminConfig,
  mockTelemetryAdminConfigMemory,
  mockTelemetryConnectionStored,
  mockTelemetryStackRunning,
  mockTelemetryStatus,
  mockTelemetryStatusUnconfigured,
  mockTelemetryStoreMemory,
} from './fixtures/telemetry.js';

const SECRET = 'sk-typed-by-the-admin-NEVER-RENDERED-0001';

const readOnlyAdmin: MockUser = {
  ...mockAdminUser,
  permissions: mockAdminUser.permissions.filter((permission) => permission !== 'telemetry:write'),
};

const memoryResponses = {
  'GET /admin/telemetry/config': mockTelemetryAdminConfigMemory,
  'GET /admin/telemetry/status': { ...mockTelemetryStatus, database: 'memory', version: 'in-memory 1.0' },
  'GET /admin/telemetry/store': mockTelemetryStoreMemory,
};

function mount(responses: Record<string, unknown>, user: MockUser = mockAdminUser) {
  return render(<TelemetrySettingsPage />, {
    wrapperOptions: { telemetryEnabled: true, aiEnabled: true, route: '/admin/settings/telemetry', user, responses: responses as never },
  });
}

describe('a store the app registered', () => {
  it('draws the Store section from the descriptor instead of the Connection and services sections', async () => {
    mount(memoryResponses);

    const section = await screen.findByRole('region', { name: 'Store' });
    expect(await within(section).findByText('In-memory (example)', { selector: 'strong' })).toBeInTheDocument();
    expect(await within(section).findByLabelText('Database')).toHaveValue('memory');
    expect(within(section).getByLabelText('Latency ms')).toHaveValue(0);
    expect(within(section).getByTestId('telemetry-store-ready')).toHaveTextContent('Configured');
    expect(screen.queryByRole('region', { name: 'Connection' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Telemetry services' })).not.toBeInTheDocument();
    // The policy form and the status card are the platform's, unchanged.
    expect(screen.getByRole('switch', { name: 'Collect telemetry' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Status' })).toHaveTextContent('in-memory 1.0');
  });

  it('never asks for the connection or the stack of GreptimeDB', async () => {
    const { host } = mount(memoryResponses);
    await screen.findByRole('region', { name: 'Store' });

    const paths = host.requests.map((request) => `${request.method} ${request.path}`);
    expect(paths).toContain('GET /admin/telemetry/store');
    expect(paths.some((path) => path.includes('/admin/telemetry/connection'))).toBe(false);
    expect(paths.some((path) => path.includes('/admin/telemetry/stack'))).toBe(false);
  });

  it('saves the changed settings and the typed secret, with the store row\'s version as If-Match', async () => {
    const user = userEvent.setup();
    let saved: TestApiRequest | undefined;
    const { host } = mount({
      ...memoryResponses,
      'PUT /admin/telemetry/store': (request: TestApiRequest) => {
        saved = request;
        return { ...mockTelemetryStoreMemory, settings: { database: 'prod', latencyMs: 0 }, version: 3 };
      },
    });
    const section = await screen.findByRole('region', { name: 'Store' });
    const save = await within(section).findByRole('button', { name: 'Save store' });
    expect(save).toBeDisabled();

    const database = await within(section).findByLabelText('Database');
    await user.clear(database);
    await user.type(database, 'prod');
    await user.type(within(section).getByLabelText('API key'), SECRET);
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(saved).toBeDefined());
    expect(saved!.body).toEqual({ settings: { database: 'prod', latencyMs: 0 }, secrets: { apiKey: SECRET } });
    expect(saved!.ifMatch).toBe('2');
    expect(await screen.findByText('Telemetry store saved')).toBeInTheDocument();
    // The typed secret is never written back into the markup.
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(host.requests.filter((r) => r.method === 'PUT' && r.path === '/admin/telemetry/store')).toHaveLength(1);
  });

  it('leaves an untouched secret out of the request (blank keeps the stored one)', async () => {
    const user = userEvent.setup();
    let saved: TestApiRequest | undefined;
    mount({
      ...memoryResponses,
      'PUT /admin/telemetry/store': (request: TestApiRequest) => {
        saved = request;
        return mockTelemetryStoreMemory;
      },
    });
    const section = await screen.findByRole('region', { name: 'Store' });
    const latency = await within(section).findByLabelText('Latency ms');
    await user.clear(latency);
    await user.type(latency, '25');
    await user.click(within(section).getByRole('button', { name: 'Save store' }));

    await waitFor(() => expect(saved).toBeDefined());
    expect((saved!.body as { secrets: object }).secrets).toEqual({});
  });

  it('offers a reload on a version conflict and shows any other failure', async () => {
    const user = userEvent.setup();
    let call = 0;
    mount({
      ...memoryResponses,
      'PUT /admin/telemetry/store': () => {
        call += 1;
        throw call === 1 ? createTestApiError(409, 'changed') : createTestApiError(400, 'Invalid settings for the telemetry store "memory": latencyMs');
      },
    });
    const section = await screen.findByRole('region', { name: 'Store' });
    const database = await within(section).findByLabelText('Database');

    await user.type(database, 'x');
    await user.click(within(section).getByRole('button', { name: 'Save store' }));
    expect(await within(section).findByTestId('telemetry-store-conflict')).toBeInTheDocument();

    await user.type(database, 'y');
    await user.click(within(section).getByRole('button', { name: 'Save store' }));
    expect(await within(section).findByText(/Invalid settings for the telemetry store "memory"/)).toBeInTheDocument();
  });

  it('is read-only without telemetry:write', async () => {
    mount(memoryResponses, readOnlyAdmin);

    const section = await screen.findByRole('region', { name: 'Store' });
    expect(await within(section).findByLabelText('Database')).toBeDisabled();
    expect(within(section).getByRole('button', { name: 'Save store' })).toBeDisabled();
  });

  it('shows why the store could not be built, and names the store in the status card', async () => {
    mount({
      ...memoryResponses,
      'GET /admin/telemetry/status': mockTelemetryStatusUnconfigured,
      'GET /admin/telemetry/store': { ...mockTelemetryStoreMemory, ready: false, error: 'The telemetry store "memory" could not be built: boom' },
    });

    const section = await screen.findByRole('region', { name: 'Store' });
    expect(await within(section).findByTestId('telemetry-store-error')).toHaveTextContent('could not be built: boom');
    expect(within(section).getByTestId('telemetry-store-ready')).toHaveTextContent('Not configured');
    const status = screen.getByTestId('telemetry-not-configured');
    expect(status).toHaveTextContent('In-memory (example) not configured');
    expect(status).not.toHaveTextContent('GreptimeDB');
  });
});

describe('GreptimeDB (the built-in store)', () => {
  const greptimeResponses = {
    'GET /admin/telemetry/config': mockTelemetryAdminConfig,
    'GET /admin/telemetry/status': mockTelemetryStatus,
    'GET /admin/telemetry/connection': mockTelemetryConnectionStored,
    'GET /admin/telemetry/stack': mockTelemetryStackRunning,
  };

  it('keeps the Connection and services sections when the server names no store (an older API)', async () => {
    mount(greptimeResponses);

    expect(await screen.findByRole('region', { name: 'Connection' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Telemetry services' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Store' })).not.toBeInTheDocument();
  });

  it('keeps them when the server names greptime', async () => {
    mount({
      ...greptimeResponses,
      'GET /admin/telemetry/config': { ...mockTelemetryAdminConfig, store: { id: 'greptime', label: 'GreptimeDB' } },
    });

    expect(await screen.findByRole('region', { name: 'Connection' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Store' })).not.toBeInTheDocument();
  });
});
