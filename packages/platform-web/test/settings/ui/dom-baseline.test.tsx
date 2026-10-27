/**
 * The DOM of the packaged settings controls with no slot, no registered
 * renderer and no extra theme (PP-14.21). The snapshots were recorded from the
 * components BEFORE the `ExtraFields` slots, the org field renderers and the
 * theme options were added: a change here is a change to what every app that
 * does not use them renders, which must not happen. Re-recorded once, for a
 * deliberate change: the core time zone row of the profile card (its live
 * read-out, which depends on the clock and the device zone, is normalised).
 */
import { describe, it, expect, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import type { OrgSettingsResponse } from '@marinoscar/platform-contract/settings';

import { render, mockUser } from './test-utils.js';
import { OrgSettingsPage } from '../../../src/settings/ui/OrgSettingsPage.js';
import { ProfileSettings } from '../../../src/settings/ui/ProfileSettings.js';
import { ThemeSettings } from '../../../src/settings/ui/ThemeSettings.js';
import { createTestPlatformHost } from '../../../src/testing/index.js';

/** The time zone read-out names the device's zone and the current time: neither is stable. */
const stable = (markup: string): string => markup.replace(/(data-testid="time-zone-readout">)[^<]*/g, '$1READOUT');

vi.mock('../../../src/settings/headless/profile-image.js', () => ({
  useProfileImageClient: () => ({ upload: vi.fn(), remove: vi.fn(), preview: vi.fn() }),
}));

const PAYLOAD: OrgSettingsResponse = {
  orgId: '11111111-1111-4111-8111-111111111111',
  value: { exportPolicy: { enabled: false } },
  effective: { exportPolicy: { enabled: false, maxRows: 10000, columns: { a: 1 } } },
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
        { name: 'label', kind: 'string', maxLength: 20 },
        { name: 'accent', kind: 'enum', options: ['blue', 'green'] },
        { name: 'columns', kind: 'other' },
      ],
    },
  ],
};

describe('settings controls without slots: the DOM is unchanged', () => {
  it('ThemeSettings', () => {
    const { container } = render(<ThemeSettings currentTheme="dark" onThemeChange={() => undefined} />);
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('ThemeSettings, disabled', () => {
    const { container } = render(<ThemeSettings currentTheme="system" onThemeChange={() => undefined} disabled />);
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('ProfileSettings', () => {
    const { container } = render(
      <ProfileSettings profile={{ displayName: 'Ada', imageSource: 'none', imageObjectId: null }} onSave={async () => undefined} />,
      { wrapperOptions: { user: { ...mockUser, providerProfileImageUrl: null } } },
    );
    expect(stable(container.innerHTML)).toMatchSnapshot();
  });

  it('OrgSettingsPage', async () => {
    const host = createTestPlatformHost({
      permissions: ['org_settings:read', 'org_settings:write'],
      userId: mockUser.id,
      responses: { 'GET /org-settings': PAYLOAD },
    });
    const user = { ...mockUser, permissions: ['org_settings:read', 'org_settings:write'] };
    const { container, findByRole } = render(<OrgSettingsPage />, { wrapperOptions: { route: '/admin/settings/organization-settings', user, host } });
    await findByRole('heading', { name: 'exportPolicy' });
    await waitFor(() => expect(container.querySelector('input[type="number"]')).not.toBeNull());
    expect(container.innerHTML).toMatchSnapshot();
  });
});
