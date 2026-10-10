/**
 * Issue #928 (PP-14.10): a channel an app registered shows up in the broadcast
 * composer, the preferences matrix and the admin Notifications page with no web
 * code.
 *
 * The reference app registers `webhook`
 * (apps/api/src/platform-extensions/notifications/) with
 * `registerNotificationChannel` and puts it on the broadcast events. The API
 * describes every channel in `GET /api/notifications/channels`; the packaged
 * pages draw from that, so the bundle holds no list of channels. Nothing is
 * mocked but the network (MSW).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { BroadcastsPage, NotificationSettingsPage, UserNotificationsPage } from '@marinoscar/platform-web/notifications/ui';
import '../../../platform/notifications';
import { render, mockAdminUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import { referenceChannels } from '../../mocks/fixtures/notifications';

const emptyList = { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };

describe('the webhook channel in the notification pages (#928)', () => {
  beforeEach(() => {
    server.resetHandlers();
    server.use(
      http.get('*/api/notifications/channels', () => HttpResponse.json({ data: referenceChannels })),
      http.get('*/api/notifications/config', () =>
        HttpResponse.json({ data: { browserEnabled: true, pushEnabled: true, vapidPublicKey: 'key' } }),
      ),
      http.get('*/api/admin/broadcasts/audience', () => HttpResponse.json({ data: { activeUsers: 12 } })),
      http.get('*/api/admin/broadcasts', () => HttpResponse.json({ data: emptyList })),
    );
  });

  it('offers the channel in the broadcast composer with its label, unselected, and not the Android channel', async () => {
    const user = userEvent.setup();
    render(<BroadcastsPage />, { wrapperOptions: { user: mockAdminUser } });

    await user.click(await screen.findByRole('button', { name: /new broadcast/i }));

    expect(await screen.findByRole('checkbox', { name: 'Webhook' })).not.toBeChecked();
    // The platform's own channels keep their wording and their defaults.
    expect(screen.getByRole('checkbox', { name: 'In-app' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Email' })).toBeChecked();
    // `android_app` is registered but the broadcast events do not declare it.
    expect(screen.queryByRole('checkbox', { name: 'Android app' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Webhook' }));
    expect(screen.getByRole('checkbox', { name: 'Webhook' })).toBeChecked();
  });

  it('lists the channel in the preferences matrix of an event that declares it', async () => {
    server.use(
      http.get('*/api/notifications/events', () =>
        HttpResponse.json({
          data: [
            {
              key: 'admin.broadcast',
              label: 'Announcements',
              description: 'Occasional messages an administrator sends to everyone using this application.',
              channels: ['email', 'browser', 'push', 'webhook'],
              declaredChannels: ['email', 'browser', 'push', 'webhook'],
              defaultEnabled: true,
              mandatory: false,
            },
          ],
        }),
      ),
    );
    render(<UserNotificationsPage />, { wrapperOptions: { user: mockAdminUser } });

    expect(await screen.findByRole('switch', { name: 'Webhook notifications for Announcements' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Email notifications for Announcements' })).toBeInTheDocument();
  });

  it('gives the channel a switch on the admin Notifications page, beside the browser switch', async () => {
    server.use(
      http.get('*/api/notifications/events', () => HttpResponse.json({ data: [] })),
      http.get('*/api/system-settings', () =>
        HttpResponse.json({
          data: {
            notifications: { browserEnabled: true, disabledEvents: [] },
            updatedAt: '2026-01-01T00:00:00.000Z',
            updatedBy: null,
            version: 3,
          },
        }),
      ),
    );
    render(<NotificationSettingsPage />, { wrapperOptions: { user: mockAdminUser } });

    expect(await screen.findByRole('switch', { name: 'Deliver Webhook notifications' })).toBeChecked();
    // The platform channels have no switch here: Email and Push have pages of their own.
    await waitFor(() => expect(screen.getByText('Delivery channels')).toBeInTheDocument());
    expect(screen.queryByRole('switch', { name: 'Deliver Email notifications' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Deliver Android app notifications' })).toBeInTheDocument();
  });
});
