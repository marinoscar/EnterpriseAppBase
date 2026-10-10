/**
 * The notifications pages' built-in markup did not move (PP-14.10).
 *
 * The channel labels, the broadcast composer's channel list and its defaults,
 * and the preferences matrix's push banner stopped being constants in the
 * bundle and are drawn from the channel descriptors the API serves
 * (`GET /api/notifications/channels`). The snapshot beside this file
 * (`__snapshots__/`) was RECORDED FROM THE PAGES AS THEY WERE BEFORE THAT
 * CHANGE (the same fixtures, rendered by the old components), so passing means
 * that with only the three built-in channels the markup an administrator or a
 * user sees is, element for element and class for class, the one they had.
 *
 * The only normalisation is React's generated ids (`:r1:`), which depend on
 * render order. Re-record the snapshot only for a deliberate change of the
 * built-in markup.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockAdminUser, render } from './test-utils.js';
import { BroadcastComposer } from '../../src/notifications/ui/BroadcastComposer.js';
import { NotificationSettings } from '../../src/notifications/ui/NotificationSettings.js';
import NotificationSettingsPage from '../../src/notifications/ui/NotificationSettingsPage.js';
import type {
  NotificationCapability,
} from '../../src/notifications/headless/useNotificationCapability.js';
import type {
  NotificationConfigResponse,
  NotificationEventDef,
} from '../../src/notifications/headless/types.js';

vi.mock('../../src/notifications/headless/useNotificationConfig.js', () => ({ useNotificationConfig: vi.fn() }));
vi.mock('../../src/settings/headless/use-system-settings.js', () => ({ useSystemSettings: vi.fn() }));
vi.mock('../../src/identity/headless/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/identity/headless/index.js')>()),
  usePermissions: vi.fn(),
}));
vi.mock('../../src/notifications/headless/useNotificationEvents.js', () => ({ useNotificationEvents: vi.fn() }));

import { useNotificationConfig } from '../../src/notifications/headless/useNotificationConfig.js';
import { useSystemSettings } from '../../src/settings/headless/use-system-settings.js';
import { usePermissions } from '../../src/identity/headless/index.js';
import { useNotificationEvents } from '../../src/notifications/headless/useNotificationEvents.js';

const mockConfig = vi.mocked(useNotificationConfig);
const mockSettings = vi.mocked(useSystemSettings as unknown as (...args: unknown[]) => any);
const mockPermissions = vi.mocked(usePermissions);
const mockEvents = vi.mocked(useNotificationEvents);

/** React's generated ids depend on render order; the markup around them is what is compared. */
const html = (root: Element): string => root.innerHTML.replace(/:r[0-9a-z]+:/g, ':rX:');

const event = (overrides: Partial<NotificationEventDef> & Pick<NotificationEventDef, 'key' | 'label'>): NotificationEventDef => ({
  description: `${overrides.label} description.`,
  channels: ['email'],
  declaredChannels: ['email'],
  defaultEnabled: true,
  mandatory: false,
  ...overrides,
});

const WELCOME = event({ key: 'user.welcome', label: 'Welcome' });
const DIGEST = event({ key: 'weekly.digest', label: 'Weekly digest', defaultEnabled: false });
const ROLE_CHANGED = event({
  key: 'security.role_changed',
  label: 'Your roles changed',
  channels: ['email', 'browser'],
  declaredChannels: ['email', 'browser'],
  mandatory: true,
});
const BUILD = event({
  key: 'build.finished',
  label: 'Build finished',
  channels: ['email', 'browser', 'push'],
  declaredChannels: ['email', 'browser', 'push'],
});
const ANNOUNCEMENT = event({
  key: 'admin.broadcast',
  label: 'Announcements',
  channels: ['email', 'browser', 'push'],
  declaredChannels: ['email', 'browser', 'push'],
});

const noop = () => undefined;

function matrix(
  capability: NotificationCapability,
  options: { events?: NotificationEventDef[]; pushEnabled?: boolean; preferences?: Record<string, Record<string, boolean>>; isSaving?: boolean } = {},
): string {
  const { container, unmount } = render(
    <NotificationSettings
      events={options.events ?? [WELCOME, DIGEST, ROLE_CHANGED, BUILD, ANNOUNCEMENT]}
      preferences={options.preferences}
      onToggle={noop}
      browserCapability={capability}
      pushEnabled={options.pushEnabled ?? true}
      onRequestPermission={noop}
      isSaving={options.isSaving}
    />,
  );
  const out = html(container);
  unmount();
  return out;
}

