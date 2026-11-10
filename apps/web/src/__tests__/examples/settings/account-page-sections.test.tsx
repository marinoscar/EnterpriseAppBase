/**
 * PP-14.24: an app adds sections of its own to the packaged Profile, Appearance
 * and Organization settings pages through `slots.Sections`, with no package
 * edit.
 *
 * `apps/web/src/platform-extensions/settings/AccountExtras.example.tsx` is the
 * example. This renders the REAL packaged pages over MSW and asserts each card
 * lands at the end of the page the example chooses, and that the page without
 * the slot draws none.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { OrgSettingsPage, UserAppearancePage, UserProfilePage } from '@marinoscar/platform-web/settings/ui';
import { render, mockAdminUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import {
  BillingContactCard,
  DensityCard,
  TimezoneCard,
} from '../../../platform-extensions/settings/AccountExtras.example';

describe('the settings pages with app Sections slots (PP-14.24)', () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  it('the Profile page draws the time zone card after the profile card', async () => {
    render(<UserProfilePage slots={{ Sections: TimezoneCard }} />);
    const card = await screen.findByRole('region', { name: 'Time zone' });
    const display = await screen.findByLabelText(/display name/i);
    expect(display.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the Appearance page draws the density card above the theme card', async () => {
    render(<UserAppearancePage slots={{ Sections: DensityCard }} />);
    const card = await screen.findByRole('region', { name: 'Density' });
    const heading = screen.getByRole('heading', { level: 1, name: 'Appearance' });
    expect(heading.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the pages without slots draw no such card', async () => {
    render(<UserAppearancePage />);
    await screen.findByRole('heading', { level: 1, name: 'Appearance' });
    expect(screen.queryByRole('region', { name: 'Density' })).not.toBeInTheDocument();
  });

  it('the Organization settings page draws the billing contact card after the namespace cards', async () => {
    server.use(
      http.get('*/api/org-settings', () =>
        HttpResponse.json({
          data: {
            orgId: '11111111-1111-4111-8111-111111111111',
            value: {},
            effective: { exportPolicy: { enabled: false } },
            version: 1,
            updatedAt: '2026-10-08T00:00:00.000Z',
            namespaces: [
              {
                key: 'exportPolicy',
                description: 'Whether data exports are allowed.',
                merge: 'tighten',
                writable: true,
                fields: [{ name: 'enabled', kind: 'boolean' }],
              },
            ],
          },
        }),
      ),
    );
    render(<OrgSettingsPage slots={{ Sections: BillingContactCard }} />, {
      wrapperOptions: { user: { ...mockAdminUser, permissions: ['org_settings:read', 'org_settings:write'] } },
    });
    const card = await screen.findByRole('region', { name: 'Billing contact' });
    const namespace = await screen.findByRole('heading', { name: 'exportPolicy' });
    expect(namespace.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
