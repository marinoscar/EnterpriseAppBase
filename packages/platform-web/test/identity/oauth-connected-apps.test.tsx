// Settings → Connected apps (PP-15.7, #1185).

import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { DataTable } from '../../src/datatable/ui/index.js';
import type { IdentityDataTableComponent } from '../../src/identity/headless/index.js';
import { ConnectedAppsPage } from '../../src/identity/ui/index.js';
import { createTestApiError } from '../../src/testing/index.js';
import { grant, mountOAuth } from './oauth-fixtures.js';
import type { MountOptions } from './oauth-fixtures.js';

const GRANT = grant({ organization: { id: '22222222-2222-4222-8222-222222222222', name: 'Org Alpha' } });

function mountPage(responses: MountOptions['responses'], withAppTable = false) {
  return mountOAuth(<ConnectedAppsPage />, {
    route: '/settings/connected-apps',
    responses,
    adapters: withAppTable ? { appName: 'Product X', DataTable: DataTable as unknown as IdentityDataTableComponent } : { appName: 'Product X' },
  });
}

describe('ConnectedAppsPage', () => {
  it('lists the grants: app, host, resource, scopes, organization', async () => {
    mountPage({ 'GET /oauth/grants': [GRANT] });
    expect(await screen.findByText('Example Assistant')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Connected apps' });
    expect(within(table).getByText('chat.example.test')).toBeInTheDocument();
    expect(within(table).getByText('Runs')).toBeInTheDocument();
    expect(within(table).getByText('Read runs')).toBeInTheDocument();
    expect(within(table).getByText('Start runs')).toBeInTheDocument();
    expect(within(table).getByText('Org Alpha')).toBeInTheDocument();
    expect(within(table).getByText('Never')).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    mountPage({ 'GET /oauth/grants': [] });
    expect(await screen.findByText('No apps are connected.')).toBeInTheDocument();
  });

  it('says the server is off when the API answers 404', async () => {
    mountPage({
      'GET /oauth/grants': () => {
        throw createTestApiError(404, 'Not Found');
      },
    });
    expect(await screen.findByText('Connecting other apps is switched off on this deployment.')).toBeInTheDocument();
  });

  it('Disconnect asks first, then calls DELETE and re-reads', async () => {
    const user = userEvent.setup();
    let listed = [GRANT];
    const { host } = mountPage(
      {
        'GET /oauth/grants': () => listed,
        [`DELETE /oauth/grants/${GRANT.id}`]: () => {
          listed = [];
          return undefined;
        },
      },
      true,
    );
    await screen.findAllByText('Example Assistant');
    const disconnect = (await screen.findAllByRole('button', { name: /Disconnect/ }))[0]!;
    await user.click(disconnect);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/will stop working at once. You can connect it again later./)).toBeInTheDocument();
    expect(host.requests.some((request) => request.method === 'DELETE')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() =>
      expect(host.requests.find((request) => request.method === 'DELETE')?.path).toBe(`/oauth/grants/${GRANT.id}`),
    );
    expect(await screen.findByText('No apps are connected.')).toBeInTheDocument();
  });
});
