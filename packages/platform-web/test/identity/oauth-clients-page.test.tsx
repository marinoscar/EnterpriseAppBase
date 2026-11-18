// Console → OAuth clients (PP-15.7, #1185): read-only versus write, and the
// routes each control calls.

import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { DataTable } from '../../src/datatable/ui/index.js';
import type { IdentityDataTableComponent } from '../../src/identity/headless/index.js';
import { OAuthClientsPage } from '../../src/identity/ui/index.js';
import { createTestApiError } from '../../src/testing/index.js';
import type { TestApiRequest, TestApiResponse } from '../../src/testing/index.js';
import { SERVER_SETTINGS, client, mountOAuth } from './oauth-fixtures.js';

const CLIENT = client();
const READ = ['oauth_clients:read', 'system_settings:read'];
const WRITE = [...READ, 'oauth_clients:write', 'system_settings:write'];

function settingsDocument(oauthServer = SERVER_SETTINGS, version = 7) {
  return { oauthServer, version, security: { jwtAccessTtlMinutes: 15, refreshTtlDays: 14 }, updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: null };
}

function mountPage(permissions: string[], responses: Record<string, TestApiResponse> = {}, suggestedHosts?: string[]) {
  return mountOAuth(<OAuthClientsPage {...(suggestedHosts ? { suggestedHosts } : {})} />, {
    route: '/admin/settings/oauth-clients',
    permissions,
    adapters: { appName: 'Product X', DataTable: DataTable as unknown as IdentityDataTableComponent },
    responses: {
      'GET /system-settings': settingsDocument(),
      'PATCH /system-settings': (request: TestApiRequest) =>
        settingsDocument({ ...SERVER_SETTINGS, ...(request.body as { oauthServer: object }).oauthServer }, 8),
      'GET /admin/oauth/clients': { items: [CLIENT], total: 1, page: 1, pageSize: 20, totalPages: 1 },
      'GET /admin/oauth/refused-hosts': [{ host: 'blocked.example.test', count: 4, lastSeenAt: '2026-01-02T00:00:00.000Z' }],
      ...responses,
    },
  });
}

const patches = (requests: TestApiRequest[]) => requests.filter((request) => request.method === 'PATCH' && request.path === '/system-settings');

async function rowAction(user: ReturnType<typeof userEvent.setup>, label: string) {
  const direct = screen.queryAllByRole('button', { name: new RegExp(label) });
  if (direct.length > 0) {
    await user.click(direct[0]!);
    return;
  }
  await user.click(screen.getAllByRole('button', { name: /actions/i })[0]!);
  await user.click(await screen.findByRole('menuitem', { name: new RegExp(label) }));
}

describe('OAuthClientsPage: read only', () => {
  it('shows every section and value, and no write control', async () => {
    mountPage(READ);
    expect(await screen.findAllByText('Example Desk')).not.toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Who may connect' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Refused attempts' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Clients' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Token lifetimes' })).toBeInTheDocument();
    expect(screen.getByText('chat.example.test')).toBeInTheDocument();
    expect(screen.getByText('blocked.example.test')).toBeInTheDocument();

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a client' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add host' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Add a host' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Allow blocked.example.test/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove chat.example.test/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save lifetimes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rotate secret/ })).not.toBeInTheDocument();
    expect(screen.getByText('You can see the OAuth clients but not change them.')).toBeInTheDocument();
  });

  it('without system settings access, shows the client list only', async () => {
    const { host } = mountPage(['oauth_clients:read']);
    expect(await screen.findAllByText('Example Desk')).not.toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Status' })).not.toBeInTheDocument();
    expect(host.requests.some((request) => request.path === '/system-settings')).toBe(false);
  });
});