describe('the preferences matrix is unchanged with only the built-in channels', () => {
  it.each<NotificationCapability>(['granted', 'default', 'denied', 'admin-disabled', 'unsupported', 'insecure-context', 'ios-needs-install', 'sw-unavailable'])(
    'browser capability %s, push on',
    (capability) => {
      expect(matrix(capability)).toMatchSnapshot();
    },
  );

  it('push off: the push column is disabled and the push banner shows', () => {
    expect(matrix('granted', { pushEnabled: false })).toMatchSnapshot();
  });

  it('push on, this device has not granted permission', () => {
    expect(matrix('default', { pushEnabled: true })).toMatchSnapshot();
  });

  it('stored preferences and a save in flight', () => {
    expect(
      matrix('granted', {
        preferences: { email: { 'user.welcome': false, 'weekly.digest': true }, push: { 'build.finished': false } },
        isSaving: true,
      }),
    ).toMatchSnapshot();
  });

  it('email-only events show no browser or push banner', () => {
    expect(matrix('denied', { events: [WELCOME, DIGEST], pushEnabled: false })).toMatchSnapshot();
  });

  it('no events at all', () => {
    expect(matrix('granted', { events: [] })).toMatchSnapshot();
  });
});

function composer(config: NotificationConfigResponse | null, options: { audience?: number | null } = {}): string {
  mockConfig.mockReturnValue({ config, isLoading: config === null, error: null, refresh: vi.fn() });
  const { baseElement, unmount } = render(
    <BroadcastComposer
      open
      onClose={noop}
      audience={options.audience === undefined ? 1284 : options.audience}
      isWorking={false}
      onSubmit={vi.fn()}
      onSendTest={vi.fn()}
    />,
  );
  const out = html(baseElement);
  unmount();
  return out;
}

describe('the broadcast composer is unchanged with only the built-in channels', () => {
  it('everything on', () => {
    expect(composer({ browserEnabled: true, pushEnabled: true, vapidPublicKey: 'key' })).toMatchSnapshot();
  });

  it('push not configured: the push channel is disabled with its tooltip anchor', () => {
    expect(composer({ browserEnabled: true, pushEnabled: false, vapidPublicKey: null })).toMatchSnapshot();
  });

  it('browser notifications off: the warning shows under the channels', () => {
    expect(composer({ browserEnabled: false, pushEnabled: true, vapidPublicKey: 'key' })).toMatchSnapshot();
  });

  it('config still loading, audience unknown', () => {
    expect(composer(null, { audience: null })).toMatchSnapshot();
  });
});

function adminPage(
  notifications: { browserEnabled: boolean; disabledEvents: string[] },
  options: { permissions?: string[]; events?: NotificationEventDef[] | null; isLoading?: boolean; error?: string | null } = {},
): string {
  const granted = options.permissions ?? ['system_settings:read', 'system_settings:write'];
  mockPermissions.mockReturnValue({
    permissions: new Set(granted),
    roles: new Set(['admin']),
    hasPermission: (permission: string) => granted.includes(permission),
    hasAnyPermission: vi.fn(),
    hasAllPermissions: vi.fn(),
    hasRole: vi.fn(),
    hasAnyRole: vi.fn(),
    isAdmin: true,
  });
  mockSettings.mockReturnValue({
    settings: { notifications, updatedAt: '2024-01-15T10:30:00Z', updatedBy: null, version: 7 },
    isLoading: false,
    error: null,
    isSaving: false,
    updateSettings: vi.fn(),
    replaceSettings: vi.fn(),
    refresh: vi.fn(),
  });
  mockEvents.mockReturnValue({
    events: options.events === undefined ? [WELCOME, ROLE_CHANGED, BUILD, ANNOUNCEMENT] : options.events,
    isLoading: options.isLoading ?? false,
    error: options.error ?? null,
    refresh: vi.fn().mockResolvedValue(undefined),
  });
  const { container, unmount } = render(<NotificationSettingsPage />, { wrapperOptions: { user: mockAdminUser } });
  const out = html(container);
  unmount();
  return out;
}

describe('the admin Notifications page is unchanged with only the built-in channels', () => {
  beforeEach(() => vi.clearAllMocks());

  it('browser on, one event suppressed', () => {
    expect(adminPage({ browserEnabled: true, disabledEvents: ['build.finished'] })).toMatchSnapshot();
  });

  it('browser off: the events are greyed and the info alert shows', () => {
    expect(adminPage({ browserEnabled: false, disabledEvents: [] })).toMatchSnapshot();
  });

  it('read-only viewer', () => {
    expect(adminPage({ browserEnabled: true, disabledEvents: [] }, { permissions: ['system_settings:read'] })).toMatchSnapshot();
  });

  it('events loading, then an events error, then no browser events', () => {
    expect(adminPage({ browserEnabled: true, disabledEvents: [] }, { events: null, isLoading: true })).toMatchSnapshot();
    expect(adminPage({ browserEnabled: true, disabledEvents: [] }, { events: null, error: 'Failed to load events' })).toMatchSnapshot();
    expect(adminPage({ browserEnabled: true, disabledEvents: [] }, { events: [WELCOME] })).toMatchSnapshot();
  });
});
