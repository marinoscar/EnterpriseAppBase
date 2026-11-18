/**
 * PP-14.24: an app adds its own section to the packaged admin Android page
 * through `slots.Sections`, and reuses the page's exported sections, with no
 * package edit.
 *
 * `apps/web/src/platform-extensions/android-app/StoreListingChecklist.example.tsx`
 * is the example. This renders the REAL packaged page over MSW responses for
 * the routes it reads.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { AndroidAppPage } from '@marinoscar/platform-web/android-app/ui';
import { render, mockAdminUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import {
  NotificationsOnlyPage,
  StoreListingChecklist,
} from '../../../platform-extensions/android-app/StoreListingChecklist.example';

describe('the admin Android page with an app Sections slot (PP-14.24)', () => {
  beforeEach(() => {
    server.resetHandlers();
    server.use(
      http.get('*/api/admin/android-app', () =>
        HttpResponse.json({
          data: {
            trustedApps: [],
            reportedApps: [],
            assetLinks: [],
            pushSubscriptions: { androidApp: 0, browser: 0, androidAppUsers: 0 },
          },
        }),
      ),
      http.get('*/api/admin/android-app/releases', () => HttpResponse.json({ data: [] })),
    );
  });

  it('draws the checklist once, after the three built-in sections', async () => {
    render(<AndroidAppPage slots={{ Sections: StoreListingChecklist }} />, { wrapperOptions: { user: mockAdminUser } });

    const checklist = await screen.findByRole('region', { name: 'Store listing checklist' });
    expect(within(checklist).getAllByRole('listitem')).toHaveLength(3);
    const notifications = screen.getByRole('region', { name: 'Notifications' });
    expect(notifications.compareDocumentPosition(checklist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws no checklist without the slot', async () => {
    render(<AndroidAppPage />, { wrapperOptions: { user: mockAdminUser } });
    await screen.findByRole('region', { name: 'Notifications' });
    expect(screen.queryByRole('region', { name: 'Store listing checklist' })).not.toBeInTheDocument();
  });

  it('lets an app put the exported Notifications section on a page of its own', async () => {
    render(<NotificationsOnlyPage canWrite />, { wrapperOptions: { user: mockAdminUser } });
    expect(await screen.findByRole('button', { name: 'Send me a test notification' })).toBeEnabled();
    expect(screen.queryByRole('region', { name: 'Trusted apps' })).not.toBeInTheDocument();
  });
});
