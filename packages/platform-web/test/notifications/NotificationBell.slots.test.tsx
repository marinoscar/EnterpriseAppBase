// The bell's slots (#738): app content inside the packaged popover. Without
// a slot the bell renders exactly as before (NotificationBell.test.tsx).
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Button, Chip } from '@mui/material';

import { render } from './test-utils.js';
import type { NotificationContextValue } from '../../src/notifications/headless/index.js';

const useNotificationsMock = vi.fn<() => NotificationContextValue | null>();
vi.mock('../../src/notifications/headless/NotificationContext.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/notifications/headless/NotificationContext.js')>()),
  useNotifications: () => useNotificationsMock(),
}));

import { NotificationBell } from '../../src/notifications/ui/index.js';

function centre(overrides: Partial<NotificationContextValue> = {}): NotificationContextValue {
  return {
    notifications: [],
    unreadCount: 0,
    isLoading: false,
    error: null,
    streamState: 'open',
    refresh: vi.fn().mockResolvedValue(undefined),
    markRead: vi.fn().mockResolvedValue(undefined),
    markAllRead: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('NotificationBell slots', () => {
  it('replaces the empty-inbox text with the emptyState slot', async () => {
    const user = userEvent.setup();
    useNotificationsMock.mockReturnValue(centre());
    render(<NotificationBell slots={{ emptyState: <p>Nothing here yet</p> }} />);
    await user.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.queryByText(/all caught up/i)).not.toBeInTheDocument();
  });

  it('renders the footer slot under the list, with a close helper', async () => {
    const user = userEvent.setup();
    useNotificationsMock.mockReturnValue(centre());
    render(<NotificationBell slots={{ footer: ({ close }) => <Button onClick={close}>Done</Button> }} />);
    await user.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: /notifications/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('adds itemExtra content to each row', async () => {
    const user = userEvent.setup();
    useNotificationsMock.mockReturnValue(
      centre({
        notifications: [
          { id: 'n1', eventKey: 'billing.invoice_ready', title: 'Invoice ready', body: 'March', link: null, readAt: null, createdAt: new Date().toISOString() },
        ],
        unreadCount: 1,
      }),
    );
    render(<NotificationBell slots={{ itemExtra: (n) => <Chip label={n.eventKey.split('.')[0]} /> }} />);
    await user.click(screen.getByRole('button', { name: /notifications, 1 unread/i }));
    expect(screen.getByText('billing')).toBeInTheDocument();
  });

  it('keeps the default empty text without slots', async () => {
    const user = userEvent.setup();
    useNotificationsMock.mockReturnValue(centre());
    render(<NotificationBell />);
    await user.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
  });
});
