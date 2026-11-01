/**
 * The settings pages' markup did not move (PP-14.24).
 *
 * `UserProfilePage`, `UserAppearancePage` and `OrgSettingsPage` gained the
 * page-slot contract (`PageSlotsBase`). The snapshot beside this file
 * (`__snapshots__/`) was RECORDED FROM THE PAGES AS THEY WERE BEFORE THAT CHANGE
 * (the same fixtures, rendered by the old pages), so passing means what a user
 * or an organization administrator sees with no slot passed is, element for
 * element and class for class, what they had.
 *
 * The only normalisations are React's and MUI's generated ids and the live
 * time zone read-out. Re-record only for a deliberate change of a page (the
 * profile page was re-recorded once, for its core time zone row).
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { OrgSettingsResponse } from '@marinoscar/platform-contract/settings';

import { mockUser, render } from './test-utils.js';
import { OrgSettingsPage } from '../../../src/settings/ui/OrgSettingsPage.js';
import { UserAppearancePage } from '../../../src/settings/ui/UserAppearancePage.js';
import { UserProfilePage } from '../../../src/settings/ui/UserProfilePage.js';
import { createTestPlatformHost } from '../../../src/testing/index.js';

// The profile card's time zone read-out names the device's zone and the
// current time, so it is normalised too.
const html = (root: Element): string =>
  root.innerHTML
    .replace(/_r_[0-9a-z]+_/g, '_rX_')
    .replace(/:r[0-9a-z]+:/g, ':rX:')
    .replace(/(data-testid="time-zone-readout">)[^<]*/g, '$1READOUT');

const USER_SETTINGS = {
  theme: 'dark',
  profile: { displayName: 'Test User', imageSource: 'provider', imageObjectId: null },
  updatedAt: '2026-10-01T00:00:00.000Z',
  version: 4,
};

const ORG_SETTINGS: OrgSettingsResponse = {
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

describe("the settings pages' markup is unchanged", () => {
  it('the profile page', async () => {
    const host = createTestPlatformHost({
      permissions: mockUser.permissions,
      responses: { 'GET /user-settings': USER_SETTINGS, 'GET /storage/status': { configured: false } },
    });
    const { container } = render(<UserProfilePage />, { wrapperOptions: { host } });
    await screen.findByRole('heading', { level: 1, name: 'Profile' });
    await screen.findByLabelText(/display name/i);
    expect(html(container)).toMatchSnapshot();
  });

  it('the appearance page', async () => {
    const host = createTestPlatformHost({ permissions: mockUser.permissions, responses: { 'GET /user-settings': USER_SETTINGS } });
    const { container } = render(<UserAppearancePage />, { wrapperOptions: { host } });
    await screen.findByRole('heading', { level: 1, name: 'Appearance' });
    await screen.findByRole('button', { name: /dark/i });
    expect(html(container)).toMatchSnapshot();
  });

  it('the organization settings page, writable and read-only', async () => {
    const orgUser = {
      ...mockUser,
      roles: [{ name: 'org_admin' }],
      tenancyMode: 'multi' as const,
      activeOrg: { id: 'org-a', name: 'Alpha', slug: 'alpha' },
      memberships: [{ orgId: 'org-a', name: 'Alpha', slug: 'alpha', role: 'org_admin' as const }],
    };
    const writable = render(<OrgSettingsPage />, {
      wrapperOptions: {
        user: { ...orgUser, permissions: ['org_settings:read', 'org_settings:write'] },
        host: createTestPlatformHost({
          permissions: ['org_settings:read', 'org_settings:write'],
          responses: { 'GET /org-settings': ORG_SETTINGS },
        }),
      },
    });
    await screen.findByText('exportPolicy');
    expect(html(writable.container)).toMatchSnapshot();
    writable.unmount();

    const readOnly = render(<OrgSettingsPage />, {
      wrapperOptions: {
        user: { ...orgUser, permissions: ['org_settings:read'] },
        host: createTestPlatformHost({ permissions: ['org_settings:read'], responses: { 'GET /org-settings': ORG_SETTINGS } }),
      },
    });
    await screen.findByText('exportPolicy');
    expect(html(readOnly.container)).toMatchSnapshot();
  });
});
