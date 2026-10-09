/**
 * `OrgSettingsPage` (#733, PP-8.1): the active organization's
 * settings overrides, as a form generated from the namespace descriptors of
 * `GET /api/org-settings`. Controls are disabled without `org_settings:write`
 * (and on a namespace the caller may not write); a save PATCHes only that
 * namespace, with the loaded version as `If-Match`.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { OrgSettingsResponse } from '@marinoscar/platform-contract/settings';

import { render, mockUser, type MockUser } from './test-utils.js';
import { OrgSettingsPage } from '../../../src/settings/ui/OrgSettingsPage.js';
import { createTestPlatformHost } from '../../../src/testing/index.js';
import type { TestPlatformHost } from '../../../src/testing/index.js';

const PAYLOAD: OrgSettingsResponse = {
  orgId: '11111111-1111-4111-8111-111111111111',
  value: { exportPolicy: { enabled: false } },
  effective: { exportPolicy: { enabled: false, maxRows: 10000 }, workspaceLabel: { label: 'Workspace', accent: 'blue' } },
  version: 3,
  updatedAt: '2026-10-08T00:00:00.000Z',
  namespaces: [
    {
      key: 'exportPolicy',
      description: 'Whether data exports are allowed.',
      merge: 'tighten',
      writable: true,
      fields: [
        { name: 'enabled', kind: 'boolean' },
        { name: 'maxRows', kind: 'number', min: 1, max: 1000000, integer: true },
        { name: 'columns', kind: 'other' },
      ],
    },
    {
      key: 'workspaceLabel',
      description: 'The name the application shows.',
      merge: 'override',
      writable: false,
      fields: [
        { name: 'label', kind: 'string', maxLength: 60 },
        { name: 'accent', kind: 'enum', options: ['blue', 'green', 'purple'] },
      ],
    },
  ],
};

function orgAdmin(permissions: string[]): MockUser {
  return {
    ...mockUser,
    roles: [{ name: 'org_admin' }],
    permissions,
    tenancyMode: 'multi',
    activeOrg: { id: 'org-a', name: 'Alpha', slug: 'alpha' },
    memberships: [{ orgId: 'org-a', name: 'Alpha', slug: 'alpha', role: 'org_admin' }],
  };
}

let host: TestPlatformHost;

function renderPage(permissions: string[]) {
  const user = orgAdmin(permissions);
  host = createTestPlatformHost({
    permissions,
    userId: user.id,
    responses: {
      'GET /org-settings': PAYLOAD,
      'PATCH /org-settings': { ...PAYLOAD, version: PAYLOAD.version + 1 },
    },
  });
  return render(<OrgSettingsPage />, {
    wrapperOptions: { route: '/admin/settings/organization-settings', user, host },
  });
}

/** The PATCHes the page sent, as `{ body, ifMatch }`. */
function patches(): Array<{ body: unknown; ifMatch: string | undefined }> {
  return host.requests
    .filter((request) => request.method === 'PATCH')
    .map((request) => ({ body: request.body, ifMatch: request.ifMatch }));
}

describe('OrgSettingsPage (#733)', () => {
  it('renders one generated card per namespace, with the effective values', async () => {
    renderPage(['org_settings:read', 'org_settings:write']);
    expect(await screen.findByRole('heading', { name: 'exportPolicy' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'workspaceLabel' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'maxRows' })).toHaveValue(10000);
    expect(screen.getByRole('textbox', { name: 'label' })).toHaveValue('Workspace');
    expect(screen.getByText(/columns: managed by the slice's own settings page/)).toBeInTheDocument();
    expect(screen.getByText('Customised')).toBeInTheDocument();
  });

  it('disables every control without org_settings:write', async () => {
    renderPage(['org_settings:read']);
    await screen.findByRole('heading', { name: 'exportPolicy' });
    expect(screen.getByText(/requires org_settings:write/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'enabled' })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: 'maxRows' })).toBeDisabled();
    for (const button of screen.getAllByRole('button', { name: 'Save' })) expect(button).toBeDisabled();
  });

  it('keeps a namespace the caller may not write read-only, even with org_settings:write', async () => {
    renderPage(['org_settings:read', 'org_settings:write']);
    await screen.findByRole('heading', { name: 'workspaceLabel' });
    expect(screen.getByRole('textbox', { name: 'label' })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: 'maxRows' })).toBeEnabled();
  });

  it('saves one namespace with the loaded version as If-Match', async () => {
    const user = userEvent.setup();
    renderPage(['org_settings:read', 'org_settings:write']);
    const maxRows = await screen.findByRole('spinbutton', { name: 'maxRows' });
    await user.clear(maxRows);
    await user.type(maxRows, '500');
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]!);
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]).toEqual({ body: { exportPolicy: { maxRows: 500 } }, ifMatch: '3' });
  });

  it('clears a namespace override back to the deployment values', async () => {
    const user = userEvent.setup();
    renderPage(['org_settings:read', 'org_settings:write']);
    await screen.findByRole('heading', { name: 'exportPolicy' });
    await user.click(screen.getAllByRole('button', { name: 'Use the deployment values' })[0]!);
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]!.body).toEqual({ exportPolicy: null });
  });
});
