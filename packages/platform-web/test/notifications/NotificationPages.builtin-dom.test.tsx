/**
 * The notification pages' markup did not move (PP-14.24).
 *
 * `BroadcastsPage`, `PushConfigPage`, `UserNotificationsPage` and
 * `NotificationSettingsPage` gained the page-slot contract (`PageSlotsBase`).
 * The snapshot beside this file (`__snapshots__/`) was RECORDED FROM THE PAGES
 * AS THEY WERE BEFORE THAT CHANGE (the same fixtures, rendered by the old
 * pages), so passing means what an administrator or a user sees with no slot
 * passed is, element for element and class for class, what they had.
 * (`NotificationSettingsPage` is also pinned by `NotificationsUi.builtin-dom`.)
 *
 * The only normalisation is React's and MUI's generated ids and locale dates.
 * Re-record only for a deliberate change of a page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { mockAdminUser, render } from './test-utils.js';
import { WithMenuTable } from './menu-table.js';
import type { Broadcast } from '../../src/notifications/headless/broadcasts.js';
import type { NotificationConfigResponse, NotificationEventDef } from '../../src/notifications/headless/types.js';
import type { PushConfigAdminView } from '../../src/notifications/headless/pushConfig.js';

vi.mock('../../src/notifications/headless/useBroadcasts.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/notifications/headless/useBroadcasts.js')>(
    '../../src/notifications/headless/useBroadcasts.js',
  );
  return { ...actual, useBroadcasts: vi.fn(), useBroadcastActions: vi.fn(), useVisiblePolling: vi.fn() };
});
vi.mock('../../src/notifications/headless/useNotificationChannels.js', () => ({ useNotificationChannels: vi.fn() }));
vi.mock('../../src/notifications/headless/broadcasts.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/notifications/headless/broadcasts.js')>(
    '../../src/notifications/headless/broadcasts.js',
  );
  return { ...actual, getBroadcastAudience: vi.fn(), getBroadcast: vi.fn(), getBroadcasts: vi.fn() };
});
vi.mock('../../src/notifications/headless/usePushConfig.js', () => ({ usePushConfig: vi.fn() }));
vi.mock('../../src/notifications/ui/PushTestPanel.js', () => ({
  PushTestPanel: ({ canWrite }: { canWrite: boolean }) => <div data-testid="push-test-panel" data-can-write={String(canWrite)} />,
}));
vi.mock('../../src/settings/headless/use-user-settings.js', () => ({ useUserSettings: vi.fn() }));
vi.mock('../../src/notifications/headless/useNotificationEvents.js', () => ({ useNotificationEvents: vi.fn() }));
vi.mock('../../src/notifications/headless/useNotificationCapability.js', () => ({ useNotificationCapability: vi.fn() }));
vi.mock('../../src/notifications/headless/useNotificationConfig.js', () => ({ useNotificationConfig: vi.fn() }));

import { useBroadcastActions, useBroadcasts, useVisiblePolling } from '../../src/notifications/headless/useBroadcasts.js';
import { getBroadcastAudience } from '../../src/notifications/headless/broadcasts.js';
import { useNotificationChannels } from '../../src/notifications/headless/useNotificationChannels.js';
import { usePushConfig } from '../../src/notifications/headless/usePushConfig.js';
import { useUserSettings } from '../../src/settings/headless/use-user-settings.js';
import { useNotificationEvents } from '../../src/notifications/headless/useNotificationEvents.js';
import { useNotificationCapability } from '../../src/notifications/headless/useNotificationCapability.js';
import { useNotificationConfig } from '../../src/notifications/headless/useNotificationConfig.js';
import { channelsHookReturn } from './channels-fixture.js';
import BroadcastsPage from '../../src/notifications/ui/BroadcastsPage.js';
import PushConfigPage from '../../src/notifications/ui/PushConfigPage.js';
import UserNotificationsPage from '../../src/notifications/ui/UserNotificationsPage.js';

const html = (root: Element): string =>
  root.innerHTML
    .replace(/_r_[0-9a-z]+_/g, '_rX_')
    .replace(/:r[0-9a-z]+:/g, ':rX:')
    .replace(/\d+\/\d+\/\d{4}, [\d:]+ [AP]M/g, '<date>');

const BROADCAST: Broadcast = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Planned maintenance tonight',
  body: 'We will be offline from 01:00.',
  link: null,
  ctaLabel: null,
  eventKey: 'admin.broadcast',
  channels: ['browser', 'email'],
  status: 'scheduled',
  scheduledFor: '2026-06-15T22:00:00.000Z',
  startedAt: null,
  finishedAt: null,
  canceledAt: null,
  audienceCutoff: null,
  recipientsTargeted: null,
  recipientsDispatched: 0,
  lastError: null,
  createdById: 'admin-user-id',
  targetOrgId: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
};

const PUSH: PushConfigAdminView = {
  enabled: true,
  configured: true,
  publicKey: 'BEol6Zy8example-public-vapid-key-value-9f8e',
  subject: 'mailto:ops@example.com',
  privateKeyStatus: { configured: true, hint: '••••ab12', updatedAt: '2026-01-01T00:00:00.000Z', updatedByUserId: 'admin-user-id' },
  settingsError: null,
  version: 3,
  updatedAt: '2026-01-01T00:00:00.000Z',
  updatedBy: { id: 'admin-user-id', email: 'admin@example.com' },
};

const EVENTS: NotificationEventDef[] = [
  {
    key: 'user.welcome',
    label: 'Welcome',
    description: 'Sent once, the first time you sign in to this application.',
    channels: ['email'],
    declaredChannels: ['email'],
    defaultEnabled: true,
    mandatory: false,
  },
  {
    key: 'security.role_changed',
    label: 'Your roles changed',
    description: 'Sent when an administrator changes your roles.',
    channels: ['email', 'browser'],
    declaredChannels: ['email', 'browser'],
    defaultEnabled: true,
    mandatory: true,
  },
];

function pushHook(config: PushConfigAdminView | null) {
  vi.mocked(usePushConfig).mockReturnValue({
    config,
    isLoading: false,
    loadError: null,
    isSaving: false,
    saveError: null,
    save: vi.fn().mockResolvedValue(true),
    clearSaveError: vi.fn(),
    isActing: false,
    actionError: null,
    clearActionError: vi.fn(),
    generate: vi.fn().mockResolvedValue(true),
    rotate: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(true),
    refresh: vi.fn(),
  } as unknown as ReturnType<typeof usePushConfig>);
}

describe("the notification pages' markup is unchanged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useNotificationChannels).mockReturnValue(channelsHookReturn());
    const config: NotificationConfigResponse = { browserEnabled: true, pushEnabled: false, vapidPublicKey: null };
    vi.mocked(useNotificationConfig).mockReturnValue({ config, isLoading: false, error: null, refresh: vi.fn() });
  });

  it('the broadcasts page, writable and read-only', async () => {
    vi.mocked(getBroadcastAudience).mockResolvedValue({ activeUsers: 1284 });
    vi.mocked(useBroadcasts).mockReturnValue({
      broadcasts: [BROADCAST],
      total: 1,
      isLoading: false,
      error: null,
      fetchBroadcasts: vi.fn(),
      refresh: vi.fn(),
    });
    vi.mocked(useVisiblePolling).mockReturnValue(undefined as never);
    vi.mocked(useBroadcastActions).mockReturnValue({
      isWorking: false,
      error: null,
      clearError: vi.fn(),
      create: vi.fn(),
      cancel: vi.fn(),
      resume: vi.fn(),
      remove: vi.fn(),
      sendTest: vi.fn(),
    } as unknown as ReturnType<typeof useBroadcastActions>);

    const writable = render(
      <WithMenuTable>
        <BroadcastsPage />
      </WithMenuTable>,
      { wrapperOptions: { user: { ...mockAdminUser, permissions: ['broadcasts:read', 'broadcasts:write'] } } },
    );
    await screen.findByText('Planned maintenance tonight');
    expect(html(writable.container)).toMatchSnapshot();
    writable.unmount();

    const readOnly = render(
      <WithMenuTable>
        <BroadcastsPage />
      </WithMenuTable>,
      { wrapperOptions: { user: { ...mockAdminUser, permissions: ['broadcasts:read'] } } },
    );
    await screen.findByText('Planned maintenance tonight');
    expect(html(readOnly.container)).toMatchSnapshot();
  });

  it('the web push page, configured and not configured', () => {
    pushHook(PUSH);
    const configured = render(<PushConfigPage />, {
      wrapperOptions: { user: { ...mockAdminUser, permissions: ['push:read', 'push:write'] } },
    });
    expect(html(configured.container)).toMatchSnapshot();
    configured.unmount();

    pushHook({
      ...PUSH,
      enabled: false,
      configured: false,
      publicKey: null,
      subject: null,
      privateKeyStatus: { configured: false, hint: null, updatedAt: null, updatedByUserId: null },
      version: 0,
      updatedAt: null,
      updatedBy: null,
    });
    const empty = render(<PushConfigPage />, {
      wrapperOptions: { user: { ...mockAdminUser, permissions: ['push:read'] } },
    });
    expect(html(empty.container)).toMatchSnapshot();
  });

  it('the notifications preferences page', () => {
    vi.mocked(useUserSettings as unknown as (...args: unknown[]) => unknown).mockReturnValue({
      settings: { theme: 'system', profile: { imageSource: 'provider' }, updatedAt: '2026-10-01T00:00:00.000Z', version: 1 },
      isLoading: false,
      error: null,
      isSaving: false,
      updateSettings: vi.fn().mockResolvedValue(undefined),
      updateTheme: vi.fn(),
      updateProfile: vi.fn(),
      refresh: vi.fn(),
      replaceSettings: vi.fn(),
    });
    vi.mocked(useNotificationEvents).mockReturnValue({ events: EVENTS, isLoading: false, error: null, refresh: vi.fn() });
    vi.mocked(useNotificationCapability).mockReturnValue({ capability: 'granted', permission: 'granted', refresh: vi.fn() });
    const { container } = render(<UserNotificationsPage />);
    expect(html(container)).toMatchSnapshot();
  });
});