describe('OAuthClientsPage: writes', () => {
  it('switches the server on through the oauthServer namespace with If-Match', async () => {
    const user = userEvent.setup();
    const { host } = mountPage(WRITE);
    const toggle = await screen.findByRole('switch', { name: 'Let other apps connect with OAuth' });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    await waitFor(() => expect(patches(host.requests)).toHaveLength(1));
    expect(patches(host.requests)[0]).toMatchObject({ body: { oauthServer: { enabled: true } }, ifMatch: '7' });
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Let other apps connect with OAuth' })).toBeChecked());
  });

  it('shows the issuer with a copy button and warns when it is not https:', async () => {
    mountPage(WRITE);
    expect(await screen.findByTestId('oauth-issuer')).toHaveValue(window.location.origin);
    expect(screen.getByRole('button', { name: 'Copy issuer url' })).toBeInTheDocument();
    expect(screen.getByText(/Other services cannot reach this address/)).toBeInTheDocument();
  });

  it('adds a valid host, refuses an invalid one, and removes a host', async () => {
    const user = userEvent.setup();
    const { host } = mountPage(WRITE);
    const input = await screen.findByRole('textbox', { name: 'Add a host' });
    await user.type(input, 'https://*.example.test');
    await user.click(screen.getByRole('button', { name: 'Add host' }));
    expect(screen.getByText('Enter the host only, without https://.')).toBeInTheDocument();
    expect(patches(host.requests)).toHaveLength(0);

    await user.clear(input);
    await user.type(input, 'desk.example.test');
    await user.click(screen.getByRole('button', { name: 'Add host' }));
    await waitFor(() => expect(patches(host.requests)).toHaveLength(1));
    expect(patches(host.requests)[0]?.body).toEqual({ oauthServer: { allowedClientHosts: ['chat.example.test', 'desk.example.test'] } });

    await user.click(await screen.findByLabelText('Remove chat.example.test'));
    await waitFor(() => expect(patches(host.requests)).toHaveLength(2));
    expect(patches(host.requests)[1]?.body).toEqual({ oauthServer: { allowedClientHosts: ['desk.example.test'] } });
  });

  it('offers suggested hosts and refused hosts with Add / Allow this host', async () => {
    const user = userEvent.setup();
    const { host } = mountPage(WRITE, {}, ['tools.example.test', 'chat.example.test']);
    // An already allowed suggestion is not offered again.
    expect(await screen.findByRole('button', { name: 'Add tools.example.test' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add chat.example.test' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Allow blocked.example.test' }));
    await waitFor(() => expect(patches(host.requests)).toHaveLength(1));
    expect(patches(host.requests)[0]?.body).toEqual({ oauthServer: { allowedClientHosts: ['chat.example.test', 'blocked.example.test'] } });
  });

  it('falls back to the API policy for suggested hosts when the prop is absent, and the prop wins when given', async () => {
    mountPage(WRITE, { 'GET /admin/oauth/policy': { suggestedHosts: ['policy.example.test', 'chat.example.test'] } });
    expect(await screen.findByRole('button', { name: 'Add policy.example.test' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add chat.example.test' })).not.toBeInTheDocument();
  });

  it('suggests nothing when the API has no policy route', async () => {
    mountPage(WRITE, {
      'GET /admin/oauth/policy': () => {
        throw createTestApiError(404, 'Not Found');
      },
    });
    await screen.findByRole('button', { name: 'Allow blocked.example.test' });
    expect(screen.queryByRole('button', { name: /^Add .*\.example\.test$/ })).not.toBeInTheDocument();
  });

  it('says so when the API does not list refused attempts', async () => {
    mountPage(WRITE, {
      'GET /admin/oauth/refused-hosts': () => {
        throw createTestApiError(404, 'Not Found');
      },
    });
    expect(await screen.findByText(/This server does not list refused attempts/)).toBeInTheDocument();
  });

  it('asks before allowing any host', async () => {
    const user = userEvent.setup();
    const { host } = mountPage(WRITE);
    await user.click(await screen.findByRole('switch', { name: 'Allow apps from any host' }));
    const dialog = await screen.findByRole('dialog', { name: 'Allow apps from any host?' });
    expect(patches(host.requests)).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Allow any host' }));
    await waitFor(() => expect(patches(host.requests)[0]?.body).toEqual({ oauthServer: { allowAnyClientHost: true } }));
  });

  it('saves the token lifetimes and refuses an out-of-range value', async () => {
    const user = userEvent.setup();
    const { host } = mountPage(WRITE);
    const field = await screen.findByRole('textbox', { name: 'Access token life (minutes)' });
    await user.clear(field);
    await user.type(field, '2');
    expect(screen.getByText('Enter 5 to 1440.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save lifetimes' })).toBeDisabled();
    await user.clear(field);
    await user.type(field, '30');
    await user.click(screen.getByRole('button', { name: 'Save lifetimes' }));
    await waitFor(() => expect(patches(host.requests)).toHaveLength(1));
    expect(patches(host.requests)[0]?.body).toEqual({
      oauthServer: { accessTokenTtlMinutes: 30, refreshTokenTtlDays: 30, refreshTokenMaxAgeDays: 180, dynamicClientUnusedDays: 7 },
    });
  });

  it('adds a client and shows its secret once', async () => {
    const user = userEvent.setup();
    const created = { ...client({ id: '66666666-6666-4666-8666-666666666666', clientId: 'oc_new', name: 'Example Robot' }), clientSecret: 'ocs_secret_value' };
    const { host } = mountPage(WRITE, { 'POST /admin/oauth/clients': created });
    await user.click(await screen.findByRole('button', { name: 'Add a client' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a client' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Example Robot');
    await user.type(within(dialog).getByRole('textbox', { name: 'Redirect URIs' }), 'https://robot.example.test/cb');
    await user.click(within(dialog).getByRole('radio', { name: /Confidential/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Add client' }));
    await waitFor(() => expect(host.requests.find((request) => request.method === 'POST')?.path).toBe('/admin/oauth/clients'));
    expect(host.requests.find((request) => request.method === 'POST')?.body).toEqual({
      name: 'Example Robot',
      redirectUris: ['https://robot.example.test/cb'],
      tokenEndpointAuthMethod: 'client_secret_basic',
    });
    const reveal = await screen.findByRole('dialog', { name: 'Copy the client secret now' });
    expect(within(reveal).getByTestId('oauth-client-secret')).toHaveValue('ocs_secret_value');
    expect(within(reveal).getByText(/only time the secret is shown/)).toBeInTheDocument();
    await user.click(within(reveal).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByDisplayValue('ocs_secret_value')).not.toBeInTheDocument());
  });

  it('refuses a non-https redirect URI before calling the API', async () => {
    const user = userEvent.setup();
    const { host } = mountPage(WRITE);
    await user.click(await screen.findByRole('button', { name: 'Add a client' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a client' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Example Robot');
    await user.type(within(dialog).getByRole('textbox', { name: 'Redirect URIs' }), 'http://robot.example.test/cb');
    await user.click(within(dialog).getByRole('button', { name: 'Add client' }));
    expect(within(dialog).getByText('Use https:, or http: on localhost only.')).toBeInTheDocument();
    expect(host.requests.some((request) => request.method === 'POST')).toBe(false);
  });

  it('disables a client after confirming', async () => {
    const user = userEvent.setup();
    const { host } = mountPage(WRITE, { [`PATCH /admin/oauth/clients/${CLIENT.id}`]: { ...CLIENT, disabled: true } });
    await screen.findAllByText('Example Desk');
    await rowAction(user, 'Disable or enable');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Its 3 active connections stop working at once/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Change' }));
    await waitFor(() =>
      expect(host.requests.find((request) => request.method === 'PATCH' && request.path.startsWith('/admin'))).toMatchObject({
        path: `/admin/oauth/clients/${CLIENT.id}`,
        body: { disabled: true },
      }),
    );
  });

  it('deletes a client after a confirmation that says how many connections stop', async () => {
    const user = userEvent.setup();
    const { host } = mountPage(WRITE, { [`DELETE /admin/oauth/clients/${CLIENT.id}`]: undefined });
    await screen.findAllByText('Example Desk');
    await rowAction(user, 'Delete');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/has 3 active connections/)).toBeInTheDocument();
    expect(host.requests.some((request) => request.method === 'DELETE')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(host.requests.find((request) => request.method === 'DELETE')?.path).toBe(`/admin/oauth/clients/${CLIENT.id}`));
  });

  it('rotates a secret and shows the new one once', async () => {
    const user = userEvent.setup();
    const { host } = mountPage(WRITE, {
      [`POST /admin/oauth/clients/${CLIENT.id}/rotate-secret`]: { ...CLIENT, clientSecret: 'ocs_rotated' },
    });
    await screen.findAllByText('Example Desk');
    await rowAction(user, 'Rotate secret');
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Rotate' }));
    await waitFor(() =>
      expect(host.requests.find((request) => request.method === 'POST')?.path).toBe(`/admin/oauth/clients/${CLIENT.id}/rotate-secret`),
    );
    expect(await screen.findByDisplayValue('ocs_rotated')).toBeInTheDocument();
  });
});
