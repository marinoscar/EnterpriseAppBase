/**
 * PP-14.24: an app puts notices of its own on the packaged notification pages
 * through `slots`, with no package edit.
 *
 * `apps/web/src/platform-extensions/notifications/NotificationNotices.example.tsx`
 * is the example. This renders the REAL packaged pages over MSW and asserts each
 * notice lands where the contract names, and that the page without the slot
 * draws none.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { BroadcastsPage, PushConfigPage, UserNotificationsPage } from '@marinoscar/platform-web/notifications/ui';
import '../../../platform/notifications';
import { render, mockAdminUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import { referenceChannels } from '../../mocks/fixtures/notifications';
import {
  ApprovalReminder,
  KeyRotationSection,
  QuietHoursNotice,
} from '../../../platform-extensions/notifications/NotificationNotices.example';

const emptyList = { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };

describe('the notification pages with app slots (PP-14.24)', () => {
  beforeEach(() => {
    server.resetHandlers();
    server.use(
      http.get('*/api/notifications/channels', () => HttpResponse.json({ data: referenceChannels })),
      http.get('*/api/notifications/config', () =>
        HttpResponse.json({ data: { browserEnabled: true, pushEnabled: true, vapidPublicKey: 'key' } }),
      ),
      http.get('*/api/notifications/events', () => HttpResponse.json({ data: [] })),
      http.get('*/api/admin/broadcasts/audience', () => HttpResponse.json({ data: { activeUsers: 12 } })),
      http.get('*/api/admin/broadcasts', () => HttpResponse.json({ data: emptyList })),
      http.get('*/api/admin/push-config', () =>
        HttpResponse.json({
          data: {
            enabled: false,
            configured: false,
            publicKey: null,
            subject: null,
            privateKeyStatus: { configured: false, hint: null, updatedAt: null, updatedByUserId: null },
            settingsError: null,
            version: 0,
            updatedAt: null,
            updatedBy: null,
          },
        }),
      ),
    );
  });

  it('the preferences page draws the quiet hours notice under its title', async () => {
    render(<UserNotificationsPage slots={{ BeforeContent: QuietHoursNotice }} />, { wrapperOptions: { user: mockAdminUser } });
    const notice = await screen.findByTestId('quiet-hours-notice');
    const heading = screen.getByRole('heading', { level: 1, name: 'Notifications' });
    expect(heading.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the Broadcasts page draws the approval reminder above the New broadcast button', async () => {
    render(<BroadcastsPage slots={{ BeforeContent: ApprovalReminder }} />, { wrapperOptions: { user: mockAdminUser } });
    const reminder = await screen.findByTestId('approval-reminder');
    const button = await screen.findByRole('button', { name: /new broadcast/i });
    expect(reminder.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the Web Push page draws the key rotation section once, at the bottom', async () => {
    render(<PushConfigPage slots={{ Sections: KeyRotationSection }} />, { wrapperOptions: { user: mockAdminUser } });
    expect(await screen.findByRole('region', { name: 'Key rotation policy' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'Key rotation policy' })).toHaveLength(1);
  });

  it('draw none of it without the slots', async () => {
    render(<BroadcastsPage />, { wrapperOptions: { user: mockAdminUser } });
    await screen.findByRole('button', { name: /new broadcast/i });
    expect(screen.queryByTestId('approval-reminder')).not.toBeInTheDocument();
  });
});
